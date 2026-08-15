import { FastifyInstance } from 'fastify'
import { createReadStream } from 'fs'
import { stat } from 'fs/promises'
import { WhatsappController } from './whatsapp.controller'
import { resolveMediaPath } from './media.util'

const MIME_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif',
  ogg: 'audio/ogg', mp3: 'audio/mpeg', m4a: 'audio/mp4', amr: 'audio/amr',
  mp4: 'video/mp4', pdf: 'application/pdf',
}

export async function whatsappRoutes(app: FastifyInstance) {
  const ctrl = new WhatsappController()
  const auth = { preHandler: [app.authenticate] }

  // Mídia servida publicamente (sem auth) para <img>/<audio>/<a download> funcionarem.
  // Nome de arquivo é aleatório (16 bytes) — não enumerável.
  app.get('/media/:file', async (req, rep) => {
    const { file } = req.params as any
    const abs = resolveMediaPath(file)
    if (!abs) return rep.status(400).send({ message: 'inválido' })
    try {
      await stat(abs)
    } catch {
      return rep.status(404).send({ message: 'não encontrado' })
    }
    const ext = (file.split('.').pop() || '').toLowerCase()
    rep.header('Content-Type', MIME_BY_EXT[ext] || 'application/octet-stream')
    rep.header('Cache-Control', 'public, max-age=31536000, immutable')
    return rep.send(createReadStream(abs))
  })

  app.get('/instances', auth, ctrl.listInstances.bind(ctrl))
  app.post('/instances', auth, ctrl.createInstance.bind(ctrl))
  app.delete('/instances/:id', auth, ctrl.deleteInstance.bind(ctrl))
  app.get('/instances/:id/qrcode', auth, ctrl.getQrCode.bind(ctrl))
  app.get('/instances/:id/status', auth, ctrl.getStatus.bind(ctrl))
  app.get('/conversations', auth, ctrl.listConversations.bind(ctrl))
  app.get('/conversations/by-phone', auth, ctrl.getConversationByPhone.bind(ctrl))
  app.get('/conversations/:conversationId/messages', auth, ctrl.getMessages.bind(ctrl))
  app.patch('/conversations/:conversationId/bot', auth, ctrl.toggleBot.bind(ctrl))
  app.post('/conversations/:conversationId/classify', auth, ctrl.classifyConversation.bind(ctrl))
  app.get('/conversations/:conversationId/pipeline', auth, ctrl.getConversationPipeline.bind(ctrl))
  app.patch('/conversations/:conversationId/pipeline', auth, ctrl.moveConversationDeal.bind(ctrl))
  app.delete('/conversations/:conversationId/pipeline', auth, ctrl.removeConversationDeal.bind(ctrl))
  app.post('/conversations/:conversationId/pipeline/finish', auth, ctrl.finishConversationDeal.bind(ctrl))
  app.get('/bot/paused', auth, ctrl.listPausedBots.bind(ctrl))
  app.post('/send', auth, ctrl.sendMessage.bind(ctrl))
  app.post('/send-media', auth, ctrl.sendMedia.bind(ctrl))
  app.post('/instances/:id/webhook', auth, ctrl.setWebhook.bind(ctrl))
  app.post('/instances/:id/sync', auth, ctrl.syncHistory.bind(ctrl))
}
