import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
  console.log('🌱 Iniciando seed do DisparoX...')

  // Organização demo
  const org = await prisma.organization.upsert({
    where: { slug: 'disparox-demo' },
    update: {},
    create: { name: 'DisparoX Demo', slug: 'disparox-demo', plan: 'PRO' }
  })
  console.log('✅ Organização criada:', org.name)

  // Usuário admin
  const password = await bcrypt.hash('demo123456', 12)
  const user = await prisma.user.upsert({
    where: { email: 'demo@disparox.local' },
    update: {},
    create: {
      name: 'Admin Demo',
      email: 'demo@disparox.local',
      password,
      role: 'OWNER',
      organizationId: org.id,
      emailVerified: true,
    }
  })
  console.log('✅ Usuário criado:', user.email)

  // Pipeline padrão
  const existing = await prisma.pipeline.findFirst({ where: { organizationId: org.id } })
  if (!existing) {
    const pipeline = await prisma.pipeline.create({
      data: { name: 'Pipeline de Vendas', organizationId: org.id }
    })
    const stages = [
      { name: 'Novos Leads',   order: 0, color: '#00AEEF' },
      { name: 'Contato',       order: 1, color: '#4FC3F7' },
      { name: 'Proposta',      order: 2, color: '#8B5CF6' },
      { name: 'Negociação',    order: 3, color: '#F59E0B' },
      { name: 'Fechado',       order: 4, color: '#10B981' },
    ]
    for (const s of stages) {
      await prisma.stage.create({ data: { ...s, pipelineId: pipeline.id } })
    }
    console.log('✅ Pipeline criado com', stages.length, 'estágios')

    // Contatos de exemplo
    const contacts = [
      { name: 'Maria Silva',    phone: '11999998888', email: 'maria@empresa.com',  tags: ['VIP', 'Cliente'],     source: 'WhatsApp' },
      { name: 'Pedro Costa',    phone: '21988887777', email: 'pedro@empresa.com',  tags: ['Lead'],               source: 'Instagram' },
      { name: 'Ana Oliveira',   phone: '31977776666', email: 'ana@empresa.com',    tags: ['Lead quente'],        source: 'Site' },
      { name: 'Roberto Lima',   phone: '41966665555', email: null,                 tags: [],                     source: 'Indicação' },
      { name: 'Carla Ferreira', phone: '51955554444', email: 'carla@empresa.com',  tags: ['Parceira', 'VIP'],    source: 'LinkedIn' },
    ]

    const createdContacts = []
    for (const c of contacts) {
      const contact = await prisma.contact.create({
        data: { ...c, organizationId: org.id }
      })
      createdContacts.push(contact)
    }
    console.log('✅', contacts.length, 'contatos criados')

    // Deals de exemplo
    const stagesDb = await prisma.stage.findMany({ where: { pipelineId: pipeline.id }, orderBy: { order: 'asc' } })
    const dealsData = [
      { title: 'Contrato Anual - Maria Silva', value: 12000, stageIdx: 2 },
      { title: 'Plano Pro - Pedro Costa',      value: 2400,  stageIdx: 1 },
      { title: 'Consultoria - Ana Oliveira',   value: 5000,  stageIdx: 3 },
      { title: 'Pacote Enterprise - Carla',    value: 24000, stageIdx: 4 },
    ]
    for (let i = 0; i < dealsData.length; i++) {
      const d = dealsData[i]
      await prisma.deal.create({
        data: {
          title: d.title,
          value: d.value,
          stageId: stagesDb[d.stageIdx].id,
          contactId: createdContacts[i % createdContacts.length].id,
          assignedId: user.id,
        }
      })
    }
    console.log('✅', dealsData.length, 'deals criados')
  }

  console.log('\n🎉 Seed concluído com sucesso!')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('📧 Email:  demo@disparox.local')
  console.log('🔑 Senha:  demo123456')
  console.log('🌐 App:    http://localhost:3000')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
}

main()
  .catch((e) => { console.error('❌ Erro no seed:', e); process.exit(1) })
  .finally(() => prisma.$disconnect())
