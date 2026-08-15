import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

const orgDeals = (orgId: string) => ({ stage: { pipeline: { organizationId: orgId } } })

// Janela de datas a partir de query (?from&to). Default: últimos 30 dias.
function range(query: any): { from: Date; to: Date } {
  const to = query?.to ? new Date(query.to) : new Date()
  const from = query?.from ? new Date(query.from) : new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000)
  return { from, to }
}

export class ReportService {
  /** Vendas ganhas no período: total, valor, ticket médio e série diária. */
  async sales(orgId: string, query: any) {
    const { from, to } = range(query)
    const deals = await prisma.deal.findMany({
      where: { ...orgDeals(orgId), status: 'WON', closedAt: { gte: from, lte: to } },
      select: { value: true, closedAt: true },
      orderBy: { closedAt: 'asc' },
    })
    const count = deals.length
    const total = deals.reduce((a, d) => a + (d.value || 0), 0)
    const avg = count ? total / count : 0

    // Série por dia (YYYY-MM-DD → valor somado).
    const byDay = new Map<string, number>()
    for (const d of deals) {
      if (!d.closedAt) continue
      const key = d.closedAt.toISOString().slice(0, 10)
      byDay.set(key, (byDay.get(key) || 0) + (d.value || 0))
    }
    const series = Array.from(byDay.entries()).map(([date, value]) => ({ date, value }))

    return { from, to, count, total, avg, series }
  }

  /** Conversão por estágio: nº de deals abertos em cada etapa do funil. */
  async funnel(orgId: string) {
    const stages = await prisma.stage.findMany({
      where: { pipeline: { organizationId: orgId } },
      orderBy: { order: 'asc' },
      select: {
        name: true,
        color: true,
        _count: { select: { deals: { where: { status: 'OPEN' } } } },
      },
    })
    return stages.map((s) => ({ stage: s.name, color: s.color, count: s._count.deals }))
  }

  /** Ranking de atendentes por deals ganhos e valor no período. */
  async agents(orgId: string, query: any) {
    const { from, to } = range(query)
    const won = await prisma.deal.findMany({
      where: { ...orgDeals(orgId), status: 'WON', closedAt: { gte: from, lte: to }, assignedId: { not: null } },
      select: { value: true, assignedId: true, assignedTo: { select: { name: true, avatar: true } } },
    })
    const map = new Map<string, { name: string; avatar: string | null; count: number; total: number }>()
    for (const d of won) {
      const id = d.assignedId as string
      const cur = map.get(id) || { name: d.assignedTo?.name || '—', avatar: d.assignedTo?.avatar ?? null, count: 0, total: 0 }
      cur.count++
      cur.total += d.value || 0
      map.set(id, cur)
    }
    return Array.from(map.values()).sort((a, b) => b.total - a.total)
  }
}
