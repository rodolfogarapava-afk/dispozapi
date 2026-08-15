import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'
import { getPlanDefinition, planLimitMessage } from '../../common/plan-limits'
const prisma = new PrismaClient()

const ROLES = ['OWNER', 'ADMIN', 'MANAGER', 'MEMBER']

function assertManager(role: string) {
  if (!['OWNER', 'ADMIN'].includes(role))
    throw { statusCode: 403, message: 'Apenas administradores podem gerenciar a equipe' }
}

export class TeamService {
  /** Lista atendentes da org com nº de deals atribuídos. */
  async list(orgId: string) {
    const users = await prisma.user.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true, name: true, email: true, role: true, avatar: true, active: true, createdAt: true,
        _count: { select: { assignedDeals: true } },
      },
    })
    return users.map((u) => ({ ...u, dealsCount: u._count.assignedDeals, _count: undefined }))
  }

  /** Cria um novo atendente na org (senha com bcrypt). */
  async create(orgId: string, role: string, data: { name: string; email: string; password: string; role?: string }) {
    assertManager(role)
    if (!data.name?.trim() || !data.email?.trim() || !data.password)
      throw { statusCode: 400, message: 'Nome, email e senha são obrigatórios' }
    if (data.password.length < 6) throw { statusCode: 400, message: 'Senha deve ter ao menos 6 caracteres' }
    const exists = await prisma.user.findUnique({ where: { email: data.email } })
    if (exists) throw { statusCode: 400, message: 'Email já cadastrado' }
    const [organization, activeUsers] = await Promise.all([
      prisma.organization.findUnique({ where: { id: orgId }, select: { plan: true } }),
      prisma.user.count({ where: { organizationId: orgId, active: true } }),
    ])
    if (!organization) throw { statusCode: 404, message: 'Organização não encontrada' }
    const plan = getPlanDefinition(organization.plan)
    if (activeUsers >= plan.maxTeamUsers) {
      throw { statusCode: 403, message: planLimitMessage(plan, 'usuários ativos na equipe', plan.maxTeamUsers) }
    }
    const newRole = ROLES.includes(data.role || '') && data.role !== 'OWNER' ? data.role! : 'MEMBER'
    const hashed = await bcrypt.hash(data.password, 12)
    return prisma.user.create({
      data: { name: data.name.trim(), email: data.email.trim(), password: hashed, role: newRole as any, organizationId: orgId },
      select: { id: true, name: true, email: true, role: true, avatar: true, active: true },
    })
  }

  /** Edita nome/role/active de um atendente da org. */
  async update(id: string, orgId: string, actorRole: string, data: { name?: string; role?: string; active?: boolean }) {
    assertManager(actorRole)
    const target = await prisma.user.findFirst({ where: { id, organizationId: orgId } })
    if (!target) throw { statusCode: 404, message: 'Atendente não encontrado' }
    if (target.role === 'OWNER' && (data.role && data.role !== 'OWNER'))
      throw { statusCode: 400, message: 'Não é possível rebaixar o dono da conta' }
    if (target.role === 'OWNER' && data.active === false)
      throw { statusCode: 400, message: 'Não é possível desativar o dono da conta' }
    if (data.active === true && !target.active) {
      const [organization, activeUsers] = await Promise.all([
        prisma.organization.findUnique({ where: { id: orgId }, select: { plan: true } }),
        prisma.user.count({ where: { organizationId: orgId, active: true } }),
      ])
      if (!organization) throw { statusCode: 404, message: 'Organização não encontrada' }
      const plan = getPlanDefinition(organization.plan)
      if (activeUsers >= plan.maxTeamUsers) {
        throw { statusCode: 403, message: planLimitMessage(plan, 'usuários ativos na equipe', plan.maxTeamUsers) }
      }
    }
    return prisma.user.update({
      where: { id },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.role !== undefined && data.role !== 'OWNER' ? { role: data.role as any } : {}),
        ...(data.active !== undefined ? { active: data.active } : {}),
      },
      select: { id: true, name: true, email: true, role: true, avatar: true, active: true },
    })
  }

  /** Desativa um atendente (soft delete — preserva histórico). */
  async remove(id: string, orgId: string, actorRole: string, actorId: string) {
    assertManager(actorRole)
    if (id === actorId) throw { statusCode: 400, message: 'Você não pode remover a si mesmo' }
    const target = await prisma.user.findFirst({ where: { id, organizationId: orgId } })
    if (!target) throw { statusCode: 404, message: 'Atendente não encontrado' }
    if (target.role === 'OWNER') throw { statusCode: 400, message: 'Não é possível remover o dono da conta' }
    await prisma.user.update({ where: { id }, data: { active: false } })
    return { message: 'Atendente desativado' }
  }
}
