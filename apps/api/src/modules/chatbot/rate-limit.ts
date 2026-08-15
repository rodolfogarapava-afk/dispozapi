// Anti-flood do bot: limita a rajada de respostas por conversa.
// Estado em memória (chave `instanceId:remoteJid`), no mesmo estilo do platformSent.

interface FloodState {
  sends: number[] // timestamps (ms) dos últimos envios do bot
}

const states = new Map<string, FloodState>()
const WINDOW_MS = 60 * 1000 // janela de 1 minuto

interface FloodConfig {
  floodMinIntervalMs: number
  floodMaxPerMinute: number
}

function prune(sends: number[], now: number): number[] {
  return sends.filter((t) => now - t < WINDOW_MS)
}

/**
 * Retorna true se o bot pode responder agora nesta conversa.
 * Bloqueia se: último envio foi há menos de floodMinIntervalMs, OU
 * já houve floodMaxPerMinute envios na última janela de 60s.
 */
export function canBotRespond(key: string, config: FloodConfig): boolean {
  const now = Date.now()
  const state = states.get(key)
  if (!state) return true

  const recent = prune(state.sends, now)
  state.sends = recent

  if (recent.length === 0) return true
  const last = recent[recent.length - 1]
  if (now - last < config.floodMinIntervalMs) return false
  if (recent.length >= config.floodMaxPerMinute) return false
  return true
}

/** Registra um envio do bot nesta conversa. */
export function recordBotSend(key: string): void {
  const now = Date.now()
  const state = states.get(key)
  if (!state) {
    states.set(key, { sends: [now] })
  } else {
    state.sends = prune(state.sends, now)
    state.sends.push(now)
  }

  // limpeza preguiçosa de conversas inativas
  if (states.size > 1000) {
    for (const [k, s] of states) {
      const recent = prune(s.sends, now)
      if (recent.length === 0) states.delete(k)
      else s.sends = recent
    }
  }
}
