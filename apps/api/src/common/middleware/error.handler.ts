import { FastifyError, FastifyRequest, FastifyReply } from 'fastify'

export function errorHandler(error: FastifyError, req: FastifyRequest, reply: FastifyReply) {
  const statusCode = error.statusCode || 500
  req.log.error(error)
  reply.status(statusCode).send({
    statusCode,
    error: error.name || 'Internal Server Error',
    message: error.message || 'Erro interno do servidor',
    timestamp: new Date().toISOString(),
  })
}
