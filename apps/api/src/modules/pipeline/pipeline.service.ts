import { PrismaClient } from '@prisma/client'
import { analyzeConversation } from '../chatbot/classifier.service'
import { ChatbotService } from '../chatbot/chatbot.service'
import { emitToOrg } from '../../common/ws-connections'
import { phonesMatch } from '../../common/phone'
const prisma = new PrismaClient()

const chatbotService = new ChatbotService()

// Resultado por card na reavaliação em lote da pipeline.
export interface ReevalItem {
  dealId: string
  title: string
  contactName: string | null
  fromStage: string
  action: 'win' | 'move' | 'remove' | 'keep'
  toStage?: string
  category?: string | null
  value?: number | null // valor da venda (extraído pela IA) quando action = 'win'
  reason: string
}

// Limite de segurança: nº máx. de cards analisados por execução (evita estourar a IA).
const REEVAL_MAX_DEALS = 80
// Concorrência: quantas conversas analisar em paralelo por lote.
const REEVAL_BATCH = 4

export class PipelineService {
  // ─── Pipelines ─────────────────────────────────────────
  async listPipelines(orgId: string) {
    const pipelines = await prisma.pipeline.findMany({
      where: { organizationId: orgId },
      include: {
        stages: {
          orderBy: { order: 'asc' },
          // Quadro mostra só negócios em aberto; ganhos/perdidos saem da pipeline
          // (continuam nos relatórios via getStats).
          include: { deals: { where: { status: 'OPEN' }, include: { contact: true, assignedTo: true } } }
        }
      }
    })

    // Marca não-lido no card: cruza o telefone do contato com conversas que têm
    // mensagens não visualizadas (unreadCount > 0). Uma query só para toda a org.
    const unreadConvs = await prisma.conversation.findMany({
      where: { instance: { organizationId: orgId }, unreadCount: { gt: 0 } },
      select: { remoteJid: true, unreadCount: true },
    })
    const unreadFor = (phone?: string | null): number => {
      if (!phone) return 0
      const hit = unreadConvs.find((u) => phonesMatch(u.remoteJid, phone))
      return hit?.unreadCount ?? 0
    }
    for (const p of pipelines) {
      for (const s of p.stages) {
        for (const deal of s.deals as any[]) {
          deal.unreadCount = unreadFor(deal.contact?.phone)
        }
      }
    }
    return pipelines
  }

  async createPipeline(orgId: string, data: { name: string }) {
    const pipeline = await prisma.pipeline.create({
      data: { name: data.name, organizationId: orgId }
    })
    // Cria estágios padrão
    const defaultStages = ['Prospecção', 'Qualificação', 'Proposta', 'Negociação', 'Fechado']
    const colors = ['#6366f1', '#0ea5e9', '#f59e0b', '#f97316', '#10b981']
    await prisma.stage.createMany({
      data: defaultStages.map((name, i) => ({ name, order: i, color: colors[i], pipelineId: pipeline.id }))
    })
    return this.listPipelines(orgId)
  }

  async updatePipeline(id: string, orgId: string, data: { name: string }) {
    return prisma.pipeline.updateMany({ where: { id, organizationId: orgId }, data })
  }

  async deletePipeline(id: string, orgId: string) {
    return prisma.pipeline.deleteMany({ where: { id, organizationId: orgId } })
  }

  // ─── Stages ────────────────────────────────────────────
  async listStages(pipelineId: string, orgId: string) {
    return prisma.stage.findMany({
      where: { pipelineId, pipeline: { organizationId: orgId } },
      orderBy: { order: 'asc' },
      include: { deals: { include: { contact: true } } }
    })
  }

  async createStage(pipelineId: string, orgId: string, data: { name: string; color?: string }) {
    const last = await prisma.stage.findFirst({
      where: { pipelineId },
      orderBy: { order: 'desc' }
    })
    return prisma.stage.create({
      data: { name: data.name, color: data.color || '#6366f1', order: (last?.order ?? -1) + 1, pipelineId }
    })
  }

  async updateStage(stageId: string, data: { name?: string; color?: string; order?: number }) {
    return prisma.stage.update({ where: { id: stageId }, data })
  }

  async deleteStage(stageId: string) {
    return prisma.stage.delete({ where: { id: stageId } })
  }

  // ─── Deals ─────────────────────────────────────────────
  async listDeals(orgId: string, query: any) {
    const { pipelineId, stageId, search, status } = query
    const where: any = { stage: { pipeline: { organizationId: orgId } } }
    if (pipelineId) where.stage = { ...where.stage, pipelineId }
    if (stageId) where.stageId = stageId
    if (status) where.status = status
    if (search) where.title = { contains: search, mode: 'insensitive' }

    return prisma.deal.findMany({
      where,
      include: { contact: true, stage: true, assignedTo: { select: { id: true, name: true, avatar: true } } },
      orderBy: { createdAt: 'desc' }
    })
  }

  async createDeal(orgId: string, data: { title: string; value?: number; stageId: string; contactId: string; assignedId?: string; notes?: string; expectedAt?: string }) {
    // Valida que o stage pertence à org
    const stage = await prisma.stage.findFirst({
      where: { id: data.stageId, pipeline: { organizationId: orgId } }
    })
    if (!stage) throw { statusCode: 404, message: 'Stage não encontrado' }

    const deal = await prisma.deal.create({
      data: {
        title: data.title,
        value: data.value || 0,
        stageId: data.stageId,
        contactId: data.contactId,
        assignedId: data.assignedId,
        notes: data.notes,
        expectedAt: data.expectedAt ? new Date(data.expectedAt) : undefined,
      },
      include: { contact: true, stage: true, assignedTo: { select: { id: true, name: true, avatar: true } } }
    })
    emitToOrg(orgId, 'deal_updated', { deal })
    return deal
  }

  async getDeal(id: string, orgId: string) {
    const deal = await prisma.deal.findFirst({
      where: { id, stage: { pipeline: { organizationId: orgId } } },
      include: {
        contact: true,
        stage: { include: { pipeline: true } },
        assignedTo: { select: { id: true, name: true, avatar: true } },
        activities: { orderBy: { createdAt: 'desc' }, take: 20 }
      }
    })
    if (!deal) throw { statusCode: 404, message: 'Negócio não encontrado' }
    return deal
  }

  async updateDeal(id: string, orgId: string, data: any) {
    await this.getDeal(id, orgId) // valida pertencimento
    const deal = await prisma.deal.update({
      where: { id },
      data,
      include: { contact: true, stage: true, assignedTo: { select: { id: true, name: true, avatar: true } } },
    })
    // Status saiu de OPEN (ganho/perdido) → sai do quadro em todas as abas.
    // Reaberto/atualizado → atualiza o card. Mesmos eventos do fluxo das conversas.
    if (deal.status !== 'OPEN') emitToOrg(orgId, 'deal_removed', { dealId: id })
    else emitToOrg(orgId, 'deal_updated', { deal })
    return deal
  }

  async moveDeal(id: string, orgId: string, data: { stageId: string }) {
    await this.getDeal(id, orgId)
    const stage = await prisma.stage.findFirst({
      where: { id: data.stageId, pipeline: { organizationId: orgId } }
    })
    if (!stage) throw { statusCode: 404, message: 'Stage de destino não encontrado' }
    const deal = await prisma.deal.update({
      where: { id },
      data: { stageId: data.stageId },
      include: { contact: true, stage: true, assignedTo: { select: { id: true, name: true, avatar: true } } },
    })
    emitToOrg(orgId, 'deal_updated', { deal })
    return deal
  }

  async deleteDeal(id: string, orgId: string) {
    await this.getDeal(id, orgId)
    // FK Restrict em activities: apaga-as antes de excluir o deal.
    await prisma.activity.deleteMany({ where: { dealId: id } })
    const deal = await prisma.deal.delete({ where: { id } })
    emitToOrg(orgId, 'deal_removed', { dealId: id })
    return deal
  }

  // ─── Reavaliação em lote (IA) ──────────────────────────
  /**
   * Analisa com IA todos os cards abertos da org e sugere reorganizar a pipeline:
   *  - `move`  → categoria válida com regra mapeada e estágio diferente do atual;
   *  - `remove`→ IA considera resolvido/sem interesse e NÃO há regra de categoria;
   *  - `keep`  → sem conversa, sem mudança ou IA indecisa.
   * `apply:false` (preview) só retorna o resumo. `apply:true` executa (move/remove)
   * e emite os eventos de socket correspondentes.
   */
  async reevaluatePipeline(orgId: string, opts: { apply: boolean }) {
    const bot = await chatbotService.getBot(orgId)
    const config = bot.config
    const rules = config.categoryMap || []

    // Cards abertos da org, mais recentes primeiro, com contato e estágio.
    const deals = await prisma.deal.findMany({
      where: { stage: { pipeline: { organizationId: orgId } }, status: 'OPEN' },
      include: { contact: true, stage: true },
      orderBy: { createdAt: 'desc' },
      take: REEVAL_MAX_DEALS,
    })
    const total = await prisma.deal.count({
      where: { stage: { pipeline: { organizationId: orgId } }, status: 'OPEN' },
    })
    const truncated = total > deals.length

    // Resolve a conversa de um deal pelo telefone do contato (mesma lógica do chat).
    const findConversationId = async (phone: string | null): Promise<string | null> => {
      const digits = (phone || '').replace(/\D/g, '')
      if (!digits) return null
      const convs = await prisma.conversation.findMany({
        where: { instance: { organizationId: orgId }, remoteJid: { contains: digits.slice(-8) } },
        orderBy: { lastMessageAt: 'desc' },
        select: { id: true, remoteJid: true },
      })
      const conv = convs.find((c) => phonesMatch(c.remoteJid, phone))
      return conv?.id ?? null
    }

    const items: ReevalItem[] = []

    // Processa em lotes para limitar concorrência na IA.
    for (let i = 0; i < deals.length; i += REEVAL_BATCH) {
      const batch = deals.slice(i, i + REEVAL_BATCH)
      const results = await Promise.all(
        batch.map(async (deal): Promise<ReevalItem> => {
          const base = {
            dealId: deal.id,
            title: deal.title,
            contactName: deal.contact?.name ?? null,
            fromStage: deal.stage.name,
          }
          const convId = await findConversationId(deal.contact?.phone ?? null)
          if (!convId) {
            return { ...base, action: 'keep', reason: 'Sem conversa de WhatsApp para este contato' }
          }

          let result
          try {
            result = await analyzeConversation(orgId, convId, config)
          } catch {
            return { ...base, action: 'keep', reason: 'Falha ao analisar a conversa' }
          }
          if (!result) {
            return { ...base, action: 'keep', reason: 'Sem mensagens suficientes para analisar' }
          }

          // Regra de categoria mapeada (categoria válida + confiança ok).
          const matchedRule =
            result.category && result.confidence >= 0.5
              ? rules.find((r) => r.category === result.category)
              : null

          // ── 1) VENDA: comprou NESTA conversa E recebeu a key/produto ──
          // Decisão por pagamento+entrega (não pelo nome do estágio), então funciona
          // mesmo se a IA tiver classificado o comprador como SUPORTE em vez de FECHADO.
          if (result.paid && result.delivered) {
            return {
              ...base,
              action: 'win',
              category: result.category,
              value: result.value ?? (deal.value || null),
              reason: result.reason || 'Pago e entregue — venda concluída',
            }
          }

          // ── 2) PAGOU mas AINDA NÃO recebeu a key → MANTÉM (não pode sumir) ──
          if (result.paid && !result.delivered) {
            return {
              ...base,
              action: 'keep',
              category: result.category,
              reason: '⚠️ Pago, aguardando entrega da key — mantido na pipeline',
            }
          }

          // ── 3) SUPORTE RESOLVIDO / SEM INTERESSE (sem compra) → remove do quadro ──
          // Limpa quem já foi atendido/resolveu ou não tem interesse, SEM contar venda.
          if (result.resolved) {
            return {
              ...base,
              action: 'remove',
              category: result.category,
              reason: result.reason || 'Atendimento resolvido / sem interesse',
            }
          }

          // ── 4) MOVER: ainda ativo, mas no estágio errado ──
          if (matchedRule && matchedRule.stageId !== deal.stageId) {
            const target = await prisma.stage.findFirst({
              where: { id: matchedRule.stageId, pipeline: { organizationId: orgId } },
              select: { name: true },
            })
            // Não move para um estágio de "fechado" sem venda confirmada (evita falso ganho).
            if (target && !/fechad/i.test(target.name)) {
              return {
                ...base,
                action: 'move',
                toStage: target.name,
                category: result.category,
                reason: result.reason || `Classificado como ${result.category}`,
              }
            }
          }

          // ── 5) Em andamento → mantém ──
          return {
            ...base,
            action: 'keep',
            category: result.category,
            reason: result.reason || 'Sem mudança sugerida',
          }
        })
      )
      items.push(...results)
    }

    // Aplica as mudanças (win/move/remove) quando solicitado.
    if (opts.apply) {
      for (const item of items) {
        if (item.action === 'win') {
          // Registra a venda: marca GANHO + valor + data; move pro estágio fechado.
          // Como o quadro só mostra OPEN, o card sai da pipeline mas fica nos relatórios.
          const rule = rules.find((r) => r.category === item.category)
          await prisma.deal.update({
            where: { id: item.dealId },
            data: {
              status: 'WON',
              closedAt: new Date(),
              ...(rule ? { stageId: rule.stageId } : {}),
              ...(item.value != null ? { value: item.value } : {}),
            },
          })
          emitToOrg(orgId, 'deal_removed', { dealId: item.dealId })
        } else if (item.action === 'move' && item.toStage) {
          const rule = rules.find((r) => r.category === item.category)
          if (!rule) continue
          const deal = await prisma.deal.update({
            where: { id: item.dealId },
            data: { stageId: rule.stageId },
            include: { contact: true, stage: true, assignedTo: { select: { id: true, name: true, avatar: true } } },
          })
          emitToOrg(orgId, 'deal_updated', { deal, aiSuggested: true })
        } else if (item.action === 'remove') {
          // Marca LOST (não deleta) — preserva histórico/relatórios. Sai do quadro
          // (que mostra só OPEN) e o front recebe deal_removed.
          await prisma.deal.update({
            where: { id: item.dealId },
            data: { status: 'LOST', closedAt: new Date() },
          }).catch(() => {})
          emitToOrg(orgId, 'deal_removed', { dealId: item.dealId })
        }
      }
    }

    const counts = {
      win: items.filter((i) => i.action === 'win').length,
      move: items.filter((i) => i.action === 'move').length,
      remove: items.filter((i) => i.action === 'remove').length,
      keep: items.filter((i) => i.action === 'keep').length,
      total: items.length,
    }
    return { applied: opts.apply, truncated, counts, items }
  }

  // ─── Limpar inativos ───────────────────────────────────
  /**
   * Remove cards cujo cliente está há `hours`+ sem responder (sem mensagem
   * recebida). Cards sem conversa de WhatsApp são mantidos (não há sinal).
   * `apply:false` → preview; `apply:true` → remove e emite `deal_removed`.
   * O contato volta ao funil automaticamente se mandar nova mensagem.
   */
  async cleanInactive(orgId: string, opts: { apply: boolean; hours?: number }) {
    const hours = opts.hours && opts.hours > 0 ? opts.hours : 4
    const cutoff = new Date(Date.now() - hours * 3600_000)

    const deals = await prisma.deal.findMany({
      where: { stage: { pipeline: { organizationId: orgId } }, status: 'OPEN' },
      include: { contact: true },
    })

    // Conversas da org (id + telefone) para casar com os contatos dos deals.
    const convs = await prisma.conversation.findMany({
      where: { instance: { organizationId: orgId } },
      select: { id: true, remoteJid: true },
    })
    const convIdFor = (phone?: string | null): string | null => {
      if (!phone) return null
      const hit = convs.find((c) => phonesMatch(c.remoteJid, phone))
      return hit?.id ?? null
    }

    // Última mensagem recebida (fromMe:false) por conversa.
    const convIds = Array.from(new Set(deals.map((dl) => convIdFor(dl.contact?.phone)).filter(Boolean) as string[]))
    const lastInboundByConv = new Map<string, Date>()
    if (convIds.length) {
      const grouped = await prisma.message.groupBy({
        by: ['conversationId'],
        where: { conversationId: { in: convIds }, fromMe: false },
        _max: { timestamp: true },
      })
      for (const g of grouped) if (g._max.timestamp) lastInboundByConv.set(g.conversationId, g._max.timestamp)
    }

    const items = deals.flatMap((deal) => {
      const convId = convIdFor(deal.contact?.phone)
      if (!convId) return [] // sem conversa → mantém
      const last = lastInboundByConv.get(convId)
      if (!last || last >= cutoff) return [] // respondeu recente → mantém
      return [{ dealId: deal.id, title: deal.title, contactName: deal.contact?.name ?? null, lastInbound: last.toISOString() }]
    })

    if (opts.apply) {
      for (const it of items) {
        // Marca LOST (não deleta) — card sai do quadro mas fica no histórico.
        await prisma.deal.update({
          where: { id: it.dealId },
          data: { status: 'LOST', closedAt: new Date() },
        }).catch(() => {})
        emitToOrg(orgId, 'deal_removed', { dealId: it.dealId })
      }
    }

    return { applied: opts.apply, hours, count: items.length, items }
  }

  // ─── Stats ─────────────────────────────────────────────
  async getStats(orgId: string) {
    const [total, won, lost, totalValue] = await Promise.all([
      prisma.deal.count({ where: { stage: { pipeline: { organizationId: orgId } }, status: 'OPEN' } }),
      prisma.deal.count({ where: { stage: { pipeline: { organizationId: orgId } }, status: 'WON' } }),
      prisma.deal.count({ where: { stage: { pipeline: { organizationId: orgId } }, status: 'LOST' } }),
      prisma.deal.aggregate({
        where: { stage: { pipeline: { organizationId: orgId } }, status: 'OPEN' },
        _sum: { value: true }
      })
    ])
    return { total, won, lost, totalValue: totalValue._sum.value || 0 }
  }
}
