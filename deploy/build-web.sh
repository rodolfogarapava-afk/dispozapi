#!/usr/bin/env bash
set -euo pipefail

app_dir=${1:-/opt/dispozapi/current}
web_env=${WEB_ENV_FILE:-/opt/dispozapi/shared/web.env}

if [[ ! -f "$web_env" ]]; then
  echo "Configuração pública do frontend ausente: $web_env"
  exit 1
fi

set -a
source "$web_env"
set +a

if [[ -z ${NEXT_PUBLIC_API_URL:-} ]]; then
  echo "NEXT_PUBLIC_API_URL não foi configurada. Build cancelado."
  exit 1
fi

cd "$app_dir"
pnpm --filter @crm/web build

if grep -Rqs 'http://localhost:3001' apps/web/.next/static; then
  echo "Build inválido: o frontend ainda aponta para localhost:3001."
  exit 1
fi

echo "Frontend compilado para a API: $NEXT_PUBLIC_API_URL"
