#!/usr/bin/env bash
set -euo pipefail

base_dir=/opt/dispozapi
current_dir="$base_dir/current"
shared_dir="$base_dir/shared"
public_host=75.119.131.28
web_port=3100
api_port=3101
postgres_port=55432
redis_port=56379

if [[ ${EUID} -ne 0 ]]; then
  echo "Execute como root."
  exit 1
fi

for required in node pnpm pm2 docker openssl; do
  command -v "$required" >/dev/null || { echo "Comando ausente: $required"; exit 1; }
done

for port in "$web_port" "$api_port" "$postgres_port" "$redis_port"; do
  if ss -lntH "sport = :$port" | grep -q .; then
    echo "A porta $port deixou de estar livre. Implantação cancelada."
    exit 1
  fi
done

install -d -m 700 "$shared_dir"
umask 077

infra_env="$shared_dir/infra.env"
api_env="$shared_dir/api.env"
web_env="$shared_dir/web.env"

if [[ ! -f "$infra_env" ]]; then
  postgres_password=$(openssl rand -hex 24)
  redis_password=$(openssl rand -hex 24)
  printf 'POSTGRES_PASSWORD=%s\nPOSTGRES_HOST_PORT=%s\nREDIS_PASSWORD=%s\nREDIS_HOST_PORT=%s\n' \
    "$postgres_password" "$postgres_port" "$redis_password" "$redis_port" > "$infra_env"
fi

set -a
source "$infra_env"
set +a

evolution_key=''
if [[ -f /root/crm-api/.env ]]; then
  evolution_key=$(sed -n 's/^EVOLUTION_API_KEY=//p' /root/crm-api/.env | head -n 1)
fi
if [[ -z "$evolution_key" && -f /root/crm-saas/apps/api/.env ]]; then
  evolution_key=$(sed -n 's/^EVOLUTION_API_KEY=//p' /root/crm-saas/apps/api/.env | head -n 1)
fi
if [[ -z "$evolution_key" ]]; then
  evolution_key=$(docker inspect evolution_api --format '{{range .Config.Env}}{{println .}}{{end}}' 2>/dev/null | sed -n 's/^AUTHENTICATION_API_KEY=//p' | head -n 1)
fi
if [[ -z "$evolution_key" ]]; then
  echo "Não foi possível localizar a chave da Evolution API existente."
  exit 1
fi

if [[ ! -f "$api_env" ]]; then
  jwt_secret=$(openssl rand -hex 48)
  printf '%s\n' \
    'NODE_ENV=production' \
    "PORT=$api_port" \
    "DATABASE_URL=postgresql://dispozapi:${POSTGRES_PASSWORD}@127.0.0.1:${postgres_port}/dispozapi" \
    "REDIS_URL=redis://:${REDIS_PASSWORD}@127.0.0.1:${redis_port}" \
    "JWT_SECRET=$jwt_secret" \
    "FRONTEND_URL=http://${public_host}:${web_port},http://api.syyck.store:${web_port}" \
    'EVOLUTION_API_URL=http://127.0.0.1:8080' \
    "EVOLUTION_API_KEY=$evolution_key" \
    "API_URL=http://${public_host}:${api_port}" \
    > "$api_env"
fi

printf '%s\n' \
  "NEXT_PUBLIC_API_URL=http://${public_host}:${api_port}" \
  "NEXT_PUBLIC_APP_URL=http://${public_host}:${web_port}" \
  "ADMIN_PANEL_PATH=central-$(openssl rand -hex 14)" \
  > "$web_env"
chmod 600 "$infra_env" "$api_env" "$web_env"

cd "$current_dir"
pnpm install --frozen-lockfile
pnpm db:generate

set -a
source "$web_env"
set +a
pnpm build

docker compose \
  --env-file "$infra_env" \
  -f "$current_dir/deploy/docker-compose.isolated.yml" \
  up -d

for attempt in $(seq 1 30); do
  if docker exec dispozapi_postgres pg_isready -U dispozapi -d dispozapi >/dev/null 2>&1; then
    break
  fi
  if [[ $attempt -eq 30 ]]; then
    echo "PostgreSQL do DispozAPI não ficou pronto."
    exit 1
  fi
  sleep 2
done

set -a
source "$api_env"
set +a
pnpm --filter @crm/api exec prisma migrate deploy --schema prisma/schema.prisma

chmod +x "$current_dir/deploy/start-api.sh"
pm2 startOrReload "$current_dir/deploy/ecosystem.config.cjs" --update-env
pm2 save

ufw allow "$web_port/tcp" comment 'DispozAPI web' >/dev/null
ufw allow "$api_port/tcp" comment 'DispozAPI API' >/dev/null

for attempt in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:${api_port}/health" >/dev/null; then
    break
  fi
  if [[ $attempt -eq 30 ]]; then
    echo "API do DispozAPI não respondeu ao health check."
    pm2 logs dispozapi-api --lines 30 --nostream
    exit 1
  fi
  sleep 2
done

curl -fsS "http://127.0.0.1:${web_port}/auth/login" >/dev/null
echo "DispozAPI publicado em http://${public_host}:${web_port}"
echo "API disponível em http://${public_host}:${api_port}"
