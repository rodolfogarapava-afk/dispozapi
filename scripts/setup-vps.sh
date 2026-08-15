#!/bin/bash
set -e
echo "🚀 Configurando VPS para CRM SaaS..."
apt-get update -y
apt-get install -y curl git
curl -fsSL https://get.docker.com | sh
systemctl enable docker && systemctl start docker
apt-get install -y docker-compose-plugin
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs
npm install -g pnpm pm2
mkdir -p /opt/crm-saas
cd /opt/crm-saas
echo "⚠️  Clone o repo e configure o .env"
echo "git clone https://github.com/SEU_USUARIO/crm-saas.git ."
echo "cp .env.example .env && nano .env"
echo "certbot certonly --standalone -d api.seudominio.com"
echo "docker compose up -d"
echo "docker compose exec api npx prisma migrate deploy"
