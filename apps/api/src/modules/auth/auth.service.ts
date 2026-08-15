import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'
import { FastifyInstance } from 'fastify'
const prisma = new PrismaClient()

export class AuthService {
  async register(data: { name: string; email: string; password: string; orgName: string }) {
    const exists = await prisma.user.findUnique({ where: { email: data.email } })
    if (exists) throw { statusCode: 400, message: 'Email já cadastrado' }
    const slug = data.orgName.toLowerCase().replace(/\s+/g, '-') + '-' + Date.now()
    const org = await prisma.organization.create({ data: { name: data.orgName, slug } })
    const hashed = await bcrypt.hash(data.password, 12)
    const user = await prisma.user.create({
      data: { name: data.name, email: data.email, password: hashed, role: 'OWNER', organizationId: org.id },
      select: { id: true, name: true, email: true, role: true, organizationId: true }
    })
    return { user, organization: org }
  }
  async login(data: { email: string; password: string }, app: FastifyInstance) {
    const user = await prisma.user.findUnique({ where: { email: data.email }, include: { organization: true } })
    if (!user || !(await bcrypt.compare(data.password, user.password)))
      throw { statusCode: 401, message: 'Credenciais inválidas' }
    if (!user.active) throw { statusCode: 403, message: 'Conta desativada' }
    const token = app.jwt.sign({ sub: user.id, orgId: user.organizationId, role: user.role, isSuperAdmin: user.isSuperAdmin }, { expiresIn: '7d' })
    const { password: _p, ...safeUser } = user
    return { token, user: safeUser }
  }
  async me(userId: string) {
    return prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, email: true, role: true, isSuperAdmin: true, avatar: true, organizationId: true, organization: true }
    })
  }
  /** Atualiza nome/email/avatar do usuário logado. */
  async updateProfile(userId: string, data: { name?: string; email?: string; avatar?: string }) {
    if (data.email) {
      const exists = await prisma.user.findFirst({ where: { email: data.email, id: { not: userId } } })
      if (exists) throw { statusCode: 400, message: 'Email já está em uso' }
    }
    return prisma.user.update({
      where: { id: userId },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.email !== undefined ? { email: data.email } : {}),
        ...(data.avatar !== undefined ? { avatar: data.avatar } : {}),
      },
      select: { id: true, name: true, email: true, role: true, avatar: true, organizationId: true },
    })
  }

  /** Troca a senha conferindo a senha atual. */
  async changePassword(userId: string, data: { currentPassword: string; newPassword: string }) {
    const user = await prisma.user.findUnique({ where: { id: userId } })
    if (!user) throw { statusCode: 404, message: 'Usuário não encontrado' }
    if (!(await bcrypt.compare(data.currentPassword || '', user.password)))
      throw { statusCode: 400, message: 'Senha atual incorreta' }
    if (!data.newPassword || data.newPassword.length < 6)
      throw { statusCode: 400, message: 'A nova senha deve ter ao menos 6 caracteres' }
    const hashed = await bcrypt.hash(data.newPassword, 12)
    await prisma.user.update({ where: { id: userId }, data: { password: hashed } })
    return { message: 'Senha alterada' }
  }

  /** Renomeia a organização (apenas OWNER/ADMIN/MANAGER). */
  async updateOrganization(orgId: string, role: string, data: { name?: string }) {
    if (!['OWNER', 'ADMIN', 'MANAGER'].includes(role))
      throw { statusCode: 403, message: 'Sem permissão para alterar a organização' }
    if (!data.name?.trim()) throw { statusCode: 400, message: 'Nome inválido' }
    return prisma.organization.update({
      where: { id: orgId },
      data: { name: data.name.trim() },
      select: { id: true, name: true, slug: true },
    })
  }

  async forgotPassword(email: string) { console.log('Forgot:', email) }
  async refresh(data: any, app: FastifyInstance) {
    const decoded = app.jwt.verify(data.token) as any
    return { token: app.jwt.sign({ sub: decoded.sub, orgId: decoded.orgId, role: decoded.role, isSuperAdmin: decoded.isSuperAdmin }, { expiresIn: '7d' }) }
  }
}
