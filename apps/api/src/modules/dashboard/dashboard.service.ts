import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const orgDeals = (orgId: string) => ({ stage: { pipeline: { organizationId: orgId } } })
const orgMessages = (orgId: string) => ({ conversation: { instance: { organizationId: orgId } } })

function delta(current: number, previous: number): number | null {
  if (previous === 0) return current > 0 ? 100 : null
  return Math.round(((current - previous) / previous) * 100)
}

function rate(value: number, total: number): number {
  if (!total) return 0
  return Math.min(100, Math.round((value / total) * 1000) / 10)
}

function startOfDay(value: Date): Date {
  const date = new Date(value)
  date.setHours(0, 0, 0, 0)
  return date
}

function dayKey(value: Date): string {
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

type MessageRow = { timestamp: Date; fromMe: boolean; status: string }
type CampaignDelivery = { sentAt: Date | null; status: string }

function messageTotals(messages: MessageRow[], campaignDeliveries: CampaignDelivery[]) {
  const outgoing = messages.filter((message) => message.fromMe && !['FAILED', 'PENDING'].includes(message.status))
  return {
    sent: outgoing.length + campaignDeliveries.filter((delivery) => delivery.sentAt && !['FAILED', 'PENDING'].includes(delivery.status)).length,
    delivered: outgoing.filter((message) => ['DELIVERED', 'READ'].includes(message.status)).length,
    read: outgoing.filter((message) => message.status === 'READ').length,
    responses: messages.filter((message) => !message.fromMe).length,
  }
}

export class DashboardService {
  async overview(orgId: string) {
    const now = new Date()
    const startMonth = new Date(now.getFullYear(), now.getMonth(), 1)
    const startPrevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    const startWeek = startOfDay(now)
    startWeek.setDate(startWeek.getDate() - 6)
    const startPreviousWeek = new Date(startWeek)
    startPreviousWeek.setDate(startPreviousWeek.getDate() - 7)

    const [
      contacts,
      contactsPrev,
      conversations,
      openDeals,
      wonThisMonth,
      wonPrevMonth,
      stages,
      messages,
      campaignDeliveries,
    ] = await Promise.all([
      prisma.contact.count({ where: { organizationId: orgId } }),
      prisma.contact.count({ where: { organizationId: orgId, createdAt: { lt: startMonth } } }),
      prisma.conversation.count({ where: { instance: { organizationId: orgId } } }),
      prisma.deal.count({ where: { ...orgDeals(orgId), status: 'OPEN' } }),
      prisma.deal.aggregate({
        where: { ...orgDeals(orgId), status: 'WON', closedAt: { gte: startMonth } },
        _sum: { value: true },
        _count: true,
      }),
      prisma.deal.aggregate({
        where: { ...orgDeals(orgId), status: 'WON', closedAt: { gte: startPrevMonth, lt: startMonth } },
        _sum: { value: true },
        _count: true,
      }),
      prisma.stage.findMany({
        where: { pipeline: { organizationId: orgId } },
        orderBy: { order: 'asc' },
        select: {
          name: true,
          color: true,
          _count: { select: { deals: { where: { status: 'OPEN' } } } },
        },
      }),
      prisma.message.findMany({
        where: { ...orgMessages(orgId), timestamp: { gte: startPreviousWeek } },
        select: { timestamp: true, fromMe: true, status: true },
      }),
      prisma.campaignContact.findMany({
        where: { campaign: { organizationId: orgId }, sentAt: { gte: startPreviousWeek } },
        select: { sentAt: true, status: true },
      }),
    ])

    const currentMessages = messages.filter((message) => message.timestamp >= startWeek)
    const previousMessages = messages.filter((message) => message.timestamp < startWeek)
    const currentCampaignDeliveries = campaignDeliveries.filter((delivery) => delivery.sentAt && delivery.sentAt >= startWeek)
    const previousCampaignDeliveries = campaignDeliveries.filter((delivery) => delivery.sentAt && delivery.sentAt < startWeek)
    const currentTotals = messageTotals(currentMessages, currentCampaignDeliveries)
    const previousTotals = messageTotals(previousMessages, previousCampaignDeliveries)

    const weekLabels = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
    const weeklyMessages = Array.from({ length: 7 }, (_, index) => {
      const date = new Date(startWeek)
      date.setDate(startWeek.getDate() + index)
      const key = dayKey(date)
      const totals = messageTotals(
        currentMessages.filter((message) => dayKey(message.timestamp) === key),
        currentCampaignDeliveries.filter((delivery) => delivery.sentAt && dayKey(delivery.sentAt) === key),
      )
      return { date: key, label: weekLabels[date.getDay()], ...totals }
    })

    const revenueMonth = wonThisMonth._sum.value || 0
    const revenuePrev = wonPrevMonth._sum.value || 0

    const wonDeals = await prisma.deal.findMany({
      where: {
        ...orgDeals(orgId),
        status: 'WON',
        closedAt: { gte: new Date(now.getFullYear(), now.getMonth() - 11, 1) },
      },
      select: { value: true, closedAt: true },
    })
    const months: { label: string; value: number }[] = []
    const monthLabels = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
    for (let i = 11; i >= 0; i--) {
      const date = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const total = wonDeals
        .filter((deal) => deal.closedAt && deal.closedAt.getFullYear() === date.getFullYear() && deal.closedAt.getMonth() === date.getMonth())
        .reduce((sum, deal) => sum + (deal.value || 0), 0)
      months.push({ label: monthLabels[date.getMonth()], value: total })
    }

    const activities = await prisma.activity.findMany({
      where: { deal: orgDeals(orgId) },
      orderBy: { createdAt: 'desc' },
      take: 8,
      select: { id: true, type: true, title: true, createdAt: true },
    })

    return {
      messageMetrics: {
        sent: { value: currentTotals.sent, delta: delta(currentTotals.sent, previousTotals.sent) },
        delivered: { value: currentTotals.delivered, delta: delta(currentTotals.delivered, previousTotals.delivered) },
        read: { value: currentTotals.read, delta: delta(currentTotals.read, previousTotals.read) },
        responses: { value: currentTotals.responses, delta: delta(currentTotals.responses, previousTotals.responses) },
      },
      weeklyMessages,
      conversion: {
        deliveryRate: rate(currentTotals.delivered, currentTotals.sent),
        readRate: rate(currentTotals.read, currentTotals.sent),
        responseRate: rate(currentTotals.responses, currentTotals.sent),
      },
      metrics: {
        contacts: { value: contacts, delta: delta(contacts, contactsPrev) },
        conversations: { value: conversations, delta: null },
        openDeals: { value: openDeals, delta: null },
        revenueMonth: { value: revenueMonth, delta: delta(revenueMonth, revenuePrev) },
      },
      salesByMonth: months,
      funnel: stages.map((stage) => ({ label: stage.name, value: stage._count.deals, color: stage.color })),
      recentActivity: activities,
      wonCountMonth: wonThisMonth._count,
    }
  }
}
