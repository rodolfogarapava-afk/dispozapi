import { FastifyRequest, FastifyReply } from 'fastify'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

/**
 * Barra acesso a quem não for super-admin de plataforma.
 * Roda SEMPRE depois de `app.authenticate` (precisa do token já verificado).
 */
export async function requireSuperAdmin(req: FastifyRequest, reply: FastifyReply) {
  const tokenUser = (req as any).user
  const currentUser = tokenUser?.sub
    ? await prisma.user.findUnique({
        where: { id: tokenUser.sub },
        select: { active: true, isSuperAdmin: true },
      })
    : null

  if (!currentUser?.active || !currentUser.isSuperAdmin) {
    return reply.status(403).send({ statusCode: 403, error: 'Forbidden', message: 'Acesso restrito ao administrador da plataforma' })
  }
}
