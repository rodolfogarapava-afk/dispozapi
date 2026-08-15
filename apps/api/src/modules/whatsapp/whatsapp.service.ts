import axios from 'axios'
import { PrismaClient } from '@prisma/client'
import { emitToOrg } from '../../common/ws-connections'
import { pauseBot, resumeBot, markPlatformSent } from '../chatbot/bot-control'
import { ChatbotService } from '../chatbot/chatbot.service'
import { classifyConversation, removeDealFromPipeline } from '../chatbot/classifier.service'
import { getPlanDefinition, planLimitMessage } from '../../common/plan-limits'
import { phoneFromJid, phonesMatch } from '../../common/phone'
import { storeBuffer } from './media.util'

const prisma = new PrismaClient()
const chatbotSvc = new ChatbotService()

function normalizeJid(input: string) {
  if (input.includes('@')) return input
  const digits = input.replace(/\D/g, '')
  return `${digits}@s.whatsapp.net`
}

const evo = axios.create({
  baseURL: process.env.EVOLUTION_API_URL,
  headers: { apikey: process.env.EVOLUTION_API_KEY },
})

export class WhatsappService {
  async createInstance(orgId: string, name: string) {
    const [organization, instanceCount] = await Promise.all([
      prisma.organization.findUnique({ where: { id: orgId }, select: { plan: true } }),
      prisma.whatsappInstance.count({ where: { organizationId: orgId } }),
    ])
    if (!organization) throw { statusCode: 404, message: 'Organização não encontrada' }
    const plan = getPlanDefinition(organization.plan)
    if (instanceCount >= plan.maxInstances) {
      throw { statusCode: 403, message: planLimitMessage(plan, 'instâncias do WhatsApp', plan.maxInstances) }
    }

    const webhookUrl = `${process.env.API_URL}/webhooks/whatsapp`
    await evo.post('/instance/create', {
      instanceName: `${orgId}_${name}`,
      integration: 'WHATSAPP-BAILEYS',
      webhook: {
        url: webhookUrl,
        byEvents: false,
        base64: false,
        events: ['MESSAGES_UPSERT', 'CONNECTION_UPDATE', 'QRCODE_UPDATED'],
      },
    })

    return prisma.whatsappInstance.create({
      data: { name, organizationId: orgId, status: 'CONNECTING' },
    })
  }

  async getQrCode(instanceId: string) {
    const inst = await prisma.whatsappInstance.findUnique({ where: { id: instanceId } })
    if (!inst) throw { statusCode: 404, message: 'Instância não encontrada' }
    const res = await evo.get(`/instance/connect/${inst.organizationId}_${inst.name}`)
    return res.data
  }

  async getStatus(instanceId: string) {
    const inst = await prisma.whatsappInstance.findUnique({ where: { id: instanceId } })
    if (!inst) throw { statusCode: 404, message: 'Instância não encontrada' }
    const res = await evo.get(`/instance/connectionState/${inst.organizationId}_${inst.name}`)
    return res.data
  }

  async listInstances(orgId: string) {
    const instances = await prisma.whatsappInstance.findMany({ where: { organizationId: orgId } })
    const updated = await Promise.all(
      instances.map(async (inst) => {
        try {
          const res = await evo.get(`/instance/connectionState/${orgId}_${inst.name}`)
          const state = res.data?.instance?.state
          const status = state === 'open' ? 'CONNECTED' : 'DISCONNECTED'
          await prisma.whatsappInstance.update({ where: { id: inst.id }, data: { status } })
          return { ...inst, status }
        } catch {
          return inst
        }
      })
    )

    return updated
  }

  async sendMessage(data: { instanceId: string; to: string; message: string; delay?: number; byBot?: boolean }) {
    const inst = await prisma.whatsappInstance.findUnique({ where: { id: data.instanceId } })
    if (!inst) throw { statusCode: 404, message: 'Instância não encontrada' }

    const remoteJid = normalizeJid(data.to)

    const res = await evo.post(`/message/sendText/${inst.organizationId}_${inst.name}`, {
      number: data.to,
      text: data.message,
      // delay em ms: a Evolution exibe "digitando..." nativamente nesse intervalo
      ...(data.delay ? { delay: data.delay, presence: 'composing' } : {}),
    })

    const evoMsgId =
      res.data?.key?.id ||
      res.data?.messageId ||
      `local_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const ts = new Date()

    // Marca como enviado pela plataforma para o webhook não tratar o eco como "humano".
    markPlatformSent(evoMsgId)

    const conv = await prisma.conversation.upsert({
      where: { instanceId_remoteJid: { instanceId: inst.id, remoteJid } },
      create: {
        instanceId: inst.id,
        remoteJid,
        pushName: remoteJid.split('@')[0],
        lastMessage: data.message,
        lastMessageAt: ts,
        unreadCount: 0,
      },
      update: { lastMessage: data.message, lastMessageAt: ts },
    })

    let saved
    try {
      saved = await prisma.message.create({
        data: {
          conversationId: conv.id,
          remoteJid,
          messageId: evoMsgId,
          content: data.message,
          fromMe: true,
          status: 'SENT',
          timestamp: ts,
        },
        select: { id: true, content: true, senderName: true, fromMe: true, status: true, timestamp: true, mediaUrl: true, mediaType: true },
      })
    } catch (e: any) {
      if (e.code !== 'P2002') throw e
      saved = await prisma.message.findUnique({
        where: { messageId: evoMsgId },
        select: { id: true, content: true, senderName: true, fromMe: true, status: true, timestamp: true, mediaUrl: true, mediaType: true },
      })
    }

    if (saved) {
      emitToOrg(inst.organizationId, 'new_message', {
        instanceId: inst.id,
        conversationId: conv.id,
        conversation: {
          id: conv.id,
          instanceId: conv.instanceId,
          remoteJid: conv.remoteJid,
          pushName: conv.pushName,
          lastMessage: conv.lastMessage,
          lastMessageAt: conv.lastMessageAt?.toISOString() ?? ts.toISOString(),
          unreadCount: conv.unreadCount,
          profilePicUrl: conv.profilePicUrl ?? null,
          isGroup: conv.remoteJid.includes('@g.us'),
        },
        message: { ...saved, timestamp: saved.timestamp.toISOString() },
      })
    }

    // Envio manual pela plataforma (não-bot) = humano atendendo → pausa o bot.
    if (!data.byBot && !conv.remoteJid.includes('@g.us')) {
      try {
        const bot = await chatbotSvc.getBot(inst.organizationId)
        await pauseBot(conv.id, 'HUMANO', bot.config.pauseHumanHours)
      } catch {
        // pausa é best-effort
      }
    }

    return { ...res.data, savedMessage: saved }
  }

  /** Envia presença ("digitando..." / "gravando...") manualmente. Usado pelo bot. */
  async sendPresence(instanceId: string, to: string, presence: 'composing' | 'recording' | 'available' | 'paused', delay = 1200) {
    const inst = await prisma.whatsappInstance.findUnique({ where: { id: instanceId } })
    if (!inst) return
    try {
      await evo.post(`/chat/sendPresence/${inst.organizationId}_${inst.name}`, {
        number: normalizeJid(to),
        presence,
        delay,
      })
    } catch {
      // presença é best-effort; ignora falhas
    }
  }

  /** Marca a conversa como lida (read receipt). Usado pelo bot para parecer humano. */
  async markAsRead(instanceId: string, remoteJid: string, messageId?: string) {
    const inst = await prisma.whatsappInstance.findUnique({ where: { id: instanceId } })
    if (!inst || !messageId) return
    try {
      await evo.post(`/chat/markMessageAsRead/${inst.organizationId}_${inst.name}`, {
        readMessages: [{ remoteJid, fromMe: false, id: messageId }],
      })
    } catch {
      // best-effort
    }
  }

  /**
   * Envia mídia (imagem/vídeo/documento) ou áudio pela plataforma.
   * `fileBase64` (sem prefixo data:) é o upload do operador; é salvo em disco,
   * mandado pra Evolution e persistido como mensagem (com mediaUrl servível).
   */
  async sendMedia(data: {
    instanceId: string
    to: string
    fileBase64: string
    mimetype: string
    caption?: string
    fileName?: string
    asAudio?: boolean
  }) {
    const inst = await prisma.whatsappInstance.findUnique({ where: { id: data.instanceId } })
    if (!inst) throw { statusCode: 404, message: 'Instância não encontrada' }

    const remoteJid = normalizeJid(data.to)
    const buffer = Buffer.from(data.fileBase64, 'base64')
    const stored = await storeBuffer(buffer, data.mimetype)
    const apiBase = `${inst.organizationId}_${inst.name}`

    // Áudio gravado usa endpoint próprio (vira PTT — nota de voz).
    if (data.asAudio || stored.kind === 'audio') {
      await evo.post(`/message/sendWhatsAppAudio/${apiBase}`, {
        number: data.to,
        audio: data.fileBase64,
      })
    } else {
      await evo.post(`/message/sendMedia/${apiBase}`, {
        number: data.to,
        mediatype: stored.kind === 'video' ? 'video' : stored.kind === 'document' ? 'document' : 'image',
        mimetype: data.mimetype,
        media: data.fileBase64,
        fileName: data.fileName || stored.file,
        ...(data.caption ? { caption: data.caption } : {}),
      })
    }

    const evoMsgId = `local_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    markPlatformSent(evoMsgId)
    const ts = new Date()
    const lastLabel = data.caption || (stored.kind === 'audio' ? '🎵 Áudio' : stored.kind === 'document' ? '📄 Documento' : stored.kind === 'video' ? '🎥 Vídeo' : '📷 Foto')

    const conv = await prisma.conversation.upsert({
      where: { instanceId_remoteJid: { instanceId: inst.id, remoteJid } },
      create: {
        instanceId: inst.id, remoteJid, pushName: remoteJid.split('@')[0],
        lastMessage: lastLabel, lastMessageAt: ts, unreadCount: 0,
      },
      update: { lastMessage: lastLabel, lastMessageAt: ts },
    })

    const saved = await prisma.message.create({
      data: {
        conversationId: conv.id, remoteJid, messageId: evoMsgId,
        content: data.caption || '', fromMe: true, status: 'SENT', timestamp: ts,
        mediaUrl: stored.url, mediaType: stored.kind,
      },
      select: { id: true, content: true, senderName: true, fromMe: true, status: true, timestamp: true, mediaUrl: true, mediaType: true },
    })

    emitToOrg(inst.organizationId, 'new_message', {
      instanceId: inst.id, conversationId: conv.id,
      conversation: {
        id: conv.id, instanceId: conv.instanceId, remoteJid: conv.remoteJid, pushName: conv.pushName,
        lastMessage: conv.lastMessage, lastMessageAt: conv.lastMessageAt?.toISOString() ?? ts.toISOString(),
        unreadCount: conv.unreadCount, profilePicUrl: conv.profilePicUrl ?? null,
        isGroup: conv.remoteJid.includes('@g.us'),
      },
      message: { ...saved, timestamp: saved.timestamp.toISOString() },
    })

    // Envio manual de mídia = humano atendendo → pausa o bot.
    if (!conv.remoteJid.includes('@g.us')) {
      try {
        const bot = await chatbotSvc.getBot(inst.organizationId)
        await pauseBot(conv.id, 'HUMANO', bot.config.pauseHumanHours)
      } catch {
        // best-effort
      }
    }

    return { savedMessage: saved }
  }

  /** Liga/desliga o bot numa conversa (pausa manual ou reativação). */
  async toggleBot(
    conversationId: string,
    orgId: string,
    data: { paused: boolean; reason?: string; hours?: number | null }
  ) {
    const conv = await prisma.conversation.findFirst({
      where: { id: conversationId, instance: { organizationId: orgId } },
      select: { id: true },
    })
    if (!conv) throw { statusCode: 404, message: 'Conversa não encontrada' }

    if (data.paused) {
      await pauseBot(conversationId, data.reason || 'MANUAL', data.hours ?? null)
    } else {
      await resumeBot(conversationId)
    }
    return prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { id: true, botPaused: true, botPausedUntil: true, botPausedReason: true },
    })
  }

  /** Classifica a conversa com IA sob demanda e move o card (botão manual). */
  async classifyConversation(conversationId: string, orgId: string) {
    const conv = await prisma.conversation.findFirst({
      where: { id: conversationId, instance: { organizationId: orgId } },
      select: { id: true },
    })
    if (!conv) throw { statusCode: 404, message: 'Conversa não encontrada' }
    const bot = await chatbotSvc.getBot(orgId)
    const result = await classifyConversation(orgId, conversationId, bot.config)
    return { result }
  }

  /**
   * Acha a conversa do org cujo remoteJid casa com o telefone (por dígitos).
   * Usado pelo modal de chat na pipeline (resolve conversa a partir do phone do card).
   */
  async getConversationByPhone(orgId: string, phone: string) {
    const digits = (phone || '').replace(/\D/g, '')
    if (!digits) throw { statusCode: 400, message: 'Telefone inválido' }

    // Pré-filtra no banco pelo núcleo de 8 dígitos (barato) e confirma com
    // phonesMatch (chave canônica: DDI/9º dígito), evitando falso positivo.
    const core = digits.slice(-8)
    const convs = await prisma.conversation.findMany({
      where: {
        instance: { organizationId: orgId },
        remoteJid: { contains: core },
        NOT: { remoteJid: { endsWith: '@g.us' } },
      },
      orderBy: { lastMessageAt: 'desc' },
      select: {
        id: true,
        instanceId: true,
        remoteJid: true,
        pushName: true,
        profilePicUrl: true,
        lastMessage: true,
        lastMessageAt: true,
        unreadCount: true,
        botPaused: true,
        botPausedUntil: true,
        botPausedReason: true,
        aiCategory: true,
      },
    })
    const conv = convs.find((c) => phonesMatch(c.remoteJid, phone))
    if (!conv) throw { statusCode: 404, message: 'Conversa não encontrada para este contato' }
    return { ...conv, isGroup: conv.remoteJid.includes('@g.us') }
  }

  /**
   * Retorna o negócio (deal) do contato da conversa + os estágios do funil do org,
   * para o menu "Funil" no header da conversa.
   */
  async getConversationPipeline(conversationId: string, orgId: string) {
    const conv = await prisma.conversation.findFirst({
      where: { id: conversationId, instance: { organizationId: orgId } },
      select: { id: true, remoteJid: true },
    })
    if (!conv) throw { statusCode: 404, message: 'Conversa não encontrada' }

    const pipeline = await prisma.pipeline.findFirst({
      where: { organizationId: orgId },
      orderBy: { createdAt: 'asc' },
      select: { stages: { orderBy: { order: 'asc' }, select: { id: true, name: true, color: true, order: true } } },
    })
    const stages = pipeline?.stages ?? []

    const deal = await this.findContactDeal(orgId, conv.remoteJid)
    return { deal, stages }
  }

  /**
   * Move (ou cria) o negócio do contato da conversa para o estágio escolhido.
   * Mesma lógica de casamento por telefone do classifier, sem nota de IA.
   */
  async moveConversationDeal(conversationId: string, orgId: string, stageId: string) {
    const conv = await prisma.conversation.findFirst({
      where: { id: conversationId, instance: { organizationId: orgId } },
      select: { id: true, remoteJid: true, pushName: true },
    })
    if (!conv) throw { statusCode: 404, message: 'Conversa não encontrada' }

    const stage = await prisma.stage.findFirst({
      where: { id: stageId, pipeline: { organizationId: orgId } },
      select: { id: true },
    })
    if (!stage) throw { statusCode: 404, message: 'Estágio não encontrado' }

    const phone = phoneFromJid(conv.remoteJid)
    let contact = await prisma.contact.findFirst({
      where: { organizationId: orgId, phone },
      select: { id: true },
    })
    if (!contact) {
      contact = await prisma.contact.create({
        data: { organizationId: orgId, name: conv.pushName || phone, phone, source: 'WhatsApp' },
        select: { id: true },
      })
    }

    // Só reaproveita deal ABERTO. Mover um ganho/perdido o ressuscitaria; nesse
    // caso criamos um card novo no estágio escolhido.
    const existing = await prisma.deal.findFirst({
      where: { contactId: contact.id, status: 'OPEN', stage: { pipeline: { organizationId: orgId } } },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    })

    const include = { contact: true, stage: true, assignedTo: { select: { id: true, name: true, avatar: true } } }
    const deal = existing
      ? await prisma.deal.update({ where: { id: existing.id }, data: { stageId }, include })
      : await prisma.deal.create({
          data: { title: conv.pushName || phone, stageId, contactId: contact.id },
          include,
        })

    emitToOrg(orgId, 'deal_updated', { deal })
    return deal
  }

  /**
   * Finaliza o negócio do contato (Ganho/Perdido) direto da conversa.
   * Marca status WON/LOST + closedAt → sai do quadro (board só mostra OPEN) e,
   * no caso WON, passa a contar receita nos relatórios. Emite deal_removed para
   * o board sumir em tempo real e zera a categoria de IA da conversa.
   */
  async finishConversationDeal(conversationId: string, orgId: string, status: 'WON' | 'LOST') {
    const conv = await prisma.conversation.findFirst({
      where: { id: conversationId, instance: { organizationId: orgId } },
      select: { id: true, remoteJid: true },
    })
    if (!conv) throw { statusCode: 404, message: 'Conversa não encontrada' }

    const deal = await this.findContactDeal(orgId, conv.remoteJid)
    if (!deal) throw { statusCode: 404, message: 'Nenhum negócio no funil para este contato' }

    await prisma.deal.update({
      where: { id: deal.id },
      data: { status, closedAt: new Date() },
    })
    await prisma.conversation.update({
      where: { id: conversationId },
      data: { aiCategory: null, aiStageSuggested: false },
    })
    emitToOrg(orgId, 'deal_removed', { dealId: deal.id })
    emitToOrg(orgId, 'conversation_ai', { conversationId, aiCategory: null })
    return { success: true, dealId: deal.id, status }
  }

  /**
   * Tira o negócio do contato do funil. Não é permanente: se o cliente voltar a
   * falar, a classificação por IA recria o card.
   */
  async removeConversationDeal(conversationId: string, orgId: string) {
    const conv = await prisma.conversation.findFirst({
      where: { id: conversationId, instance: { organizationId: orgId } },
      select: { id: true, remoteJid: true },
    })
    if (!conv) throw { statusCode: 404, message: 'Conversa não encontrada' }

    await removeDealFromPipeline(orgId, conv.remoteJid)
    await prisma.conversation.update({
      where: { id: conversationId },
      data: { aiCategory: null, aiStageSuggested: false },
    })
    emitToOrg(orgId, 'conversation_ai', { conversationId, aiCategory: null })
    return { success: true }
  }

  /** Negócio mais recente do contato (casado por telefone) no funil do org. */
  private async findContactDeal(orgId: string, remoteJid: string) {
    const phone = phoneFromJid(remoteJid)
    const contact = await prisma.contact.findFirst({
      where: { organizationId: orgId, phone },
      select: { id: true },
    })
    if (!contact) return null
    // Só o deal ABERTO interessa aqui (menu Funil / Finalizar). Um ganho/perdido
    // antigo não deve aparecer como se estivesse no funil.
    return prisma.deal.findFirst({
      where: { contactId: contact.id, status: 'OPEN', stage: { pipeline: { organizationId: orgId } } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, title: true, stageId: true, status: true, value: true },
    })
  }

  /** Lista conversas com bot pausado, agrupadas por motivo (para o painel). */
  async listPausedBots(orgId: string) {
    const convs = await prisma.conversation.findMany({
      where: {
        botPaused: true,
        instance: { organizationId: orgId },
        NOT: { remoteJid: { endsWith: '@g.us' } },
      },
      orderBy: { botPausedUntil: 'asc' },
      select: {
        id: true,
        instanceId: true,
        remoteJid: true,
        pushName: true,
        profilePicUrl: true,
        botPausedReason: true,
        botPausedUntil: true,
        aiCategory: true,
        lastMessage: true,
        lastMessageAt: true,
      },
    })
    return convs.map((c) => ({ ...c, isGroup: c.remoteJid.includes('@g.us') }))
  }

  async listConversations(orgId: string, instanceId: string, page = 1, limit = 20) {
    const instance = await prisma.whatsappInstance.findFirst({
      where: { id: instanceId, organizationId: orgId },
      select: { id: true },
    })

    if (!instance) throw { statusCode: 404, message: 'Instância não encontrada' }

    const conversations = await prisma.conversation.findMany({
      where: {
        instanceId: instance.id,
        NOT: { remoteJid: { endsWith: '@g.us' } },
      },
      orderBy: [{ lastMessageAt: 'desc' }, { updatedAt: 'desc' }],
      skip: (page - 1) * limit,
      take: limit,
      select: {
        id: true,
        instanceId: true,
        remoteJid: true,
        pushName: true,
        profilePicUrl: true,
        lastMessage: true,
        lastMessageAt: true,
        unreadCount: true,
        botPaused: true,
        botPausedUntil: true,
        botPausedReason: true,
        aiCategory: true,
      },
    })

    // Anexa a etapa do funil (deal aberto) de cada conversa, cruzando por telefone.
    const openDeals = await prisma.deal.findMany({
      where: { status: 'OPEN', stage: { pipeline: { organizationId: orgId } } },
      select: { contact: { select: { phone: true } }, stage: { select: { id: true, name: true, color: true } } },
    })
    const dealPhones = openDeals
      .filter((d) => d.contact?.phone)
      .map((d) => ({ phone: d.contact!.phone as string, stage: d.stage }))
    const stageFor = (jid: string) => {
      const hit = dealPhones.find((x) => phonesMatch(x.phone, jid))
      return hit?.stage ?? null
    }

    return conversations.map((conversation) => {
      const stage = stageFor(conversation.remoteJid)
      return {
        ...conversation,
        isGroup: conversation.remoteJid.includes('@g.us'),
        stageId: stage?.id ?? null,
        stageName: stage?.name ?? null,
        stageColor: stage?.color ?? null,
      }
    })
  }

  async getMessages(conversationId: string, orgId: string, limit = 50) {
    const conversation = await prisma.conversation.findFirst({
      where: {
        id: conversationId,
        instance: { organizationId: orgId },
      },
      select: { id: true, unreadCount: true },
    })

    if (!conversation) throw { statusCode: 404, message: 'Conversa não encontrada' }

    if (conversation.unreadCount > 0) {
      await prisma.conversation.update({
        where: { id: conversation.id },
        data: { unreadCount: 0 },
      })
    }

    const messages = await prisma.message.findMany({
      where: { conversationId: conversation.id },
      orderBy: { timestamp: 'desc' },
      take: limit,
      select: {
        id: true,
        content: true,
        senderName: true,
        fromMe: true,
        timestamp: true,
        status: true,
        mediaUrl: true,
        mediaType: true,
      },
    })

    return messages.reverse().map((message) => ({
      ...message,
      timestamp: message.timestamp.toISOString(),
    }))
  }

  async deleteInstance(instanceId: string, orgId: string) {
    const inst = await prisma.whatsappInstance.findFirst({ where: { id: instanceId, organizationId: orgId } })
    if (!inst) throw { statusCode: 404, message: 'Instância não encontrada' }
    const instName = `${inst.organizationId}_${inst.name}`

    try {
      await evo.delete(`/instance/logout/${instName}`)
    } catch (e: any) {
      if (e?.response?.status && ![401, 404].includes(e.response.status)) {
        // ignora logout falho quando já desconectada
      }
    }

    try {
      await evo.delete(`/instance/delete/${instName}`)
    } catch (e: any) {
      if (e?.response?.status !== 404) {
        throw { statusCode: 502, message: e?.response?.data?.message || 'Falha ao excluir na Evolution API' }
      }
    }

    await prisma.message.deleteMany({ where: { conversation: { instanceId } } })
    await prisma.conversation.deleteMany({ where: { instanceId } })
    await prisma.whatsappInstance.delete({ where: { id: instanceId } })
    return { success: true, id: instanceId }
  }

  async setWebhook(instanceId: string) {
    const inst = await prisma.whatsappInstance.findUnique({ where: { id: instanceId } })
    if (!inst) throw { statusCode: 404, message: 'Instância não encontrada' }
    const webhookUrl = `${process.env.API_URL}/webhooks/whatsapp`
    const res = await evo.post(`/webhook/set/${inst.organizationId}_${inst.name}`, {
      webhook: {
        enabled: true,
        url: webhookUrl,
        byEvents: false,
        base64: false,
        events: ['MESSAGES_UPSERT', 'CONNECTION_UPDATE', 'QRCODE_UPDATED'],
      },
    })
    return res.data
  }

  async syncHistory(instanceId: string, orgId: string, limitChats = 50, limitMessages = 30) {
    const inst = await prisma.whatsappInstance.findFirst({
      where: { id: instanceId, organizationId: orgId },
    })
    if (!inst) throw { statusCode: 404, message: 'Instância não encontrada' }
    const instName = `${inst.organizationId}_${inst.name}`

    const chatsRes = await evo.post(`/chat/findChats/${instName}`, {}).catch(() => ({ data: [] as any[] }))
    const chats: any[] = Array.isArray(chatsRes.data) ? chatsRes.data : []
    let convCount = 0
    let msgCount = 0

    for (const chat of chats.slice(0, limitChats)) {
      const remoteJid = chat.remoteJid || chat.id
      if (!remoteJid || remoteJid === 'status@broadcast') continue

      const isGroup = remoteJid.includes('@g.us')

      const lastMsgTs = chat.updatedAt
        ? new Date(chat.updatedAt)
        : chat.messageTimestamp
        ? new Date(chat.messageTimestamp * 1000)
        : new Date()

      // Em grupos, usar o nome real do grupo (subject), não o pushName de quem enviou.
      let convName: string | undefined = chat.pushName || chat.name || undefined
      if (isGroup) {
        const gi = await evo
          .get(`/group/findGroupInfos/${instName}?groupJid=${encodeURIComponent(remoteJid)}`)
          .catch(() => ({ data: {} as any }))
        convName = gi.data?.subject || convName
      }

      const conv = await prisma.conversation.upsert({
        where: { instanceId_remoteJid: { instanceId: inst.id, remoteJid } },
        create: {
          instanceId: inst.id,
          remoteJid,
          pushName: convName || remoteJid.split('@')[0],
          lastMessage: chat.lastMessage?.message?.conversation || null,
          lastMessageAt: lastMsgTs,
          unreadCount: chat.unreadCount || 0,
        },
        update: {
          pushName: convName,
          lastMessageAt: lastMsgTs,
        },
      })
      convCount++

      const msgsRes = await evo
        .post(`/chat/findMessages/${instName}`, {
          where: { key: { remoteJid } },
          limit: limitMessages,
        })
        .catch(() => ({ data: { messages: { records: [] } } as any }))

      const records: any[] =
        msgsRes.data?.messages?.records ||
        msgsRes.data?.records ||
        (Array.isArray(msgsRes.data) ? msgsRes.data : [])

      for (const m of records) {
        const key = m.key || {}
        const messageId = key.id || m.messageId
        if (!messageId) continue
        const content =
          m.message?.conversation ||
          m.message?.extendedTextMessage?.text ||
          m.message?.imageMessage?.caption ||
          m.message?.videoMessage?.caption ||
          (m.messageType && m.messageType !== 'conversation' ? '[mídia]' : null) ||
          '[mídia]'
        const ts = new Date((m.messageTimestamp || Date.now() / 1000) * 1000)
        const senderName = isGroup && !key.fromMe ? m.pushName || null : null
        try {
          await prisma.message.create({
            data: {
              conversationId: conv.id,
              remoteJid,
              messageId,
              content,
              senderName,
              fromMe: key.fromMe || false,
              status: 'SENT',
              timestamp: ts,
              mediaUrl: m.message?.imageMessage?.url || m.message?.videoMessage?.url || null,
              mediaType: m.messageType && m.messageType !== 'conversation' ? m.messageType : null,
            },
          })
          msgCount++
        } catch (e: any) {
          if (e.code !== 'P2002') throw e
        }
      }
    }

    return { conversations: convCount, messages: msgCount }
  }
}
