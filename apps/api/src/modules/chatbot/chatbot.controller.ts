import { FastifyRequest, FastifyReply } from 'fastify'
import { ChatbotService, mergeConfig } from './chatbot.service'
import { AiMessage } from './ai.service'

const svc = new ChatbotService()

export class ChatbotController {
  async get(req: FastifyRequest, rep: FastifyReply) {
    return rep.send(await svc.getBot((req as any).user.orgId))
  }

  async save(req: FastifyRequest, rep: FastifyReply) {
    const body = req.body as any
    return rep.send(
      await svc.saveBot((req as any).user.orgId, {
        name: body.name,
        active: body.active,
        config: body.config,
      })
    )
  }

  /**
   * Preview funcional: gera a resposta do bot para uma mensagem de teste,
   * usando a config enviada (ainda não salva) e o histórico do preview.
   * Retorna também as "bolhas" e os tempos simulados de digitação.
   */
  async test(req: FastifyRequest, rep: FastifyReply) {
    const body = req.body as any
    const config = mergeConfig(body.config)
    const history: AiMessage[] = Array.isArray(body.history)
      ? body.history
          .filter((m: any) => m && m.content)
          .map((m: any) => ({
            role: m.role === 'assistant' ? 'assistant' : 'user',
            content: String(m.content),
          }))
      : []
    const message = String(body.message || '').trim()
    if (!message) return rep.status(400).send({ message: 'Mensagem é obrigatória' })

    const reply = await svc.generateReply(config, history, message)
    const bubbles = svc.splitReply(reply, config.splitMode)

    const bubblesWithTiming = bubbles.map((text) => {
      let typingMs = 0
      if (config.typing) {
        typingMs = Math.round((text.length / Math.max(1, config.typingCharsPerSec)) * 1000)
        typingMs = Math.min(config.typingMaxMs, Math.max(config.typingMinMs, typingMs))
      }
      return { text, typingMs }
    })

    return rep.send({ reply, bubbles: bubblesWithTiming })
  }
}
