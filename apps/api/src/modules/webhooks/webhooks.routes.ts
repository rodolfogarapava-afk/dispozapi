import { FastifyInstance } from 'fastify'
import { PrismaClient } from '@prisma/client'
import { emitToOrg } from '../../common/ws-connections'
import { handleInboundForBot } from '../chatbot/bot.engine'
import { pauseBot, wasPlatformSent } from '../chatbot/bot-control'
import { ChatbotService } from '../chatbot/chatbot.service'
import { downloadAndStoreMedia } from '../whatsapp/media.util'

const prisma = new PrismaClient()
const chatbotSvc = new ChatbotService()

export async function webhookRoutes(app: FastifyInstance) {
  app.post('/whatsapp', { config: { rateLimit: false } }, async (req, rep) => {
    const body = req.body as any
    const event = normalizeEventName(body.event)
    const { instance: instanceName, data } = body

    try {
      switch (event) {
        case 'messages.upsert':
          await handleMessageUpsert(instanceName, data)
          break
        case 'connection.update':
          await handleConnectionUpdate(instanceName, data)
          break
        case 'qrcode.updated':
          await handleQrCodeUpdate(instanceName, data)
          break
      }
    } catch (e: any) {
      app.log.error({ err: e.message }, 'Webhook error')
    }

    return rep.send({ ok: true })
  })

  app.post('/stripe', async (req, rep) => rep.send({ ok: true }))
}

function normalizeEventName(event?: string) {
  switch (event) {
    case 'MESSAGES_UPSERT':
      return 'messages.upsert'
    case 'CONNECTION_UPDATE':
      return 'connection.update'
    case 'QRCODE_UPDATED':
      return 'qrcode.updated'
    default:
      return event
  }
}

async function findInstance(instanceName: string) {
  const [orgId, ...parts] = instanceName.split('_')
  const name = parts.join('_')
  return prisma.whatsappInstance.findFirst({ where: { organizationId: orgId, name } })
}

async function fetchProfilePic(instanceName: string, remoteJid: string): Promise<string | null> {
  try {
    const evoUrl = process.env.EVOLUTION_API_URL
    const evoKey = process.env.EVOLUTION_API_KEY
    if (!evoUrl || !evoKey) return null
    const res = await fetch(`${evoUrl}/chat/fetchProfilePictureUrl/${instanceName}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: evoKey },
      body: JSON.stringify({ number: remoteJid }),
    })
    if (!res.ok) return null
    const json: any = await res.json()
    return json?.profilePictureUrl || null
  } catch {
    return null
  }
}

// Cache em memória do nome/foto dos grupos (evita chamar a Evolution a cada mensagem).
const groupInfoCache = new Map<string, { subject: string | null; pictureUrl: string | null; ts: number }>()
const GROUP_CACHE_TTL = 6 * 60 * 60 * 1000 // 6h

async function fetchGroupInfo(
  instanceName: string,
  groupJid: string
): Promise<{ subject: string | null; pictureUrl: string | null }> {
  const cached = groupInfoCache.get(groupJid)
  if (cached && Date.now() - cached.ts < GROUP_CACHE_TTL) {
    return { subject: cached.subject, pictureUrl: cached.pictureUrl }
  }
  try {
    const evoUrl = process.env.EVOLUTION_API_URL
    const evoKey = process.env.EVOLUTION_API_KEY
    if (!evoUrl || !evoKey) return { subject: null, pictureUrl: null }
    const res = await fetch(
      `${evoUrl}/group/findGroupInfos/${instanceName}?groupJid=${encodeURIComponent(groupJid)}`,
      { headers: { apikey: evoKey } }
    )
    if (!res.ok) return { subject: null, pictureUrl: null }
    const json: any = await res.json()
    const info = { subject: json?.subject || null, pictureUrl: json?.pictureUrl || null }
    groupInfoCache.set(groupJid, { ...info, ts: Date.now() })
    return info
  } catch {
    return { subject: null, pictureUrl: null }
  }
}

async function handleMessageUpsert(instanceName: string, data: any) {
  const inst = await findInstance(instanceName)
  if (!inst) return

  const { key, message, messageType, messageTimestamp, pushName } = data
  if (!key?.remoteJid || key.remoteJid === 'status@broadcast') return

  // Detecta se a mensagem tem mídia e baixa o conteúdo real (descriptografado).
  const hasMedia = !!(
    message?.imageMessage ||
    message?.audioMessage ||
    message?.videoMessage ||
    message?.documentMessage ||
    message?.stickerMessage
  )
  let stored = null as Awaited<ReturnType<typeof downloadAndStoreMedia>> | null
  if (hasMedia) {
    stored = await downloadAndStoreMedia(instanceName, data)
  }

  const caption =
    message?.conversation ||
    message?.extendedTextMessage?.text ||
    message?.imageMessage?.caption ||
    message?.videoMessage?.caption ||
    message?.documentMessage?.caption ||
    ''

  // content: legenda se houver; senão um rótulo amigável por tipo (não some no chat).
  const docName = message?.documentMessage?.fileName
  const content =
    caption ||
    (stored?.kind === 'image' ? '📷 Foto' :
     stored?.kind === 'audio' ? '🎵 Áudio' :
     stored?.kind === 'video' ? '🎥 Vídeo' :
     stored?.kind === 'document' ? `📄 ${docName || 'Documento'}` :
     (messageType && messageType !== 'conversation' ? '[mídia]' : '[mídia]'))

  const timestamp = new Date((messageTimestamp || Date.now() / 1000) * 1000)
  const isGroup = key.remoteJid.includes('@g.us')

  // Em grupos, o pushName do webhook é o nome de QUEM ENVIOU (participante), não o do grupo.
  const senderName = isGroup && !key.fromMe ? pushName || undefined : undefined

  const existing = await prisma.conversation.findUnique({
    where: { instanceId_remoteJid: { instanceId: inst.id, remoteJid: key.remoteJid } },
    select: { id: true, pushName: true, profilePicUrl: true },
  })

  // Nome/foto da CONVERSA: grupo → subject/foto do grupo; individual → pushName/foto do contato.
  let convName: string | undefined
  let profilePicUrl = existing?.profilePicUrl ?? null
  if (isGroup) {
    const info = await fetchGroupInfo(instanceName, key.remoteJid)
    convName = info.subject ?? undefined
    if (!profilePicUrl && info.pictureUrl) profilePicUrl = info.pictureUrl
  } else {
    convName = !key.fromMe && pushName ? pushName : undefined
    if (!profilePicUrl) profilePicUrl = await fetchProfilePic(instanceName, key.remoteJid)
  }

  const conv = await prisma.conversation.upsert({
    where: { instanceId_remoteJid: { instanceId: inst.id, remoteJid: key.remoteJid } },
    create: {
      instanceId: inst.id,
      remoteJid: key.remoteJid,
      pushName: convName || (isGroup ? 'Grupo' : key.remoteJid.split('@')[0]),
      profilePicUrl,
      lastMessage: content,
      lastMessageAt: timestamp,
      unreadCount: key.fromMe ? 0 : 1,
    },
    update: {
      pushName: convName ?? undefined,
      profilePicUrl: profilePicUrl ?? undefined,
      lastMessage: content,
      lastMessageAt: timestamp,
      unreadCount: key.fromMe ? 0 : { increment: 1 },
    },
  })

  let msg
  try {
    msg = await prisma.message.create({
      data: {
        conversationId: conv.id,
        remoteJid: key.remoteJid,
        messageId: key.id,
        content,
        senderName,
        fromMe: key.fromMe || false,
        status: 'SENT',
        timestamp,
        mediaUrl: stored?.url || null,
        mediaType: stored?.kind || (messageType !== 'conversation' ? messageType : null),
      },
      select: {
        id: true,
        content: true,
        senderName: true,
        fromMe: true,
        status: true,
        timestamp: true,
        mediaUrl: true,
        mediaType: true,
      },
    })
  } catch (e: any) {
    // P2002 = mensagem já existe (foi enviada pela plataforma e o webhook é só o eco). Ignora.
    if (e.code === 'P2002') return
    throw e
  }

  // Mensagem fromMe que chega NOVA aqui (não-dedupada) e que NÃO foi enviada pela
  // plataforma = humano respondeu pelo celular / WhatsApp Web → pausa o bot.
  if ((key.fromMe || false) && !isGroup && !wasPlatformSent(key.id)) {
    try {
      const bot = await chatbotSvc.getBot(inst.organizationId)
      await pauseBot(conv.id, 'HUMANO', bot.config.pauseHumanHours)
    } catch {
      // best-effort
    }
  }

  emitToOrg(inst.organizationId, 'new_message', {
    instanceId: inst.id,
    conversationId: conv.id,
    conversation: {
      id: conv.id,
      instanceId: conv.instanceId,
      remoteJid: conv.remoteJid,
      pushName: conv.pushName,
      lastMessage: conv.lastMessage,
      lastMessageAt: conv.lastMessageAt?.toISOString() ?? timestamp.toISOString(),
      unreadCount: conv.unreadCount,
      profilePicUrl: conv.profilePicUrl,
      isGroup,
    },
    message: {
      ...msg,
      timestamp: msg.timestamp.toISOString(),
    },
  })

  // Dispara o bot de IA (debounce interno; ignora mensagens próprias e grupos conforme config).
  handleInboundForBot({
    organizationId: inst.organizationId,
    instanceId: inst.id,
    conversationId: conv.id,
    remoteJid: key.remoteJid,
    messageId: key.id,
    fromMe: key.fromMe || false,
    isGroup,
  }).catch(() => {})
}

async function handleConnectionUpdate(instanceName: string, data: any) {
  const inst = await findInstance(instanceName)
  if (!inst) return

  const state = data?.state
  const status = state === 'open' ? 'CONNECTED' : state === 'connecting' ? 'CONNECTING' : 'DISCONNECTED'

  await prisma.whatsappInstance.update({ where: { id: inst.id }, data: { status } })

  emitToOrg(inst.organizationId, 'connection_update', { instanceId: inst.id, status })
}

async function handleQrCodeUpdate(instanceName: string, data: any) {
  const inst = await findInstance(instanceName)
  if (!inst) return

  const base64 = data?.qrcode?.base64
  if (!base64) return

  await prisma.whatsappInstance.update({
    where: { id: inst.id },
    data: { qrCode: base64, status: 'CONNECTING' },
  })

  emitToOrg(inst.organizationId, 'qrcode_updated', { instanceId: inst.id, qrCode: base64 })
}
