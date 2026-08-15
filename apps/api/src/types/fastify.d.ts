import 'fastify'
import { FastifyRequest, FastifyReply } from 'fastify'

declare module 'fastify' {
  interface FastifyInstance {
    authenticate(req: FastifyRequest, reply: FastifyReply): Promise<void>
    requireSuperAdmin(req: FastifyRequest, reply: FastifyReply): Promise<void>
  }
}
