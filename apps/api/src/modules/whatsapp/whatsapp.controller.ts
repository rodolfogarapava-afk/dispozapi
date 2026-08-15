import { FastifyRequest, FastifyReply } from 'fastify'
import { WhatsappService } from './whatsapp.service'

const svc = new WhatsappService()

export class WhatsappController {
  async listInstances(req: FastifyRequest, rep: FastifyReply) {
    return rep.send(await svc.listInstances((req as any).user.orgId))
  }
  async createInstance(req: FastifyRequest, rep: FastifyReply) {
    return rep.status(201).send(await svc.createInstance((req as any).user.orgId, (req.body as any).name))
  }
  async deleteInstance(req: FastifyRequest, rep: FastifyReply) {
    return rep.send(await svc.deleteInstance((req.params as any).id, (req as any).user.orgId))
  }
  async getQrCode(req: FastifyRequest, rep: FastifyReply) {
    return rep.send(await svc.getQrCode((req.params as any).id))
  }
  async getStatus(req: FastifyRequest, rep: FastifyReply) {
    return rep.send(await svc.getStatus((req.params as any).id))
  }
  async listConversations(req: FastifyRequest, rep: FastifyReply) {
    const { page = 1, limit = 20, instanceId } = req.query as any
    if (!instanceId) return rep.status(400).send({ message: 'instanceId é obrigatório' })
    return rep.send(await svc.listConversations((req as any).user.orgId, instanceId, Number(page), Number(limit)))
  }
  async getMessages(req: FastifyRequest, rep: FastifyReply) {
    const { conversationId } = req.params as any
    return rep.send(await svc.getMessages(conversationId, (req as any).user.orgId))
  }
  async toggleBot(req: FastifyRequest, rep: FastifyReply) {
    const { conversationId } = req.params as any
    const { paused, reason, hours } = req.body as any
    return rep.send(await svc.toggleBot(conversationId, (req as any).user.orgId, { paused, reason, hours }))
  }
  async classifyConversation(req: FastifyRequest, rep: FastifyReply) {
    const { conversationId } = req.params as any
    return rep.send(await svc.classifyConversation(conversationId, (req as any).user.orgId))
  }
  async listPausedBots(req: FastifyRequest, rep: FastifyReply) {
    return rep.send(await svc.listPausedBots((req as any).user.orgId))
  }
  async getConversationByPhone(req: FastifyRequest, rep: FastifyReply) {
    const { phone } = req.query as any
    if (!phone) return rep.status(400).send({ message: 'phone é obrigatório' })
    return rep.send(await svc.getConversationByPhone((req as any).user.orgId, phone))
  }
  async getConversationPipeline(req: FastifyRequest, rep: FastifyReply) {
    const { conversationId } = req.params as any
    return rep.send(await svc.getConversationPipeline(conversationId, (req as any).user.orgId))
  }
  async moveConversationDeal(req: FastifyRequest, rep: FastifyReply) {
    const { conversationId } = req.params as any
    const { stageId } = req.body as any
    if (!stageId) return rep.status(400).send({ message: 'stageId é obrigatório' })
    return rep.send(await svc.moveConversationDeal(conversationId, (req as any).user.orgId, stageId))
  }
  async removeConversationDeal(req: FastifyRequest, rep: FastifyReply) {
    const { conversationId } = req.params as any
    return rep.send(await svc.removeConversationDeal(conversationId, (req as any).user.orgId))
  }
  async finishConversationDeal(req: FastifyRequest, rep: FastifyReply) {
    const { conversationId } = req.params as any
    const status = String((req.body as any)?.status || '').toUpperCase()
    if (status !== 'WON' && status !== 'LOST') return rep.status(400).send({ message: 'status deve ser WON ou LOST' })
    return rep.send(await svc.finishConversationDeal(conversationId, (req as any).user.orgId, status as 'WON' | 'LOST'))
  }
  async sendMessage(req: FastifyRequest, rep: FastifyReply) {
    return rep.send(await svc.sendMessage(req.body as any))
  }
  async sendMedia(req: FastifyRequest, rep: FastifyReply) {
    return rep.send(await svc.sendMedia(req.body as any))
  }
  async setWebhook(req: FastifyRequest, rep: FastifyReply) {
    return rep.send(await svc.setWebhook((req.params as any).id))
  }
  async syncHistory(req: FastifyRequest, rep: FastifyReply) {
    const { id } = req.params as any
    return rep.send(await svc.syncHistory(id, (req as any).user.orgId))
  }
}
