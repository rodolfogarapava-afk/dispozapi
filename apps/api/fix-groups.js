// Backfill: corrige o nome (e foto) dos grupos já salvos com nome de pessoa.
// Monta um mapa global groupJid -> { subject, pictureUrl } varrendo fetchAllGroups
// de TODAS as instâncias ativas na Evolution (os nomes no banco podem não bater
// com os nomes reais na Evolution, então não dá pra confiar no instanceName salvo).
// Rodar UMA vez: node fix-groups.js
const { PrismaClient } = require('@prisma/client')
const axios = require('axios')

const prisma = new PrismaClient()
const evo = axios.create({
  baseURL: process.env.EVOLUTION_API_URL,
  headers: { apikey: process.env.EVOLUTION_API_KEY },
  timeout: 120000,
})

async function main() {
  // 1) Lista instâncias reais na Evolution
  const instRes = await evo.get('/instance/fetchInstances').catch(() => ({ data: [] }))
  const instances = (Array.isArray(instRes.data) ? instRes.data : [])
    .filter((i) => (i.connectionStatus || i.status) === 'open')
    .map((i) => i.name)
  console.log(`Instâncias ativas na Evolution: ${instances.join(', ') || '(nenhuma)'}`)

  // 2) Mapa global groupJid -> {subject, pictureUrl}
  const map = new Map()
  for (const name of instances) {
    try {
      const r = await evo.get(`/group/fetchAllGroups/${name}`, { params: { getParticipants: false } })
      const groups = Array.isArray(r.data) ? r.data : []
      for (const g of groups) {
        if (g?.id && g?.subject) map.set(g.id, { subject: g.subject, pictureUrl: g.pictureUrl || null })
      }
      console.log(`  ${name}: ${groups.length} grupos`)
    } catch (e) {
      console.log(`  ${name}: erro ${e?.response?.status || e.message}`)
    }
  }
  console.log(`Total de grupos mapeados: ${map.size}`)

  // 3) Atualiza conversas de grupo salvas
  const convs = await prisma.conversation.findMany({
    where: { remoteJid: { endsWith: '@g.us' } },
    select: { id: true, remoteJid: true, pushName: true, profilePicUrl: true },
  })
  console.log(`Conversas de grupo no banco: ${convs.length}`)

  let fixed = 0
  let notFound = 0
  for (const c of convs) {
    const info = map.get(c.remoteJid)
    if (!info) {
      notFound++
      continue
    }
    await prisma.conversation.update({
      where: { id: c.id },
      data: {
        pushName: info.subject,
        ...(info.pictureUrl && !c.profilePicUrl ? { profilePicUrl: info.pictureUrl } : {}),
      },
    })
    console.log(`✓ ${c.remoteJid}: "${c.pushName}" -> "${info.subject}"`)
    fixed++
  }

  console.log(`\nConcluído. Corrigidos: ${fixed} | Sem match no mapa: ${notFound}`)
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
