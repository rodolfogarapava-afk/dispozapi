import { PrismaClient, Prisma } from '@prisma/client'
import bcrypt from 'bcryptjs'
import { getPlanDefinition } from '../../common/plan-limits'
const prisma = new PrismaClient()

const DAY = 24 * 60 * 60 * 1000

export class AdminService {
  /** KPIs globais da plataforma (cross-org). */
  async overview() {
    const now = new Date()
    const in3Days = new Date(now.getTime() + 3 * DAY)
    const last30 = new Date(now.getTime() - 30 * DAY)

    const [
      totalOrgs,
      activeOrgs,
      trialOrgs,
      suspendedOrgs,
      pastDueOrgs,
      expiringTrials,
      newSubs30d,
      mrrAgg,
      totalUsers,
      totalContacts,
      totalMessages,
      totalInstances,
    ] = await Promise.all([
      prisma.organization.count(),
      prisma.organization.count({ where: { status: 'ACTIVE' } }),
      prisma.organization.count({ where: { status: 'TRIAL' } }),
      prisma.organization.count({ where: { status: 'SUSPENDED' } }),
      prisma.organization.count({ where: { status: 'PAST_DUE' } }),
      prisma.organization.count({ where: { status: 'TRIAL', trialEndsAt: { gte: now, lte: in3Days } } }),
      prisma.organization.count({ where: { createdAt: { gte: last30 } } }),
      prisma.organization.aggregate({ _sum: { mrr: true }, where: { status: { in: ['ACTIVE', 'PAST_DUE'] } } }),
      prisma.user.count(),
      prisma.contact.count(),
      prisma.message.count(),
      prisma.whatsappInstance.count({ where: { status: 'CONNECTED' } }),
    ])

    return {
      orgs: {
        total: totalOrgs,
        active: activeOrgs,
        trial: trialOrgs,
        suspended: suspendedOrgs,
        pastDue: pastDueOrgs,
        expiringTrials,
        newLast30d: newSubs30d,
      },
      mrr: mrrAgg._sum.mrr || 0,
      platform: {
        users: totalUsers,
        contacts: totalContacts,
        messages: totalMessages,
        connectedInstances: totalInstances,
      },
    }
  }

  /** Lista todas as orgs com filtros, busca e paginação. */
  async organizations(query: any) {
    const page = Math.max(1, Number(query?.page) || 1)
    const pageSize = Math.min(100, Math.max(1, Number(query?.pageSize) || 20))
    const where: Prisma.OrganizationWhereInput = {}
    if (query?.status) where.status = query.status
    if (query?.plan) where.plan = query.plan
    if (query?.q) where.name = { contains: String(query.q), mode: 'insensitive' }

    const [total, items] = await Promise.all([
      prisma.organization.count({ where }),
      prisma.organization.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true, name: true, slug: true, plan: true, status: true,
          trialEndsAt: true, planExpires: true, mrr: true,
          createdAt: true, updatedAt: true,
          _count: { select: { users: true, contacts: true, whatsappInstances: true, campaigns: true } },
        },
      }),
    ])
    return { total, page, pageSize, items }
  }

  /** Visão 360° de uma org. */
  async organizationDetail(id: string) {
    const org = await prisma.organization.findUnique({
      where: { id },
      select: {
        id: true, name: true, slug: true, plan: true, status: true,
        trialEndsAt: true, planExpires: true, mrr: true, logo: true,
        createdAt: true, updatedAt: true,
        users: {
          select: { id: true, name: true, email: true, role: true, active: true, isSuperAdmin: true, createdAt: true },
          orderBy: { createdAt: 'asc' },
        },
        whatsappInstances: {
          select: { id: true, name: true, number: true, status: true, createdAt: true },
        },
        _count: { select: { contacts: true, campaigns: true, chatbots: true, invoices: true, pipelines: true } },
      },
    })
    if (!org) throw { statusCode: 404, message: 'Organização não encontrada' }

    const invoices = await prisma.invoice.findMany({
      where: { organizationId: id },
      orderBy: { createdAt: 'desc' },
      take: 10,
    })
    return { ...org, invoices }
  }

  /** Ação admin: muda status/plano/datas/mrr de uma org. */
  async updateOrganization(id: string, data: any) {
    const allowed: Prisma.OrganizationUpdateInput = {}
    if (data.status !== undefined) allowed.status = data.status
    if (data.plan !== undefined) {
      allowed.plan = data.plan
      if (data.mrr === undefined) allowed.mrr = getPlanDefinition(data.plan).price
    }
    if (data.mrr !== undefined) allowed.mrr = Number(data.mrr)
    if (data.trialEndsAt !== undefined) allowed.trialEndsAt = data.trialEndsAt ? new Date(data.trialEndsAt) : null
    if (data.planExpires !== undefined) allowed.planExpires = data.planExpires ? new Date(data.planExpires) : null

    return prisma.organization.update({
      where: { id },
      data: allowed,
      select: { id: true, name: true, plan: true, status: true, trialEndsAt: true, planExpires: true, mrr: true },
    })
  }

  /** Séries por mês: novas orgs e MRR acumulado — alimenta gráficos. */
  async growth(query: any) {
    const to = query?.to ? new Date(query.to) : new Date()
    const from = query?.from ? new Date(query.from) : new Date(to.getFullYear(), to.getMonth() - 11, 1)

    const orgs = await prisma.organization.findMany({
      where: { createdAt: { lte: to } },
      select: { createdAt: true, mrr: true, status: true },
      orderBy: { createdAt: 'asc' },
    })

    const labels = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
    const byMonth = new Map<string, { label: string; newOrgs: number; mrr: number }>()
    const cursor = new Date(from.getFullYear(), from.getMonth(), 1)
    while (cursor <= to) {
      byMonth.set(`${cursor.getFullYear()}-${cursor.getMonth()}`, { label: labels[cursor.getMonth()], newOrgs: 0, mrr: 0 })
      cursor.setMonth(cursor.getMonth() + 1)
    }
    // MRR acumulado: cada org paga contribui a partir do mês em que entrou.
    for (const o of orgs) {
      const key = `${o.createdAt.getFullYear()}-${o.createdAt.getMonth()}`
      const cur = byMonth.get(key)
      if (cur && o.createdAt >= from) cur.newOrgs += 1
      if (['ACTIVE', 'PAST_DUE'].includes(o.status)) {
        // soma o mrr da org em todos os meses >= entrada
        for (const [k, v] of byMonth) {
          const [y, m] = k.split('-').map(Number)
          const monthStart = new Date(y, m, 1)
          if (monthStart >= new Date(o.createdAt.getFullYear(), o.createdAt.getMonth(), 1)) v.mrr += o.mrr || 0
        }
      }
    }
    return Array.from(byMonth.values())
  }

  // ─── USUÁRIOS (cross-org, god-mode) ──────────────────────
  /** Cria usuário em qualquer org. */
  async createUser(data: { name: string; email: string; password: string; organizationId: string; role?: string; isSuperAdmin?: boolean }) {
    if (!data.email || !data.password || !data.organizationId) throw { statusCode: 400, message: 'email, senha e organizationId são obrigatórios' }
    const exists = await prisma.user.findUnique({ where: { email: data.email } })
    if (exists) throw { statusCode: 400, message: 'Email já cadastrado' }
    const org = await prisma.organization.findUnique({ where: { id: data.organizationId }, select: { id: true } })
    if (!org) throw { statusCode: 404, message: 'Organização não encontrada' }
    const password = await bcrypt.hash(data.password, 12)
    return prisma.user.create({
      data: {
        name: data.name || data.email, email: data.email, password,
        role: (data.role as any) || 'MEMBER', isSuperAdmin: !!data.isSuperAdmin,
        emailVerified: true, active: true, organizationId: data.organizationId,
      },
      select: { id: true, name: true, email: true, role: true, active: true, isSuperAdmin: true },
    })
  }

  /** Edita usuário: nome, email, role, ativo, super-admin e (opcional) nova senha. */
  async updateUser(id: string, data: any) {
    const patch: Prisma.UserUpdateInput = {}
    if (data.name !== undefined) patch.name = data.name
    if (data.email !== undefined) patch.email = data.email
    if (data.role !== undefined) patch.role = data.role
    if (data.active !== undefined) patch.active = !!data.active
    if (data.isSuperAdmin !== undefined) patch.isSuperAdmin = !!data.isSuperAdmin
    if (data.password) patch.password = await bcrypt.hash(String(data.password), 12)
    return prisma.user.update({
      where: { id },
      data: patch,
      select: { id: true, name: true, email: true, role: true, active: true, isSuperAdmin: true },
    })
  }

  /** Exclui usuário. Impede remover o último super-admin da plataforma. */
  async deleteUser(id: string) {
    const user = await prisma.user.findUnique({ where: { id }, select: { isSuperAdmin: true } })
    if (!user) throw { statusCode: 404, message: 'Usuário não encontrado' }
    if (user.isSuperAdmin) {
      const supers = await prisma.user.count({ where: { isSuperAdmin: true } })
      if (supers <= 1) throw { statusCode: 400, message: 'Não é possível excluir o último super-admin' }
    }
    await prisma.user.delete({ where: { id } })
    return { ok: true }
  }

  // ─── ORGANIZAÇÃO (criar/renomear/excluir) ────────────────
  /** Cria uma org já com um usuário OWNER. */
  async createOrganization(data: { name: string; ownerEmail: string; ownerPassword: string; ownerName?: string; plan?: string; status?: string }) {
    if (!data.name || !data.ownerEmail || !data.ownerPassword) throw { statusCode: 400, message: 'name, ownerEmail e ownerPassword são obrigatórios' }
    const exists = await prisma.user.findUnique({ where: { email: data.ownerEmail } })
    if (exists) throw { statusCode: 400, message: 'Email do dono já cadastrado' }
    const slug = data.name.toLowerCase().replace(/\s+/g, '-') + '-' + Date.now().toString(36)
    const password = await bcrypt.hash(data.ownerPassword, 12)
    const selectedPlan = getPlanDefinition(data.plan)
    const org = await prisma.organization.create({
      data: {
        name: data.name, slug,
        plan: selectedPlan.code as any, status: (data.status as any) || 'TRIAL', mrr: selectedPlan.price,
        users: { create: { name: data.ownerName || data.ownerEmail, email: data.ownerEmail, password, role: 'OWNER', emailVerified: true, active: true } },
      },
      select: { id: true, name: true, slug: true, plan: true, status: true },
    })
    return org
  }

  /** Renomeia/edita campos básicos da org (além da assinatura). */
  async renameOrganization(id: string, data: { name?: string }) {
    const patch: Prisma.OrganizationUpdateInput = {}
    if (data.name !== undefined) patch.name = data.name
    return prisma.organization.update({ where: { id }, data: patch, select: { id: true, name: true } })
  }

  /**
   * EXCLUI a org inteira e todos os dados (cascade do schema cobre users,
   * contacts, pipelines, instâncias, campanhas, chatbots, invoices).
   * Ação destrutiva e irreversível — exige confirmação no front.
   */
  async deleteOrganization(id: string) {
    const org = await prisma.organization.findUnique({ where: { id }, select: { id: true, name: true } })
    if (!org) throw { statusCode: 404, message: 'Organização não encontrada' }
    await prisma.organization.delete({ where: { id } })
    return { ok: true, name: org.name }
  }

  // ─── DADOS / OPERAÇÃO por org ─────────────────────────────
  /** Lista recursos operacionais de uma org (contatos, campanhas, instâncias). */
  async orgData(id: string, kind: 'contacts' | 'campaigns' | 'instances', query: any) {
    const page = Math.max(1, Number(query?.page) || 1)
    const pageSize = Math.min(100, Math.max(1, Number(query?.pageSize) || 20))
    const skip = (page - 1) * pageSize
    if (kind === 'contacts') {
      const where: Prisma.ContactWhereInput = { organizationId: id }
      if (query?.q) where.OR = [{ name: { contains: String(query.q), mode: 'insensitive' } }, { phone: { contains: String(query.q) } }]
      const [total, items] = await Promise.all([
        prisma.contact.count({ where }),
        prisma.contact.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: pageSize, select: { id: true, name: true, phone: true, email: true, status: true, createdAt: true } }),
      ])
      return { total, page, pageSize, items }
    }
    if (kind === 'campaigns') {
      const where: Prisma.CampaignWhereInput = { organizationId: id }
      const [total, items] = await Promise.all([
        prisma.campaign.count({ where }),
        prisma.campaign.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: pageSize, select: { id: true, name: true, status: true, totalSent: true, totalFailed: true, createdAt: true, _count: { select: { contacts: true } } } }),
      ])
      return { total, page, pageSize, items }
    }
    const where: Prisma.WhatsappInstanceWhereInput = { organizationId: id }
    const [total, items] = await Promise.all([
      prisma.whatsappInstance.count({ where }),
      prisma.whatsappInstance.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: pageSize, select: { id: true, name: true, number: true, status: true, createdAt: true } }),
    ])
    return { total, page, pageSize, items }
  }

  /** Exclui um recurso operacional de qualquer org. */
  async deleteOrgResource(kind: 'contacts' | 'campaigns' | 'instances', resourceId: string) {
    if (kind === 'contacts') { await prisma.contact.delete({ where: { id: resourceId } }) }
    else if (kind === 'campaigns') { await prisma.campaign.delete({ where: { id: resourceId } }) }
    else { await prisma.whatsappInstance.delete({ where: { id: resourceId } }) }
    return { ok: true }
  }
}
