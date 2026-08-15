const { PrismaClient } = require('@prisma/client')
const bcrypt = require('bcryptjs')
const prisma = new PrismaClient()

async function main() {
  console.log('Iniciando seed...')

  const org = await prisma.organization.upsert({
    where: { slug: 'zapshark-demo' },
    update: {},
    create: { name: 'ZapShark Demo', slug: 'zapshark-demo', plan: 'PRO' }
  })

  const hash = await bcrypt.hash('demo123456', 12)
  await prisma.user.upsert({
    where: { email: 'demo@zapshark.com' },
    update: {},
    create: { name: 'Admin Demo', email: 'demo@zapshark.com', password: hash, role: 'OWNER', organizationId: org.id, emailVerified: true }
  })

  console.log('Seed concluido!')
  console.log('Email: demo@zapshark.com')
  console.log('Senha: demo123456')
}

main().catch(console.error).finally(() => prisma.$disconnect())