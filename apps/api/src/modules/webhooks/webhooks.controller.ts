import { FastifyRequest, FastifyReply } from 'fastify'

export class WebhookController {
  async handleWhatsapp(req: FastifyRequest, rep: FastifyReply) {
    return rep.status(410).send({ message: 'Use /webhooks/whatsapp configurado em webhooks.routes.ts' })
  }

  async handleStripe(req: FastifyRequest, rep: FastifyReply) {
    return rep.send({ ok: true })
  }
}
