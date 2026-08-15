import { PrismaClient } from '@prisma/client'
import { generateCompletion, AiMessage, AiContentBlock } from './ai.service'

const prisma = new PrismaClient()

// ─── Configuração do bot (persistida em Chatbot.flow como JSON) ──────────
export interface BotConfig {
  persona: string
  instructions: string
  knowledge: string
  greeting: string
  fallback: string
  temperature: number
  maxTokens: number
  historyLimit: number
  // comportamento humano / anti-detecção
  humanize: boolean
  readDelayMinMs: number
  readDelayMaxMs: number
  typing: boolean
  typingCharsPerSec: number
  typingMinMs: number
  typingMaxMs: number
  splitMessages: boolean
  splitMaxChars: number
  splitMode: SplitMode // como compactar/dividir a resposta
  bubbleDelayMinMs: number
  bubbleDelayMaxMs: number
  // controle de atendimento
  replyToGroups: boolean
  onlyBusinessHours: boolean
  businessStart: string // "08:00"
  businessEnd: string // "18:00"
  outOfHoursMessage: string
  // automação / classificação IA → pipeline
  autoClassify: boolean
  pauseHumanHours: number // horas que o bot fica pausado ao detectar humano
  classifyInstructions: string
  categoryMap: CategoryRule[]
  // pausa automática (palavra-chave + IA)
  autoPauseEnabled: boolean
  pauseKeywords: string // 1 gatilho por linha ou separado por vírgula
  pauseAiEnabled: boolean // IA detecta situações que merecem pausa
  pauseAiInstructions: string
  autoPauseHours: number // duração da pausa automática (keyword/IA)
  // remoção da pipeline quando resolvido / sem interesse
  removeOnResolved: boolean
  resolvedInstructions: string
  // anti-flood (limita rajada de respostas do bot por conversa)
  antiFloodEnabled: boolean
  floodMinIntervalMs: number // intervalo mínimo entre envios na mesma conversa
  floodMaxPerMinute: number // máx. respostas do bot por conversa por minuto
  // modelos / mídia
  model: string // modelo principal (texto). Vazio = usa env AI_MODEL.
  visionEnabled: boolean // bot "vê" imagens recebidas
  visionModel: string // modelo usado SÓ quando há imagem (visão)
  readPdfEnabled: boolean // bot lê o texto de PDFs recebidos (ex: comprovante)
  thinkMore: boolean // injeta instrução de raciocínio antes de responder
}

// Modo de quebra da resposta: compacto (1 msg), equilibrado (poucas), dividido (várias).
export type SplitMode = 'compact' | 'balanced' | 'split'

// Regra que mapeia uma categoria detectada pela IA para um estágio da pipeline.
export interface CategoryRule {
  category: string // ex: "FECHADO", "SUPORTE", "POTENCIAL"
  stageId: string // estágio para onde mover o card
  pauseBot?: boolean // se true, pausa o bot quando a conversa cair nesta categoria
}

export const DEFAULT_CONFIG: BotConfig = {
  persona:
    'Você é a Sofia, atendente virtual simpática e objetiva de uma empresa. Fala português do Brasil de forma natural e calorosa.',
  instructions:
    'Responda dúvidas dos clientes com clareza. Seja educada e prestativa. Se o cliente quiser falar com um humano, peça o melhor horário e diga que um atendente vai retornar. Nunca invente preços ou informações que você não tem.',
  knowledge: '',
  greeting: 'Oi! 😊 Sou a Sofia, em que posso te ajudar hoje?',
  fallback:
    'Deixa eu confirmar essa informação certinho com a equipe e já te retorno, tá? 🙏',
  temperature: 0.7,
  maxTokens: 600,
  historyLimit: 12,
  // valores pré-configurados para parecer humano
  humanize: true,
  readDelayMinMs: 1500,
  readDelayMaxMs: 4000,
  typing: true,
  typingCharsPerSec: 14,
  typingMinMs: 1200,
  typingMaxMs: 7000,
  splitMessages: true,
  splitMaxChars: 220,
  splitMode: 'balanced',
  bubbleDelayMinMs: 800,
  bubbleDelayMaxMs: 2200,
  replyToGroups: false,
  onlyBusinessHours: false,
  businessStart: '08:00',
  businessEnd: '18:00',
  outOfHoursMessage:
    'Oi! No momento estamos fora do horário de atendimento, mas assim que abrirmos eu te respondo. 😊',
  // automação / classificação IA → pipeline
  autoClassify: false,
  pauseHumanHours: 6,
  classifyInstructions:
    'Classifique a intenção do cliente com base na conversa. Escolha a categoria que melhor representa o momento dele no funil.',
  categoryMap: [],
  // pausa automática
  autoPauseEnabled: false,
  pauseKeywords: '',
  pauseAiEnabled: false,
  pauseAiInstructions:
    'Pause quando o cliente pedir para falar com um humano/atendente, demonstrar irritação séria, ou pedir para não ser mais contatado.',
  autoPauseHours: 6,
  // remoção da pipeline quando resolvido
  removeOnResolved: false,
  resolvedInstructions:
    'Considere resolvido quando o cliente confirmar que o problema foi solucionado, agradecer e encerrar, ou deixar claro que não quer mais atendimento/não tem interesse.',
  // anti-flood
  antiFloodEnabled: true,
  floodMinIntervalMs: 1500,
  floodMaxPerMinute: 5,
  // modelos / mídia
  model: '',
  visionEnabled: true,
  visionModel: 'claude-haiku-4-5',
  readPdfEnabled: true,
  thinkMore: true,
}

const SPLIT_MODES: SplitMode[] = ['compact', 'balanced', 'split']

export function mergeConfig(raw: any): BotConfig {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_CONFIG }
  const merged = { ...DEFAULT_CONFIG, ...raw }
  // categoryMap deve ser sempre um array válido
  if (!Array.isArray(merged.categoryMap)) merged.categoryMap = []
  // splitMode deve ser um dos modos válidos
  if (!SPLIT_MODES.includes(merged.splitMode)) merged.splitMode = 'balanced'
  return merged
}

export class ChatbotService {
  /** Retorna o bot da org (cria um default se não existir). */
  async getBot(orgId: string) {
    let bot = await prisma.chatbot.findFirst({ where: { organizationId: orgId } })
    if (!bot) {
      bot = await prisma.chatbot.create({
        data: {
          name: 'Atendente IA',
          active: false,
          triggerType: 'all',
          organizationId: orgId,
          flow: DEFAULT_CONFIG as any,
        },
      })
    }
    return {
      id: bot.id,
      name: bot.name,
      active: bot.active,
      config: mergeConfig(bot.flow),
    }
  }

  async saveBot(
    orgId: string,
    payload: { name?: string; active?: boolean; config?: Partial<BotConfig> }
  ) {
    const current = await this.getBot(orgId)
    const config = mergeConfig({ ...current.config, ...(payload.config || {}) })
    await prisma.chatbot.update({
      where: { id: current.id },
      data: {
        name: payload.name ?? current.name,
        active: payload.active ?? current.active,
        flow: config as any,
      },
    })
    return this.getBot(orgId)
  }

  /** Monta o array de mensagens para o modelo. `incoming` pode ser texto ou blocos (com imagem). */
  buildMessages(config: BotConfig, history: AiMessage[], incoming: string | AiContentBlock[]): AiMessage[] {
    const systemParts = [
      config.persona,
      config.instructions,
      config.knowledge
        ? `Base de conhecimento (use apenas isto como verdade da empresa):\n${config.knowledge}`
        : '',
      'Regras de estilo: escreva como uma pessoa real no WhatsApp — mensagens curtas, naturais, sem soar robótico. Não use formatação markdown (sem **, sem #, sem listas com -). Evite respostas longas demais.',
      // Raciocínio: pensar antes, ler todo o contexto, não repetir o que já foi dito.
      config.thinkMore
        ? 'Antes de responder, leia TODO o histórico recente e entenda o que o cliente realmente quer no conjunto das mensagens (não responda mensagem por mensagem isoladamente). NUNCA repita uma informação, pergunta ou bloco de texto que você já enviou antes nesta conversa — se já mandou os dados de pagamento/preço, não mande de novo; apenas avance. Se o cliente disser que pagou ou enviar um comprovante, reconheça e siga para o próximo passo (confirmar/validar), não recomece o fluxo. Seja coerente com o que JÁ foi combinado.'
        : '',
      config.fallback
        ? `Se não souber a resposta ou não tiver a informação, responda algo como: "${config.fallback}"`
        : '',
    ].filter(Boolean)

    return [
      { role: 'system', content: systemParts.join('\n\n') },
      ...history,
      { role: 'user', content: incoming },
    ]
  }

  /**
   * Gera a resposta do bot. `media` opcional permite o bot "ver" imagem ou "ler" PDF:
   * - imagem (com visionEnabled): manda como bloco multimodal usando visionModel.
   * - PDF/documento (com readPdfEnabled): o texto extraído é injetado como contexto.
   */
  async generateReply(
    config: BotConfig,
    history: AiMessage[],
    incoming: string,
    media?: { kind: 'image' | 'document'; base64?: string; mimetype?: string; extractedText?: string }
  ): Promise<string> {
    let userContent: string | AiContentBlock[] = incoming
    let model = config.model || undefined

    if (media?.kind === 'image' && config.visionEnabled && media.base64) {
      model = config.visionModel || config.model || undefined
      userContent = [
        { type: 'text', text: incoming?.trim() || 'O cliente enviou esta imagem. Analise o que é (ex: comprovante de pagamento, foto de produto, documento) e responda de acordo com o contexto da conversa.' },
        { type: 'image_url', image_url: { url: `data:${media.mimetype || 'image/jpeg'};base64,${media.base64}` } },
      ]
    } else if (media?.kind === 'document' && config.readPdfEnabled && media.extractedText) {
      const txt = media.extractedText.slice(0, 6000)
      userContent = `${incoming?.trim() || 'O cliente enviou um documento.'}\n\n[Conteúdo extraído do documento enviado pelo cliente]:\n${txt}`
    }

    const messages = this.buildMessages(config, history, userContent)
    try {
      const reply = await generateCompletion(messages, {
        temperature: config.temperature,
        maxTokens: config.maxTokens,
        model,
      })
      return reply || config.fallback
    } catch {
      return config.fallback
    }
  }

  /**
   * Quebra a resposta em "bolhas" segundo o modo configurado:
   * - compact: uma única mensagem (sem divisão).
   * - balanced: agrupa parágrafos numa mesma bolha até ~450 chars (poucas bolhas).
   * - split: uma ideia por bolha, limite curto (~220 chars).
   * Aceita um número (limite legado) por retrocompat com chamadas antigas.
   */
  splitReply(text: string, mode: SplitMode | number = 'balanced'): string[] {
    const clean = (text || '').trim()
    if (!clean) return []

    // Retrocompat: se vier um número, trata como modo "split" com aquele limite.
    const resolvedMode: SplitMode = typeof mode === 'number' ? 'split' : mode
    const maxChars = typeof mode === 'number' ? mode : resolvedMode === 'balanced' ? 450 : 220

    // Modo compacto → mensagem única (normaliza espaços em excesso entre parágrafos).
    if (resolvedMode === 'compact') {
      return [clean.replace(/\n{3,}/g, '\n\n')]
    }

    // Parágrafos explícitos do modelo.
    const paragraphs = clean
      .split(/\n{2,}|\n/)
      .map((p) => p.trim())
      .filter(Boolean)

    const bubbles: string[] = []

    // No modo equilibrado, junta parágrafos consecutivos enquanto couber no limite.
    if (resolvedMode === 'balanced') {
      let buffer = ''
      const flush = () => {
        if (buffer.trim()) bubbles.push(buffer.trim())
        buffer = ''
      }
      for (const para of paragraphs) {
        if (para.length > maxChars) {
          // parágrafo gigante: fecha o buffer e quebra ele sozinho por frases
          flush()
          for (const piece of this.splitBySentences(para, maxChars)) bubbles.push(piece)
          continue
        }
        if (buffer && (buffer + '\n' + para).length > maxChars) flush()
        buffer = buffer ? `${buffer}\n${para}` : para
      }
      flush()
      return bubbles.length ? bubbles : [clean]
    }

    // Modo dividido: uma bolha por parágrafo, quebrando os longos por frases.
    for (const para of paragraphs) {
      if (para.length <= maxChars) {
        bubbles.push(para)
        continue
      }
      for (const piece of this.splitBySentences(para, maxChars)) bubbles.push(piece)
    }
    return bubbles.length ? bubbles : [clean]
  }

  /** Quebra um trecho longo em pedaços por frase, respeitando o limite. */
  private splitBySentences(para: string, maxChars: number): string[] {
    const sentences = para.match(/[^.!?…]+[.!?…]*\s*/g) || [para]
    const out: string[] = []
    let buffer = ''
    for (const s of sentences) {
      if ((buffer + s).length > maxChars && buffer) {
        out.push(buffer.trim())
        buffer = s
      } else {
        buffer += s
      }
    }
    if (buffer.trim()) out.push(buffer.trim())
    return out
  }
}
