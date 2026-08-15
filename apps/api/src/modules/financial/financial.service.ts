import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

const orgDeals = (orgId: string) => ({ stage: { pipeline: { organizationId: orgId } } })

function range(query: any): { from: Date; to: Date } {
  const to = query?.to ? new Date(query.to) : new Date()
  const from = query?.from ? new Date(query.from) : new Date(to.getFullYear(), to.getMonth() - 5, 1)
  return { from, to }
}

export class FinancialService {
  /** Resumo: receita das vendas ganhas + situação das faturas. */
  async summary(orgId: string, query: any) {
    const { from, to } = range(query)
    const [won, invoicesPaid, invoicesPending] = await Promise.all([
      prisma.deal.aggregate({
        where: { ...orgDeals(orgId), status: 'WON', closedAt: { gte: from, lte: to } },
        _sum: { value: true },
        _count: true,
      }),
      prisma.invoice.aggregate({
        where: { organizationId: orgId, status: 'PAID' },
        _sum: { amount: true },
        _count: true,
      }),
      prisma.invoice.aggregate({
        where: { organizationId: orgId, status: 'PENDING' },
        _sum: { amount: true },
        _count: true,
      }),
    ])
    return {
      from,
      to,
      salesRevenue: won._sum.value || 0,
      salesCount: won._count,
      invoicesPaid: { amount: invoicesPaid._sum.amount || 0, count: invoicesPaid._count },
      invoicesPending: { amount: invoicesPending._sum.amount || 0, count: invoicesPending._count },
    }
  }

  /** Faturas da organização. */
  async invoices(orgId: string) {
    return prisma.invoice.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: 'desc' },
    })
  }

  /** Entradas (receita ganha) por mês no período — alimenta o gráfico. */
  async revenue(orgId: string, query: any) {
    const { from, to } = range(query)
    const deals = await prisma.deal.findMany({
      where: { ...orgDeals(orgId), status: 'WON', closedAt: { gte: from, lte: to } },
      select: { value: true, closedAt: true },
    })
    const labels = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
    const byMonth = new Map<string, { label: string; value: number }>()
    // Inicializa todos os meses do range com zero (gráfico contínuo).
    const cursor = new Date(from.getFullYear(), from.getMonth(), 1)
    while (cursor <= to) {
      const key = `${cursor.getFullYear()}-${cursor.getMonth()}`
      byMonth.set(key, { label: labels[cursor.getMonth()], value: 0 })
      cursor.setMonth(cursor.getMonth() + 1)
    }
    for (const d of deals) {
      if (!d.closedAt) continue
      const key = `${d.closedAt.getFullYear()}-${d.closedAt.getMonth()}`
      const cur = byMonth.get(key)
      if (cur) cur.value += d.value || 0
    }
    return Array.from(byMonth.values())
  }
}
