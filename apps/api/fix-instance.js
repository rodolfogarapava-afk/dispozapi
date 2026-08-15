const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function main() {
  const org = await prisma.organization.findFirst()
  console.log('Org:', org.id)

  const instance = await prisma.whatsappInstance.upsert({
    where: { id: 'instancia-luiz' },
    update: { status: 'CONNECTED' },
    create: {
      id: 'instancia-luiz',
      name: 'luiz',
      status: 'CONNECTED',
      organizationId: org.id,
    }
  })
  console.log('Instância criada:', instance)
}

main().catch(console.error).finally(() => prisma.$disconnect())