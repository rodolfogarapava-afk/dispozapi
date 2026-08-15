import { PrismaClient } from '@prisma/client'
import { ChatbotService, BotConfig } from './chatbot.service'
import { WhatsappService } from '../whatsapp/whatsapp.service'
import { AiMessage } from './ai.service'
import { isBotAllowed, pauseBot } from './bot-control'
import { classifyConversation } from './classifier.service'
import { canBotRespond, recordBotSend } from './rate-limit'
import { readMediaBase64 } from '../whatsapp/media.util'
import { extractPdfText, fileFromMediaUrl } from './pdf.util'

const prisma = new PrismaClient()
const chatbotSvc = new ChatbotService()
const whatsappSvc = new WhatsappService()

const sleep = (ms: number) => new Promise((r) => setTimeout(r, Math.max(0, ms)))
const rand = (min: number, max: number) => Math.floor(min + Math.random() * Math.max(0, max - min))

// Remove acentos e normaliza para comparação insensível a caixa/diacríticos.
const normalize = (s: string) =>
  (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

// Quebra o texto de gatilhos (linhas ou vírgulas) numa lista normalizada.
function parseKeywords(raw: string): string[] {
  return (raw || '')
    .split(/[\n,]+/)
    .map((k) => normalize(k.trim()))
    .filter(Boolean)
}

// Verifica se a mensagem contém algum gatilho de pausa.
function matchesPauseKeyword(message: string, raw: string): boolean {
  const keywords = parseKeywords(raw)
  if (keywords.length === 0) return false
  const text = normalize(message)
  return keywords.some((k) => text.includes(k))
}

interface PendingJob {
  timer: NodeJS.Timeout
  lastMessageId?: string
}

type InboundParams = {
  organizationId: string
  instanceId: string
  conversationId: string
  remoteJid: string
  messageId?: string
  fromMe: boolean
  isGroup: boolean
}

// Debounce por conversa: agrega rajadas de mensagens antes de responder.
const pending = new Map<string, PendingJob>()
// Conversas com runBot em andamento — evita disparar uma 2ª resposta para
// mensagens que chegam ENQUANTO o bot ainda está respondendo.
const processing = new Set<string>()
// Última mensagem chegada DURANTE o processamento: ao terminar, re-arma o
// debounce uma única vez para responder o conjunto novo, já com o contexto atualizado.
const queued = new Map<string, InboundParams>()
// Janela de silêncio antes de responder à rajada. Pessoas reais mandam várias
// mensagens com pausas de alguns segundos entre elas — esperar mais agrega tudo
// numa resposta só, em vez de uma por mensagem.
const DEBOUNCE_MS = 9000

function isWithinBusinessHours(config: BotConfig): boolean {
  if (!config.onlyBusinessHours) return true
  const now = new Date()
  const [sh, sm] = config.businessStart.split(':').map(Number)
  const [eh, em] = config.businessEnd.split(':').map(Number)
  const mins = now.getHours() * 60 + now.getMinutes()
  const start = (sh || 0) * 60 + (sm || 0)
  const end = (eh || 0) * 60 + (em || 0)
  return mins >= start && mins <= end
}

/**
 * Ponto de entrada chamado pelo webhook quando chega uma mensagem do cliente.
 * Faz debounce e dispara a resposta do bot.
 */
export async function handleInboundForBot(params: InboundParams) {
  const { organizationId, instanceId, conversationId, remoteJid, fromMe, isGroup } = params
  if (fromMe) return

  const bot = await chatbotSvc.getBot(organizationId)
  if (!bot.active) return

  const config = bot.config
  if (isGroup && !config.replyToGroups) return

  // Gate: se o bot está pausado nesta conversa (humano atendendo, venda fechada, etc.),
  // não responde. Pausas expiradas são retomadas automaticamente aqui dentro.
  const allowed = await isBotAllowed(conversationId)
  if (!allowed) return

  const key = `${instanceId}:${remoteJid}`

  // Se o bot já está respondendo esta conversa, NÃO dispara um 2º runBot.
  // Guarda a mensagem mais recente; quando o runBot atual terminar, re-arma o
  // debounce uma vez para responder o que chegou no meio (com o contexto novo).
  if (processing.has(key)) {
    queued.set(key, params)
    return
  }

  scheduleRun(key, config, params)
}

// (Re)arma o debounce para a conversa. Cada mensagem nova reseta o timer; só
// após DEBOUNCE_MS de silêncio o bot junta a rajada e responde uma única vez.
function scheduleRun(key: string, config: BotConfig, params: InboundParams) {
  const { organizationId, instanceId, conversationId, remoteJid, messageId } = params

  const existing = pending.get(key)
  if (existing) clearTimeout(existing.timer)

  const timer = setTimeout(() => {
    pending.delete(key)
    processing.add(key)
    runBot({ config, organizationId, instanceId, conversationId, remoteJid, messageId })
      .catch(() => {})
      .finally(() => {
        processing.delete(key)

        // Análise IA (classificação → pipeline, pausa por situação, remoção quando
        // resolvido). Não bloqueia a resposta do bot.
        if (config.autoClassify || config.pauseAiEnabled || config.removeOnResolved) {
          classifyConversation(organizationId, conversationId, config).catch(() => {})
        }

        // Chegou mensagem durante o processamento? Re-arma uma vez para responder
        // o conjunto novo de uma só vez, já com o histórico atualizado.
        const next = queued.get(key)
        if (next) {
          queued.delete(key)
          scheduleRun(key, config, next)
        }
      })
  }, DEBOUNCE_MS)

  pending.set(key, { timer, lastMessageId: messageId })
}

async function runBot(ctx: {
  config: BotConfig
  organizationId: string
  instanceId: string
  conversationId: string
  remoteJid: string
  messageId?: string
}) {
  const { config, instanceId, conversationId, remoteJid, messageId } = ctx
  const floodKey = `${instanceId}:${remoteJid}`

  // Anti-flood: se o bot já respondeu demais nesta conversa, segura a resposta.
  if (config.antiFloodEnabled && !canBotRespond(floodKey, config)) return

  // Fora do horário comercial → responde mensagem fixa (uma vez por rajada).
  if (!isWithinBusinessHours(config)) {
    if (config.outOfHoursMessage) {
      await whatsappSvc.sendMessage({ instanceId, to: remoteJid, message: config.outOfHoursMessage, byBot: true })
    }
    return
  }

  // Carrega histórico recente da conversa (com mídia).
  const rows = await prisma.message.findMany({
    where: { conversationId },
    orderBy: { timestamp: 'desc' },
    take: config.historyLimit,
    select: { content: true, fromMe: true, mediaUrl: true, mediaType: true },
  })
  const ordered = rows.reverse()

  // A última mensagem do cliente é a "incoming"; o resto vira histórico.
  let incoming = ''
  let lastMedia: { kind: string; url: string } | null = null
  const history: AiMessage[] = []
  for (let i = 0; i < ordered.length; i++) {
    const m = ordered[i]
    const isLast = i === ordered.length - 1
    if (isLast && !m.fromMe) {
      incoming = m.content
      if (m.mediaUrl && m.mediaType) lastMedia = { kind: m.mediaType, url: m.mediaUrl }
    } else {
      history.push({ role: m.fromMe ? 'assistant' : 'user', content: m.content || '[mídia]' })
    }
  }
  if (!incoming) {
    const lastUser = [...ordered].reverse().find((m) => !m.fromMe)
    incoming = lastUser?.content || ''
  }
  // Sem texto E sem mídia processável → nada a fazer.
  const hasProcessableMedia =
    !!lastMedia && (lastMedia.kind === 'image' || lastMedia.kind === 'document')
  if ((!incoming || incoming === '[mídia]') && !hasProcessableMedia) return

  // ── Pausa automática por palavra-chave ────────────────────────────
  // Se a mensagem contém um gatilho configurado, pausa o bot e não responde.
  if (incoming && config.autoPauseEnabled && matchesPauseKeyword(incoming, config.pauseKeywords)) {
    await pauseBot(conversationId, 'PALAVRA-CHAVE', config.autoPauseHours).catch(() => {})
    return
  }

  // ── Comportamento humano: simula leitura ──────────────────────────
  if (config.humanize) {
    await sleep(rand(config.readDelayMinMs, config.readDelayMaxMs))
    await whatsappSvc.markAsRead(instanceId, remoteJid, messageId)
  }

  // ── Prepara mídia para a IA (visão de imagem / leitura de PDF) ─────
  let mediaForAi: { kind: 'image' | 'document'; base64?: string; mimetype?: string; extractedText?: string } | undefined
  if (hasProcessableMedia && lastMedia) {
    const file = fileFromMediaUrl(lastMedia.url)
    if (lastMedia.kind === 'image' && config.visionEnabled && file) {
      const read = await readMediaBase64(file)
      if (read) mediaForAi = { kind: 'image', base64: read.base64, mimetype: read.mimetype }
    } else if (lastMedia.kind === 'document' && config.readPdfEnabled && file) {
      const text = await extractPdfText(file)
      if (text) mediaForAi = { kind: 'document', extractedText: text }
    }
  }

  // ── Gera a resposta ───────────────────────────────────────────────
  const reply = await chatbotSvc.generateReply(config, history, incoming, mediaForAi)
  if (!reply) return

  const bubbles = chatbotSvc.splitReply(reply, config.splitMode)

  // ── Envia cada bolha com "digitando..." + delay proporcional ──────
  for (let i = 0; i < bubbles.length; i++) {
    const bubble = bubbles[i]

    let typingMs = 0
    if (config.typing) {
      typingMs = Math.round((bubble.length / Math.max(1, config.typingCharsPerSec)) * 1000)
      typingMs = Math.min(config.typingMaxMs, Math.max(config.typingMinMs, typingMs))
    }

    // pausa entre bolhas (além do tempo de digitação) para parecer natural
    if (i > 0 && config.humanize) {
      await sleep(rand(config.bubbleDelayMinMs, config.bubbleDelayMaxMs))
    }

    // O delay do sendText faz a Evolution exibir "digitando..." nativamente.
    await whatsappSvc.sendMessage({
      instanceId,
      to: remoteJid,
      message: bubble,
      delay: config.typing ? typingMs : undefined,
      byBot: true,
    })

    // Registra o envio para o controle anti-flood.
    recordBotSend(floodKey)
  }
}
