const { PrismaClient } = require('@prisma/client')
const bcrypt = require('bcryptjs')
const prisma = new PrismaClient()

async function main() {
  console.log('Iniciando seed...')

  const org = await prisma.organization.upsert({
    where: { slug: 'disparox-demo' },
    update: {},
    create: { name: 'DisparoX Demo', slug: 'disparox-demo', plan: 'PRO' }
  })

  const hash = await bcrypt.hash('demo123456', 12)
  await prisma.user.upsert({
    where: { email: 'demo@disparox.local' },
    update: {},
    create: { name: 'Admin Demo', email: 'demo@disparox.local', password: hash, role: 'OWNER', organizationId: org.id, emailVerified: true }
  })

  console.log('Seed concluido!')
  console.log('Email: demo@disparox.local')
  console.log('Senha: demo123456')
}

main().catch(console.error).finally(() => prisma.$disconnect())
