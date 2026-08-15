import { FastifyRequest, FastifyReply } from 'fastify'

export async function authenticate(req: FastifyRequest, reply: FastifyReply) {
  try {
    await req.jwtVerify()
  } catch (err) {
    reply.status(401).send({ statusCode: 401, error: 'Unauthorized', message: 'Token inválido ou expirado' })
  }
}
