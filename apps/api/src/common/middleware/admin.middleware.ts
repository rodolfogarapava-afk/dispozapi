import { FastifyRequest, FastifyReply } from 'fastify'

/**
 * Barra acesso a quem não for super-admin de plataforma.
 * Roda SEMPRE depois de `app.authenticate` (precisa do token já verificado).
 */
export async function requireSuperAdmin(req: FastifyRequest, reply: FastifyReply) {
  const user = (req as any).user
  if (!user?.isSuperAdmin) {
    reply.status(403).send({ statusCode: 403, error: 'Forbidden', message: 'Acesso restrito ao administrador da plataforma' })
  }
}
