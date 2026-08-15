import { PrismaClient } from '@prisma/client'
import { generateCompletion } from './ai.service'
import { BotConfig } from './chatbot.service'
import { pauseBot } from './bot-control'
import { emitToOrg } from '../../common/ws-connections'
import { extractPdfText, fileFromMediaUrl } from './pdf.util'
import { phoneFromJid } from '../../common/phone'

const prisma = new PrismaClient()

// Re-export para manter compatível quem importa phoneFromJid daqui.
export { phoneFromJid }

export interface ClassifyResult {
  category: string | null
  confidence: number
  reason: string
  shouldPause: boolean
  resolved: boolean
  paid: boolean // houve pagamento/compra NESTA conversa (pix/comprovante/confirmação)
  value: number | null // valor pago/fechado, se a IA conseguir extrair da conversa
  delivered: boolean // entrega concluída (key/produto enviado e cliente recebeu)
}

/** Extrai o primeiro bloco JSON de um texto (a IA às vezes embrulha em prosa). */
function parseJsonBlock(text: string): any | null {
  if (!text) return null
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) return null
  try {
    return JSON.parse(match[0])
  } catch {
    return null
  }
}

/**
 * Análise IA da conversa num único call. Conforme a config, faz:
 *  - classificação → cria/move Deal para o estágio mapeado (autoClassify);
 *  - detecção de situação de pausa (pauseAiEnabled) → pausa o bot;
 *  - detecção de atendimento resolvido/sem interesse (removeOnResolved) →
 *    remove o Deal da pipeline e pausa o bot.
 * Retorna o resultado da análise (ou null se desabilitado/sem dados).
 */
export async function analyzeConversation(
  organizationId: string,
  conversationId: string,
  config: BotConfig
): Promise<ClassifyResult | null> {
  const rules = config.categoryMap || []
  const wantsClassify = config.autoClassify && rules.length > 0
  const wantsPause = !!config.pauseAiEnabled
  const wantsResolved = !!config.removeOnResolved
  // Nada habilitado → não gasta chamada de IA.
  if (!wantsClassify && !wantsPause && !wantsResolved) return null

  const conv = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { id: true, remoteJid: true, pushName: true },
  })
  if (!conv) return null

  // Histórico recente da conversa para dar contexto à IA.
  const rows = await prisma.message.findMany({
    where: { conversationId },
    orderBy: { timestamp: 'desc' },
    take: 20,
    select: { content: true, fromMe: true, mediaUrl: true, mediaType: true },
  })
  const ordered = rows.reverse()

  // Para que o classificador "enxergue" comprovantes, injeta o texto extraído de
  // PDFs enviados pelo cliente (o content salvo é só o rótulo "📄 Documento").
  const lines: string[] = []
  for (const m of ordered) {
    const who = m.fromMe ? 'Atendente' : 'Cliente'
    let text = m.content || ''
    if (!m.fromMe && m.mediaType === 'document' && m.mediaUrl) {
      const file = fileFromMediaUrl(m.mediaUrl)
      const pdfText = file ? await extractPdfText(file) : null
      if (pdfText) text = `${text} [conteúdo do documento enviado: ${pdfText.slice(0, 1500)}]`
    } else if (!m.fromMe && m.mediaType === 'image' && m.mediaUrl) {
      text = `${text} [cliente enviou uma imagem — pode ser comprovante de pagamento/print]`
    }
    lines.push(`${who}: ${text}`)
  }
  const transcript = lines.join('\n')
  if (!transcript.trim()) return null

  // Monta o system prompt e o formato de saída só com os campos relevantes.
  const fields: string[] = ['"reason": "<curto>"']
  const systemParts: string[] = ['Você é um analista de conversas de atendimento para um CRM de vendas.']

  if (wantsClassify) {
    const categories = rules.map((r) => r.category)
    systemParts.push(config.classifyInstructions)
    systemParts.push(`Categorias possíveis: ${categories.join(', ')}.`)
    // Sinal forte de fechamento: comprovante/print de pagamento, "fiz o pix",
    // "paguei", "segue o comprovante" → categoria de fechamento (ex: FECHADO).
    if (categories.some((c) => /fechad/i.test(c))) {
      systemParts.push(
        'REGRA IMPORTANTE: se o cliente enviou comprovante/print de pagamento, disse que fez o PIX, que pagou, ou mandou comprovante, classifique como a categoria de FECHADO com confiança alta (>= 0.8). Nesse caso NÃO marque como resolvido/sem interesse.'
      )
    }
    // Distinguir VENDA de SUPORTE: estes 3 campos valem para qualquer categoria.
    systemParts.push(
      'PAGAMENTO (campo "paid"): marque true SOMENTE se houve uma COMPRA/PAGAMENTO NESTA conversa (cliente fez PIX, enviou comprovante de pagamento, ou confirmou que pagou agora). NÃO marque true para quem só tem licença antiga, pede suporte, tira dúvida, ou está negociando sem ter pago. ATENÇÃO: se o cliente está pedindo ESTORNO, REEMBOLSO, CHARGEBACK ou cancelamento, use "paid": false (não é uma venda concluída). Na dúvida, false.'
    )
    systemParts.push(
      'VALOR (campo "value"): se houve pagamento E a conversa menciona o valor (ex: "paguei 97", "R$ 197,00", "pix de 50"), retorne só o número em reais (ponto decimal). Sem valor claro, use null.'
    )
    systemParts.push(
      'ENTREGA (campo "delivered"): marque true APENAS quando a chave/produto foi entregue E está FUNCIONANDO para o cliente — ele ativou com sucesso, confirmou que está usando, ou agradeceu satisfeito, E o atendimento está ENCERRADO (nada pendente). Use "delivered": false se: a key ainda não foi enviada; foi enviada mas o cliente NÃO confirmou; o cliente relata que NÃO FUNCIONA, deu erro, não ativou, está com problema, reclamando, ou pedindo estorno/troca; OU se há uma NEGOCIAÇÃO/INTERESSE ATIVO em andamento (cliente quer comprar mais, fazer upgrade, renovar, está decidindo, ou tem pergunta em aberto que pode levar a nova venda). Resumo: só true quando tudo foi entregue, funciona e NÃO há mais nada em aberto — caso contrário, false para manter o cliente na pipeline. Na dúvida, false.'
    )
    fields.push('"paid": <true|false>', '"value": <número ou null>', '"delivered": <true|false>')
    systemParts.push('Se não tiver certeza suficiente, use "category": null.')
    fields.unshift('"category": "<uma das categorias ou null>"', '"confidence": <0 a 1>')
  }
  if (wantsPause) {
    systemParts.push(`Pausa do atendimento: ${config.pauseAiInstructions}`)
    fields.push('"shouldPause": <true|false>')
  }
  if (wantsResolved) {
    systemParts.push(`Atendimento resolvido/sem interesse: ${config.resolvedInstructions}`)
    fields.push('"resolved": <true|false>')
  }
  systemParts.push(`Responda APENAS um JSON válido no formato: {${fields.join(', ')}}.`)

  const system = systemParts.filter(Boolean).join('\n')

  let raw = ''
  try {
    raw = await generateCompletion(
      [
        { role: 'system', content: system },
        { role: 'user', content: `Conversa:\n${transcript}` },
      ],
      { temperature: 0, maxTokens: 200 }
    )
  } catch {
    return null
  }

  const parsed = parseJsonBlock(raw)
  if (!parsed) return null
  const result: ClassifyResult = {
    category: typeof parsed.category === 'string' ? parsed.category : null,
    confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0,
    reason: typeof parsed.reason === 'string' ? parsed.reason : '',
    shouldPause: parsed.shouldPause === true,
    resolved: parsed.resolved === true,
    paid: parsed.paid === true,
    value: typeof parsed.value === 'number' && parsed.value > 0 ? parsed.value : null,
    delivered: parsed.delivered === true,
  }
  return result
}

/**
 * Análise IA da conversa num único call. Conforme a config, faz:
 *  - classificação → cria/move Deal para o estágio mapeado (autoClassify);
 *  - detecção de situação de pausa (pauseAiEnabled) → pausa o bot;
 *  - detecção de atendimento resolvido/sem interesse (removeOnResolved) →
 *    remove o Deal da pipeline e pausa o bot.
 * Retorna o resultado da análise (ou null se desabilitado/sem dados).
 */
export async function classifyConversation(
  organizationId: string,
  conversationId: string,
  config: BotConfig
): Promise<ClassifyResult | null> {
  const rules = config.categoryMap || []
  const wantsClassify = config.autoClassify && rules.length > 0
  const wantsPause = !!config.pauseAiEnabled
  const wantsResolved = !!config.removeOnResolved

  const result = await analyzeConversation(organizationId, conversationId, config)
  if (!result) return null

  const conv = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { id: true, remoteJid: true, pushName: true },
  })
  if (!conv) return result

  // Regra de classificação correspondente (se houver categoria válida e confiança ok).
  const matchedRule =
    wantsClassify && result.category && result.confidence >= 0.5
      ? rules.find((r) => r.category === result.category)
      : null

  // ── Resolvido / sem interesse → remove o Deal da pipeline e pausa ──
  // IMPORTANTE: só remove se NÃO houver uma categoria de funil válida para mover.
  // Pagamento/comprovante deve cair em FECHADO (mover), não ser removido.
  if (wantsResolved && result.resolved && !matchedRule) {
    await removeDealFromPipeline(organizationId, conv.remoteJid)
    await prisma.conversation.update({
      where: { id: conversationId },
      data: { aiCategory: null, aiStageSuggested: false },
    })
    emitToOrg(organizationId, 'conversation_ai', { conversationId, aiCategory: null })
    await pauseBot(conversationId, 'FECHADO', config.autoPauseHours).catch(() => {})
    return result
  }

  // ── Situação de pausa detectada pela IA ───────────────────────────
  if (wantsPause && result.shouldPause) {
    await pauseBot(conversationId, 'IA', config.autoPauseHours).catch(() => {})
    // segue: ainda pode classificar abaixo, se habilitado
  }

  // Sem classificação habilitada → encerra aqui.
  if (!wantsClassify) return result

  // Sem categoria válida ou confiança baixa → registra categoria mas não move card.
  const rule = result.category ? rules.find((r) => r.category === result.category) : null
  if (!rule || result.confidence < 0.5) {
    if (result.category) {
      await prisma.conversation.update({
        where: { id: conversationId },
        data: { aiCategory: result.category },
      })
      emitToOrg(organizationId, 'conversation_ai', { conversationId, aiCategory: result.category })
    }
    return result
  }

  // Garante um Contact (casa por telefone dentro da org).
  const phone = phoneFromJid(conv.remoteJid)
  let contact = await prisma.contact.findFirst({
    where: { organizationId, phone },
    select: { id: true },
  })
  if (!contact) {
    contact = await prisma.contact.create({
      data: {
        organizationId,
        name: conv.pushName || phone,
        phone,
        source: 'WhatsApp',
      },
      select: { id: true },
    })
  }

  // Cria ou move o Deal do contato para o estágio mapeado.
  const note = `IA: ${result.category} (${Math.round(result.confidence * 100)}%) — ${result.reason}`
  // Só reutiliza deal ABERTO. Se o último estava ganho/perdido, o cliente voltou
  // com nova intenção → cria card novo em vez de ressuscitar o fechado.
  const existingDeal = await prisma.deal.findFirst({
    where: { contactId: contact.id, status: 'OPEN', stage: { pipeline: { organizationId } } },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  })

  let deal
  if (existingDeal) {
    deal = await prisma.deal.update({
      where: { id: existingDeal.id },
      data: { stageId: rule.stageId, notes: note },
      include: { contact: true, stage: true, assignedTo: { select: { id: true, name: true, avatar: true } } },
    })
  } else {
    deal = await prisma.deal.create({
      data: {
        title: conv.pushName || phone,
        stageId: rule.stageId,
        contactId: contact.id,
        notes: note,
      },
      include: { contact: true, stage: true, assignedTo: { select: { id: true, name: true, avatar: true } } },
    })
  }

  await prisma.conversation.update({
    where: { id: conversationId },
    data: { aiCategory: result.category || undefined, aiStageSuggested: true },
  })

  emitToOrg(organizationId, 'deal_updated', { deal, aiSuggested: true })
  emitToOrg(organizationId, 'conversation_ai', { conversationId, aiCategory: result.category })

  // Se a regra pede para pausar o bot nesta categoria (ex: FECHADO/SUPORTE).
  if (rule.pauseBot) {
    await pauseBot(conversationId, result.category || 'IA', config.pauseHumanHours)
  }

  return result
}

/**
 * Tira o Deal ABERTO do contato (casado por telefone) da pipeline da org.
 * Marca como LOST (não deleta) para preservar histórico/relatórios; o card sai
 * do quadro (que mostra só OPEN) e o front recebe `deal_removed`.
 * No-op se não houver deal aberto. Best-effort: erros não propagam.
 */
export async function removeDealFromPipeline(organizationId: string, remoteJid: string): Promise<void> {
  try {
    const phone = phoneFromJid(remoteJid)
    const contact = await prisma.contact.findFirst({
      where: { organizationId, phone },
      select: { id: true },
    })
    if (!contact) return

    const deal = await prisma.deal.findFirst({
      where: { contactId: contact.id, status: 'OPEN', stage: { pipeline: { organizationId } } },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    })
    if (!deal) return

    await prisma.deal.update({ where: { id: deal.id }, data: { status: 'LOST', closedAt: new Date() } })
    emitToOrg(organizationId, 'deal_removed', { dealId: deal.id })
  } catch {
    // best-effort: a remoção não deve quebrar o fluxo de análise
  }
}
