import { PrismaClient } from '@prisma/client'
import { emitToOrg } from '../../common/ws-connections'

const prisma = new PrismaClient()

// Registro de messageIds enviados PELA plataforma (bot ou atendente via UI).
// Usado para distinguir, no webhook, o eco da própria mensagem (fromMe) de uma
// resposta de humano pelo celular/WhatsApp Web. TTL curto evita vazamento.
const platformSent = new Map<string, number>()
const PLATFORM_SENT_TTL = 2 * 60 * 1000 // 2 min

export function markPlatformSent(messageId?: string): void {
  if (!messageId) return
  const now = Date.now()
  platformSent.set(messageId, now)
  // limpeza preguiçosa
  if (platformSent.size > 500) {
    for (const [id, ts] of platformSent) {
      if (now - ts > PLATFORM_SENT_TTL) platformSent.delete(id)
    }
  }
}

export function wasPlatformSent(messageId?: string): boolean {
  if (!messageId) return false
  const ts = platformSent.get(messageId)
  if (!ts) return false
  if (Date.now() - ts > PLATFORM_SENT_TTL) {
    platformSent.delete(messageId)
    return false
  }
  return true
}

// Campos de estado do bot retornados nas consultas.
const BOT_STATE_SELECT = {
  id: true,
  botPaused: true,
  botPausedUntil: true,
  botPausedReason: true,
  instance: { select: { organizationId: true } },
} as const

/**
 * Pausa o bot numa conversa. `hours` define a auto-retomada
 * (null/undefined = pausa indefinida até reativar manualmente).
 */
export async function pauseBot(
  conversationId: string,
  reason: string,
  hours?: number | null
): Promise<void> {
  const until = hours && hours > 0 ? new Date(Date.now() + hours * 3600 * 1000) : null
  const conv = await prisma.conversation.update({
    where: { id: conversationId },
    data: { botPaused: true, botPausedReason: reason, botPausedUntil: until },
    select: BOT_STATE_SELECT,
  })
  emitToOrg(conv.instance.organizationId, 'bot_paused', {
    conversationId,
    botPaused: true,
    botPausedReason: reason,
    botPausedUntil: until ? until.toISOString() : null,
  })
}

/** Reativa o bot numa conversa. */
export async function resumeBot(conversationId: string): Promise<void> {
  const conv = await prisma.conversation.update({
    where: { id: conversationId },
    data: { botPaused: false, botPausedReason: null, botPausedUntil: null },
    select: BOT_STATE_SELECT,
  })
  emitToOrg(conv.instance.organizationId, 'bot_resumed', { conversationId, botPaused: false })
}

/**
 * Verifica se o bot pode responder a conversa.
 * Se a pausa já expirou (botPausedUntil <= agora), retoma automaticamente e libera.
 * Retorna true quando o bot está liberado para responder.
 */
export async function isBotAllowed(conversationId: string): Promise<boolean> {
  const conv = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { botPaused: true, botPausedUntil: true },
  })
  if (!conv || !conv.botPaused) return true
  // Pausa indefinida → bloqueado.
  if (!conv.botPausedUntil) return false
  // Pausa expirada → auto-retoma e libera.
  if (conv.botPausedUntil.getTime() <= Date.now()) {
    await resumeBot(conversationId)
    return true
  }
  return false
}
