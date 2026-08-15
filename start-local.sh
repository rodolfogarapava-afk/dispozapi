#!/bin/bash
set -e
echo ""
echo "DisparoX — Iniciando ambiente local..."
echo ""

# Verifica Docker
if ! command -v docker &> /dev/null; then
  echo "❌ Docker não encontrado. Instale em: https://docker.com/get-started"
  exit 1
fi

# Verifica Node
if ! command -v node &> /dev/null; then
  echo "❌ Node.js não encontrado. Instale em: https://nodejs.org"
  exit 1
fi

# Verifica pnpm
if ! command -v pnpm &> /dev/null; then
  echo "📦 Instalando pnpm..."
  npm install -g pnpm
fi

echo "🐳 Subindo PostgreSQL, Redis e Evolution API..."
docker compose -f docker-compose.dev.yml up -d

echo "⏳ Aguardando banco ficar pronto..."
sleep 5

echo "📦 Instalando dependências..."
pnpm install

echo "🗄️  Configurando banco de dados..."
cd apps/api
npx prisma generate
npx prisma migrate dev --name init 2>/dev/null || npx prisma migrate deploy
npx prisma db seed
cd ../..

echo ""
echo "✅ Tudo pronto! Iniciando servidores..."
echo ""
echo "  Frontend → http://localhost:3000"
echo "  Backend  → http://localhost:3001"
echo "  API Docs → http://localhost:3001/docs"
echo "  WhatsApp → http://localhost:8080"
echo ""
echo "  Login: demo@disparox.local / demo123456"
echo ""

pnpm dev
