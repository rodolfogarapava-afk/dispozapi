# DispozAPI

Plataforma SaaS de atendimento e campanhas via WhatsApp, integrada à Evolution API.

## Estrutura

- `apps/web`: painel Next.js
- `apps/api`: API Fastify
- `packages/database`: banco PostgreSQL com Prisma
- `docker-compose.yml`: serviços para execução em VPS

## Requisitos

- Node.js 20 ou superior
- pnpm 9
- PostgreSQL
- Redis
- Evolution API

## Desenvolvimento local

```bash
pnpm install
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local
pnpm dev
```

Preencha os arquivos de ambiente com suas próprias credenciais. Arquivos `.env` reais não devem ser enviados ao GitHub.

## Build

```bash
pnpm build
```

## Produção

A implantação prevista utiliza Docker, PostgreSQL, Redis, Evolution API e proxy HTTPS na VPS. Os segredos de produção devem ser configurados diretamente no servidor.

