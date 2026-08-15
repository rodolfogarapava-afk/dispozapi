'use client'
import { useEffect, useState, useCallback } from 'react'
import toast from 'react-hot-toast'
import { api } from '@/lib/api'
import { formatCurrency } from '@/lib/utils'
import { confirmToast } from '@/lib/confirm'
import { wsClient } from '@/lib/ws'
import { Plus, X, MoreHorizontal, Trophy, XCircle, Trash2, Pencil, Sparkles, MessageCircle, Loader2, GitBranch, Check, Flag, Clock } from 'lucide-react'
import { ConversationChat } from '@/components/whatsapp/conversation-chat'

interface Deal {
  id: string
  title: string
  value: number
  status: 'OPEN' | 'WON' | 'LOST'
  stageId: string
  notes?: string | null
  unreadCount?: number
  contact: { id: string; name: string; phone?: string }
  assignedTo?: { name: string } | null
}

// Extrai a % de confiança da nota gerada pela IA (formato "IA: CAT (NN%) — ...").
function aiConfidence(notes?: string | null): number | null {
  if (!notes?.startsWith('IA:')) return null
  const m = notes.match(/\((\d+)%\)/)
  return m ? Number(m[1]) : null
}

// Extrai o motivo/resumo escrito pela IA (texto após o "— " no formato acima).
function aiReason(notes?: string | null): string | null {
  if (!notes?.startsWith('IA:')) return null
  const i = notes.indexOf('—')
  const reason = i >= 0 ? notes.slice(i + 1).trim() : ''
  return reason || null
}
interface Stage { id: string; name: string; color: string; order: number; deals: Deal[] }
interface Pipeline { id: string; name: string; stages: Stage[] }
interface Contact { id: string; name: string }

// Reavaliação em lote (resposta do POST /pipeline/reevaluate)
interface ReevalItem {
  dealId: string
  title: string
  contactName: string | null
  fromStage: string
  action: 'win' | 'move' | 'remove' | 'keep'
  toStage?: string
  category?: string | null
  value?: number | null
  reason: string
}
interface ReevalResult {
  applied: boolean
  truncated: boolean
  counts: { win: number; move: number; remove: number; keep: number; total: number }
  items: ReevalItem[]
}

// Limpar inativos (resposta do POST /pipeline/clean-inactive)
interface InactiveItem { dealId: string; title: string; contactName: string | null; lastInbound: string }
interface InactiveResult { applied: boolean; hours: number; count: number; items: InactiveItem[] }

const STAGE_COLORS = ['#6366f1', '#0ea5e9', '#f59e0b', '#f97316', '#10b981', '#ec4899', '#8b5cf6']
const inputCls = 'w-full px-3 py-2 rounded-lg border border-border text-sm text-foreground outline-none focus:border-primary/50 disabled:opacity-50'

interface ChatConv {
  id: string
  instanceId: string
  remoteJid: string
  pushName?: string
  profilePicUrl?: string | null
}

export default function PipelinePage() {
  const [pipeline, setPipeline] = useState<Pipeline | null>(null)
  const [loading, setLoading] = useState(true)
  const [dragging, setDragging] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState<string | null>(null)
  const [contacts, setContacts] = useState<Contact[]>([])
  const [menuOpen, setMenuOpen] = useState<string | null>(null)

  const [dealModal, setDealModal] = useState<{ mode: 'create' | 'edit'; deal?: Deal } | null>(null)
  const [stageModal, setStageModal] = useState(false)
  const [pipelineModal, setPipelineModal] = useState(false)

  // Modal de chat: deal clicado + conversa resolvida por telefone (null = carregando, false = não encontrada)
  const [chatDeal, setChatDeal] = useState<Deal | null>(null)
  const [chatConv, setChatConv] = useState<ChatConv | null | false>(null)
  // Menus do cabeçalho do modal de chat
  const [chatMoveOpen, setChatMoveOpen] = useState(false)
  const [chatEndOpen, setChatEndOpen] = useState(false)

  // Cards com o resumo da IA expandido (clique no "ver mais" abre inline).
  const [expandedAi, setExpandedAi] = useState<Set<string>>(new Set())
  const toggleAiExpand = (dealId: string) =>
    setExpandedAi((prev) => {
      const next = new Set(prev)
      next.has(dealId) ? next.delete(dealId) : next.add(dealId)
      return next
    })

  const [dealForm, setDealForm] = useState({ title: '', value: '', stageId: '', contactId: '', notes: '' })
  const [stageForm, setStageForm] = useState({ name: '', color: STAGE_COLORS[0] })
  const [pipelineForm, setPipelineForm] = useState('')
  const [saving, setSaving] = useState(false)

  // Renomear funil
  const [renameModal, setRenameModal] = useState(false)
  const [renameForm, setRenameForm] = useState('')

  // Reavaliação com IA: resultado do preview e estados de loading
  const [reevalResult, setReevalResult] = useState<ReevalResult | null>(null)
  const [reevalLoading, setReevalLoading] = useState(false)
  const [reevalApplying, setReevalApplying] = useState(false)

  // Limpar inativos: preview e estados
  const [inactiveResult, setInactiveResult] = useState<InactiveResult | null>(null)
  const [inactiveLoading, setInactiveLoading] = useState(false)
  const [inactiveApplying, setInactiveApplying] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await api.get('/pipeline')
      setPipeline(data[0] || null)
    } catch {
      toast.error('Erro ao carregar pipeline')
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
    api.get('/contacts?limit=200').then((r) => setContacts(r.data?.data || [])).catch(() => {})
  }, [load])

  useEffect(() => {
    if (!menuOpen) return
    const handler = () => setMenuOpen(null)
    window.addEventListener('click', handler)
    return () => window.removeEventListener('click', handler)
  }, [menuOpen])

  // Fecha os menus do modal de chat (Funil/Finalizar) ao clicar fora.
  useEffect(() => {
    if (!chatMoveOpen && !chatEndOpen) return
    const handler = () => { setChatMoveOpen(false); setChatEndOpen(false) }
    window.addEventListener('click', handler)
    return () => window.removeEventListener('click', handler)
  }, [chatMoveOpen, chatEndOpen])

  // Tempo real: reflete mudanças vindas de outras telas/abas (conversas, IA,
  // reavaliação, limpar inativos) sem precisar recarregar.
  useEffect(() => {
    const removeDealLocal = (dealId: string) =>
      setPipeline((prev) => prev ? {
        ...prev,
        stages: prev.stages.map((s) => ({ ...s, deals: s.deals.filter((d) => d.id !== dealId) })),
      } : prev)

    const upsertDealLocal = (deal: Deal) =>
      setPipeline((prev) => {
        if (!prev || !prev.stages.some((s) => s.id === deal.stageId)) return prev
        const stages = prev.stages.map((s) => ({
          ...s,
          deals: s.id === deal.stageId
            ? [...s.deals.filter((d) => d.id !== deal.id), deal]
            : s.deals.filter((d) => d.id !== deal.id),
        }))
        return { ...prev, stages }
      })

    const offRemoved = wsClient.on('deal_removed', (p: any) => { if (p?.dealId) removeDealLocal(p.dealId) })
    const offUpdated = wsClient.on('deal_updated', (p: any) => {
      const d = p?.deal
      if (!d) return
      if (d.status && d.status !== 'OPEN') removeDealLocal(d.id)
      else upsertDealLocal(d as Deal)
    })
    return () => { offRemoved(); offUpdated() }
  }, [])

  const openCreateDeal = (stageId?: string) => {
    setDealForm({ title: '', value: '', stageId: stageId || pipeline?.stages[0]?.id || '', contactId: '', notes: '' })
    setDealModal({ mode: 'create' })
  }

  const openEditDeal = (deal: Deal) => {
    setDealForm({
      title: deal.title,
      value: String(deal.value || ''),
      stageId: deal.stageId,
      contactId: deal.contact.id,
      notes: deal.notes || '',
    })
    setDealModal({ mode: 'edit', deal })
  }

  const openChat = async (deal: Deal) => {
    if (!deal.contact?.phone) {
      toast.error('Contato sem telefone')
      return
    }
    setChatDeal(deal)
    setChatConv(null)
    setChatMoveOpen(false)
    setChatEndOpen(false)
    // Zera o badge de não-lido do card otimista (abrir a conversa marca como lido
    // no backend via getMessages); sem isso o badge só some ao recarregar.
    const hadUnread = (deal.unreadCount ?? 0) > 0
    const setUnread = (value: number) =>
      setPipeline((prev) => prev ? {
        ...prev,
        stages: prev.stages.map((s) => ({ ...s, deals: s.deals.map((d) => d.id === deal.id ? { ...d, unreadCount: value } : d) })),
      } : prev)
    if (hadUnread) setUnread(0)
    try {
      const { data } = await api.get('/whatsapp/conversations/by-phone', { params: { phone: deal.contact.phone } })
      setChatConv(data)
    } catch {
      setChatConv(false)
      // Não havia conversa para marcar como lida → restaura o badge zerado à toa.
      if (hadUnread) setUnread(deal.unreadCount ?? 0)
    }
  }

  const closeChat = () => { setChatDeal(null); setChatConv(null); setChatMoveOpen(false); setChatEndOpen(false) }

  // Move o card (do modal de chat) para outro estágio, sem fechar o modal.
  const moveChatDeal = async (stageId: string) => {
    if (!chatDeal || chatDeal.stageId === stageId) { setChatMoveOpen(false); return }
    setChatMoveOpen(false)
    setChatDeal((d) => (d ? { ...d, stageId } : d))
    try {
      await api.patch(`/pipeline/deals/${chatDeal.id}/move`, { stageId })
      const st = pipeline?.stages.find((s) => s.id === stageId)
      toast.success(st ? `Movido para ${st.name}` : 'Negócio movido')
      load()
    } catch {
      toast.error('Erro ao mover negócio')
      load()
    }
  }

  // Finaliza o card (do modal de chat): ganho ou perdido. Fecha o modal.
  const endChatDeal = async (status: 'WON' | 'LOST') => {
    if (!chatDeal) return
    setChatEndOpen(false)
    const deal = chatDeal
    closeChat()
    await setDealStatus(deal, status)
  }

  const handleDrop = async (stageId: string) => {
    if (!dragging || !pipeline) return
    const deal = pipeline.stages.flatMap((s) => s.deals).find((d) => d.id === dragging)
    if (!deal || deal.stageId === stageId) {
      setDragging(null)
      setDragOver(null)
      return
    }
    setPipeline((prev) => {
      if (!prev) return prev
      const stages = prev.stages.map((s) => ({
        ...s,
        deals: s.id === stageId
          ? [...s.deals.filter((d) => d.id !== dragging), { ...deal, stageId }]
          : s.deals.filter((d) => d.id !== dragging),
      }))
      return { ...prev, stages }
    })
    setDragging(null)
    setDragOver(null)
    try {
      await api.patch(`/pipeline/deals/${dragging}/move`, { stageId })
    } catch {
      toast.error('Erro ao mover negócio')
      load()
    }
  }

  const submitDeal = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!dealForm.title.trim() || !dealForm.stageId || saving) return
    if (dealModal?.mode === 'create' && !dealForm.contactId && contacts.length === 0) {
      toast.error('Cadastre um contato primeiro')
      return
    }
    setSaving(true)
    try {
      const payload: any = {
        title: dealForm.title.trim(),
        value: parseFloat(dealForm.value) || 0,
        stageId: dealForm.stageId,
        notes: dealForm.notes || undefined,
      }
      if (dealModal?.mode === 'edit' && dealModal.deal) {
        await api.patch(`/pipeline/deals/${dealModal.deal.id}`, payload)
        toast.success('Negócio atualizado')
      } else {
        await api.post('/pipeline/deals', { ...payload, contactId: dealForm.contactId || contacts[0]?.id })
        toast.success('Negócio criado')
      }
      setDealModal(null)
      load()
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Erro ao salvar')
    }
    setSaving(false)
  }

  const handleDeleteDeal = async (deal: Deal) => {
    const ok = await confirmToast(`Excluir "${deal.title}"?`, { confirmLabel: 'Excluir', danger: true })
    if (!ok) return
    try {
      await api.delete(`/pipeline/deals/${deal.id}`)
      toast.success('Negócio excluído')
      load()
    } catch {
      toast.error('Erro ao excluir')
    }
  }

  const setDealStatus = async (deal: Deal, status: 'WON' | 'LOST' | 'OPEN') => {
    try {
      await api.patch(`/pipeline/deals/${deal.id}`, {
        status,
        closedAt: status !== 'OPEN' ? new Date().toISOString() : null,
      })
      toast.success(status === 'WON' ? 'Negócio ganho!' : status === 'LOST' ? 'Negócio perdido' : 'Negócio reaberto')
      load()
    } catch {
      toast.error('Erro ao atualizar status')
    }
  }

  const submitStage = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!pipeline || !stageForm.name.trim() || saving) return
    setSaving(true)
    try {
      await api.post(`/pipeline/${pipeline.id}/stages`, { name: stageForm.name.trim(), color: stageForm.color })
      toast.success('Estágio criado')
      setStageModal(false)
      setStageForm({ name: '', color: STAGE_COLORS[0] })
      load()
    } catch {
      toast.error('Erro ao criar estágio')
    }
    setSaving(false)
  }

  const submitPipeline = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!pipelineForm.trim() || saving) return
    setSaving(true)
    try {
      await api.post('/pipeline', { name: pipelineForm.trim() })
      toast.success('Funil criado')
      setPipelineModal(false)
      setPipelineForm('')
      load()
    } catch {
      toast.error('Erro ao criar funil')
    }
    setSaving(false)
  }

  const openRename = () => {
    if (!pipeline) return
    setRenameForm(pipeline.name)
    setRenameModal(true)
  }

  const submitRename = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!pipeline || !renameForm.trim() || saving) return
    setSaving(true)
    try {
      await api.patch(`/pipeline/${pipeline.id}`, { name: renameForm.trim() })
      toast.success('Funil renomeado')
      setRenameModal(false)
      load()
    } catch {
      toast.error('Erro ao renomear funil')
    }
    setSaving(false)
  }

  // Reavaliação com IA: roda o preview (sem aplicar) e abre o modal de resumo.
  const runReeval = async () => {
    if (reevalLoading) return
    setReevalLoading(true)
    try {
      const { data } = await api.post('/pipeline/reevaluate', { apply: false }, { timeout: 180000 })
      setReevalResult(data)
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Erro ao reavaliar pipeline')
    }
    setReevalLoading(false)
  }

  // Aplica as mudanças sugeridas pela reavaliação.
  const applyReeval = async () => {
    if (reevalApplying) return
    setReevalApplying(true)
    try {
      const { data } = await api.post('/pipeline/reevaluate', { apply: true }, { timeout: 180000 })
      const c = data.counts
      toast.success(`Pipeline reorganizada: ${c.win} fechados, ${c.move} movidos, ${c.remove} removidos`)
      setReevalResult(null)
      load()
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Erro ao aplicar mudanças')
    }
    setReevalApplying(false)
  }

  // Limpar inativos: roda o preview (sem aplicar) e abre o modal, ou avisa se vazio.
  const runCleanInactive = async () => {
    if (inactiveLoading) return
    setInactiveLoading(true)
    try {
      const { data } = await api.post('/pipeline/clean-inactive', { apply: false }, { timeout: 60000 })
      if (!data.count) toast('Nenhum card inativo no momento', { icon: '✅' })
      else setInactiveResult(data)
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Erro ao verificar inativos')
    }
    setInactiveLoading(false)
  }

  // Aplica a remoção dos inativos.
  const applyCleanInactive = async () => {
    if (inactiveApplying) return
    setInactiveApplying(true)
    try {
      const { data } = await api.post('/pipeline/clean-inactive', { apply: true }, { timeout: 60000 })
      toast.success(`${data.count} card(s) inativo(s) removido(s)`)
      setInactiveResult(null)
      load()
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Erro ao remover inativos')
    }
    setInactiveApplying(false)
  }

  const renderPipelineModal = () => {
    if (!pipelineModal) return null
    return (
      <Modal onClose={() => !saving && setPipelineModal(false)} title="Novo funil">
        <form onSubmit={submitPipeline} className="space-y-3">
          <Field label="Nome do funil *">
            <input
              autoFocus
              value={pipelineForm}
              onChange={(e) => setPipelineForm(e.target.value)}
              placeholder="Vendas B2B"
              disabled={saving}
              className={inputCls}
              style={{ background: 'hsl(var(--surface-sunken))' }}
            />
          </Field>
          <p className="text-[11px] text-muted-foreground">5 estágios padrão serão criados automaticamente.</p>
          <FormActions saving={saving} onCancel={() => setPipelineModal(false)} label="Criar funil" />
        </form>
      </Modal>
    )
  }

  if (loading) {
    return <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">Carregando pipeline...</div>
  }

  if (!pipeline) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-center gap-4">
        <div className="w-16 h-16 rounded-full flex items-center justify-center" style={{ background: '#00AEEF15' }}>
          <Plus className="w-8 h-8" style={{ color: '#00AEEF' }} />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-foreground mb-1">Nenhum funil ainda</h2>
          <p className="text-sm text-muted-foreground">Crie seu primeiro funil de vendas para começar</p>
        </div>
        <button onClick={() => setPipelineModal(true)} className="btn-primary">
          <Plus className="w-4 h-4" /> Criar funil
        </button>
        {renderPipelineModal()}
      </div>
    )
  }

  const totalValue = pipeline.stages.flatMap((s) => s.deals).filter((d) => d.status === 'OPEN').reduce((a, d) => a + d.value, 0)
  const totalDeals = pipeline.stages.flatMap((s) => s.deals).length

  return (
    <div className="h-full flex flex-col space-y-4">
      <div className="flex items-center justify-between flex-shrink-0 gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <h1 className="text-xl font-bold text-foreground truncate">{pipeline.name}</h1>
            <button
              onClick={openRename}
              title="Renomear funil"
              className="p-1 rounded hover:bg-accent transition flex-shrink-0 text-muted-foreground hover:text-foreground"
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>
          </div>
          <p className="text-sm text-muted-foreground mt-0.5">
            {totalDeals} negócios · <span style={{ color: '#00AEEF' }}>{formatCurrency(totalValue)}</span> em aberto
          </p>
        </div>
        <div className="flex gap-2 flex-shrink-0">
          <button
            onClick={runReeval}
            disabled={reevalLoading}
            title="Analisar todos os cards com IA e reorganizar a pipeline"
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:bg-accent transition disabled:opacity-50"
          >
            {reevalLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
            {reevalLoading ? 'Analisando...' : 'Reavaliar'}
          </button>
          <button
            onClick={runCleanInactive}
            disabled={inactiveLoading}
            title="Remover cards de clientes há 4h+ sem responder"
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:bg-accent transition disabled:opacity-50"
          >
            {inactiveLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Clock className="w-3.5 h-3.5" />}
            {inactiveLoading ? 'Verificando...' : 'Limpar inativos'}
          </button>
          <button onClick={() => setStageModal(true)} className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:bg-accent transition">
            <Plus className="w-3.5 h-3.5" /> Estágio
          </button>
          <button onClick={() => openCreateDeal()} className="btn-primary">
            <Plus className="w-4 h-4" /> Novo negócio
          </button>
        </div>
      </div>

      <div className="flex gap-3 overflow-x-auto pb-2 flex-1 min-h-0">
        {pipeline.stages.slice().sort((a, b) => a.order - b.order).map((stage) => {
          const stageValue = stage.deals.filter((d) => d.status === 'OPEN').reduce((a, d) => a + d.value, 0)
          return (
            <div
              key={stage.id}
              className="flex-shrink-0 w-64 flex flex-col rounded-xl border transition"
              style={{
                background: dragOver === stage.id ? stage.color + '08' : 'hsl(var(--surface-1))',
                borderColor: dragOver === stage.id ? stage.color + '50' : 'hsl(var(--border))',
              }}
              onDragOver={(e) => { e.preventDefault(); setDragOver(stage.id) }}
              onDrop={() => handleDrop(stage.id)}
              onDragLeave={() => setDragOver(null)}
            >
              <div className="px-3 py-2.5 border-b border-border flex-shrink-0">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: stage.color, boxShadow: `0 0 6px ${stage.color}` }} />
                    <span className="text-xs font-semibold text-foreground uppercase tracking-wide truncate">{stage.name}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full border border-border text-muted-foreground flex-shrink-0">{stage.deals.length}</span>
                  </div>
                  <button
                    onClick={() => openCreateDeal(stage.id)}
                    className="p-0.5 rounded hover:bg-accent transition flex-shrink-0"
                    title="Novo negócio neste estágio"
                  >
                    <Plus className="w-3.5 h-3.5 text-muted-foreground" />
                  </button>
                </div>
                <p className="text-xs font-medium" style={{ color: stage.color }}>{formatCurrency(stageValue)}</p>
              </div>

              <div className="flex-1 p-2 space-y-2 overflow-y-auto">
                {stage.deals.map((deal) => (
                  <div
                    key={deal.id}
                    draggable
                    onDragStart={() => setDragging(deal.id)}
                    onDragEnd={() => { setDragging(null); setDragOver(null) }}
                    onClick={() => openEditDeal(deal)}
                    className="relative rounded-lg p-3 border cursor-grab active:cursor-grabbing transition group"
                    style={{
                      background: dragging === deal.id ? stage.color + '08' : 'hsl(var(--surface-3))',
                      borderColor: dragging === deal.id
                        ? stage.color + '40'
                        : (deal.unreadCount ?? 0) > 0 ? '#00AEEF70'
                        : deal.status === 'WON' ? '#10B98140'
                        : deal.status === 'LOST' ? '#EF444440'
                        : 'hsl(var(--border))',
                      boxShadow: (deal.unreadCount ?? 0) > 0 ? '0 0 0 1px #00AEEF30, 0 0 12px #00AEEF20' : undefined,
                      opacity: dragging === deal.id ? 0.6 : deal.status !== 'OPEN' ? 0.7 : 1,
                    }}
                  >
                    <div className="flex items-start justify-between gap-1 mb-2">
                      <p className="text-xs font-semibold text-foreground leading-snug flex-1">{deal.title}</p>
                      <div className="flex items-center gap-0.5 flex-shrink-0">
                        {(deal.unreadCount ?? 0) > 0 && (
                          <span
                            className="flex items-center gap-0.5 px-1.5 h-4 rounded-full text-[9px] font-bold text-white flex-shrink-0"
                            style={{ background: '#00AEEF', boxShadow: '0 0 6px #00AEEF60' }}
                            title={`${deal.unreadCount} mensagem(ns) não lida(s)`}
                          >
                            <MessageCircle className="w-2.5 h-2.5" />
                            {(deal.unreadCount ?? 0) > 9 ? '9+' : deal.unreadCount}
                          </span>
                        )}
                        {deal.contact?.phone && (
                          <button
                            onClick={(e) => { e.stopPropagation(); openChat(deal) }}
                            title="Abrir conversa no WhatsApp"
                            className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-accent transition"
                          >
                            <MessageCircle className="w-3 h-3" style={{ color: '#00AEEF' }} />
                          </button>
                        )}
                        <button
                          onClick={(e) => { e.stopPropagation(); setMenuOpen(menuOpen === deal.id ? null : deal.id) }}
                          className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-accent transition"
                        >
                          <MoreHorizontal className="w-3 h-3 text-muted-foreground" />
                        </button>
                      </div>
                    </div>
                    {deal.contact && <p className="text-[10px] text-muted-foreground mb-2 truncate">{deal.contact.name}</p>}
                    {deal.notes?.startsWith('IA:') && (
                      <div className="mb-2">
                        <div className="flex items-center gap-1 flex-wrap mb-1">
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-medium bg-primary/10 text-primary">
                            <Sparkles className="w-2.5 h-2.5" /> Sugerido por IA
                          </span>
                          {aiConfidence(deal.notes) !== null && (
                            <span
                              className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold"
                              style={{ background: stage.color + '25', color: stage.color }}
                              title="Confiança da IA"
                            >
                              {aiConfidence(deal.notes)}%
                            </span>
                          )}
                        </div>
                        {aiReason(deal.notes) && (
                          <div
                            onClick={(e) => { e.stopPropagation(); toggleAiExpand(deal.id) }}
                            className="rounded-md px-2 py-1.5 cursor-pointer transition hover:bg-accent/50"
                            style={{ background: 'hsl(var(--surface-1))', border: '1px solid hsl(var(--border))' }}
                            title={expandedAi.has(deal.id) ? 'Recolher' : 'Ver resumo completo'}
                          >
                            <p className={`text-[10px] leading-snug text-muted-foreground ${expandedAi.has(deal.id) ? '' : 'line-clamp-2'}`}>
                              {aiReason(deal.notes)}
                            </p>
                            <span className="text-[9px] font-medium text-primary mt-0.5 inline-block">
                              {expandedAi.has(deal.id) ? 'ver menos ▲' : 'ver mais ▼'}
                            </span>
                          </div>
                        )}
                      </div>
                    )}
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold" style={{ color: stage.color }}>{formatCurrency(deal.value)}</span>
                      <div className="flex items-center gap-1">
                        {deal.status === 'WON' && <Trophy className="w-3 h-3" style={{ color: '#10B981' }} />}
                        {deal.status === 'LOST' && <XCircle className="w-3 h-3" style={{ color: '#EF4444' }} />}
                        <div className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold" style={{ background: stage.color + '25', color: stage.color }}>
                          {deal.contact?.name?.[0]?.toUpperCase() || '?'}
                        </div>
                      </div>
                    </div>

                    {menuOpen === deal.id && (
                      <div
                        onClick={(e) => e.stopPropagation()}
                        className="absolute right-2 top-7 z-10 rounded-lg border border-border shadow-lg overflow-hidden"
                        style={{ background: 'hsl(var(--surface-3))', minWidth: 160 }}
                      >
                        <button onClick={() => { openEditDeal(deal); setMenuOpen(null) }} className="flex items-center gap-2 px-3 py-2 text-xs w-full text-left hover:bg-accent transition">
                          <Pencil className="w-3 h-3" /> Editar
                        </button>
                        {deal.status !== 'WON' && (
                          <button onClick={() => { setDealStatus(deal, 'WON'); setMenuOpen(null) }} className="flex items-center gap-2 px-3 py-2 text-xs w-full text-left hover:bg-accent transition" style={{ color: '#10B981' }}>
                            <Trophy className="w-3 h-3" /> Marcar ganho
                          </button>
                        )}
                        {deal.status !== 'LOST' && (
                          <button onClick={() => { setDealStatus(deal, 'LOST'); setMenuOpen(null) }} className="flex items-center gap-2 px-3 py-2 text-xs w-full text-left hover:bg-accent transition" style={{ color: '#EF4444' }}>
                            <XCircle className="w-3 h-3" /> Marcar perdido
                          </button>
                        )}
                        {deal.status !== 'OPEN' && (
                          <button onClick={() => { setDealStatus(deal, 'OPEN'); setMenuOpen(null) }} className="flex items-center gap-2 px-3 py-2 text-xs w-full text-left hover:bg-accent transition">
                            Reabrir
                          </button>
                        )}
                        <button onClick={() => { handleDeleteDeal(deal); setMenuOpen(null) }} className="flex items-center gap-2 px-3 py-2 text-xs w-full text-left hover:bg-accent transition border-t border-border" style={{ color: '#EF4444' }}>
                          <Trash2 className="w-3 h-3" /> Excluir
                        </button>
                      </div>
                    )}
                  </div>
                ))}
                {stage.deals.length === 0 && (
                  <div className="text-center py-6 text-xs text-muted-foreground border border-dashed border-border rounded-lg">
                    Arraste negócios aqui
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {dealModal && (
        <Modal onClose={() => !saving && setDealModal(null)} title={dealModal.mode === 'edit' ? 'Editar negócio' : 'Novo negócio'}>
          <form onSubmit={submitDeal} className="space-y-3">
            <Field label="Título *">
              <input autoFocus value={dealForm.title} onChange={(e) => setDealForm((f) => ({ ...f, title: e.target.value }))} required placeholder="Ex: Contrato Anual" disabled={saving} className={inputCls} style={{ background: 'hsl(var(--surface-sunken))' }} />
            </Field>
            <Field label="Valor (R$)">
              <input type="number" step="0.01" value={dealForm.value} onChange={(e) => setDealForm((f) => ({ ...f, value: e.target.value }))} placeholder="0,00" disabled={saving} className={inputCls} style={{ background: 'hsl(var(--surface-sunken))' }} />
            </Field>
            <Field label="Estágio *">
              <select value={dealForm.stageId} onChange={(e) => setDealForm((f) => ({ ...f, stageId: e.target.value }))} required disabled={saving} className={inputCls} style={{ background: 'hsl(var(--surface-sunken))' }}>
                <option value="">Selecione...</option>
                {pipeline.stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
            {dealModal.mode === 'create' && (
              <Field label="Contato *">
                <select value={dealForm.contactId} onChange={(e) => setDealForm((f) => ({ ...f, contactId: e.target.value }))} required disabled={saving} className={inputCls} style={{ background: 'hsl(var(--surface-sunken))' }}>
                  <option value="">Selecione...</option>
                  {contacts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </Field>
            )}
            <Field label="Observações">
              <textarea value={dealForm.notes} onChange={(e) => setDealForm((f) => ({ ...f, notes: e.target.value }))} rows={2} disabled={saving} className={inputCls} style={{ background: 'hsl(var(--surface-sunken))' }} />
            </Field>
            <FormActions saving={saving} onCancel={() => setDealModal(null)} label={dealModal.mode === 'edit' ? 'Salvar' : 'Criar negócio'} />
          </form>
        </Modal>
      )}

      {stageModal && (
        <Modal onClose={() => !saving && setStageModal(false)} title="Novo estágio">
          <form onSubmit={submitStage} className="space-y-3">
            <Field label="Nome *">
              <input autoFocus value={stageForm.name} onChange={(e) => setStageForm((f) => ({ ...f, name: e.target.value }))} required placeholder="Ex: Reunião agendada" disabled={saving} className={inputCls} style={{ background: 'hsl(var(--surface-sunken))' }} />
            </Field>
            <Field label="Cor">
              <div className="flex gap-2 flex-wrap">
                {STAGE_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setStageForm((f) => ({ ...f, color: c }))}
                    className="w-7 h-7 rounded-full border-2 transition"
                    style={{ background: c, borderColor: stageForm.color === c ? '#fff' : 'transparent' }}
                  />
                ))}
              </div>
            </Field>
            <FormActions saving={saving} onCancel={() => setStageModal(false)} label="Criar estágio" />
          </form>
        </Modal>
      )}

      {chatDeal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)' }}
          onClick={(e) => e.target === e.currentTarget && closeChat()}
        >
          <div
            className="rounded-2xl border border-border w-full max-w-2xl flex flex-col overflow-hidden"
            style={{ background: 'hsl(var(--surface-1))', height: 'min(80vh, 640px)' }}
          >
            <div className="flex items-center gap-3 px-4 py-3 border-b border-border flex-shrink-0" style={{ background: 'hsl(var(--surface-2))' }}>
              <div className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold overflow-hidden flex-shrink-0" style={{ background: '#00AEEF20', color: '#00AEEF' }}>
                {chatConv && chatConv.profilePicUrl ? (
                  <img src={chatConv.profilePicUrl} alt="" className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
                ) : (
                  (chatDeal.contact?.name?.[0] || '?').toUpperCase()
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-foreground truncate">{chatDeal.contact?.name || 'Conversa'}</p>
                {chatDeal.contact?.phone && <p className="text-[10px] text-muted-foreground truncate">{chatDeal.contact.phone}</p>}
              </div>

              {/* Mover de estágio (transferir no funil) */}
              <div className="relative flex-shrink-0">
                <button
                  onClick={() => { setChatMoveOpen((v) => !v); setChatEndOpen(false) }}
                  title="Mover no funil"
                  className="p-2 rounded-lg hover:bg-accent transition flex items-center gap-1 text-muted-foreground"
                >
                  <GitBranch className="w-3.5 h-3.5" /><span className="text-[10px] font-medium hidden sm:inline">Funil</span>
                </button>
                {chatMoveOpen && (
                  <div className="absolute right-0 top-full mt-1 z-20 w-52 rounded-lg border border-border shadow-lg py-1" style={{ background: 'hsl(var(--surface-3))' }}>
                    <p className="px-3 py-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">Mover para estágio</p>
                    {pipeline.stages.map((s) => {
                      const active = chatDeal.stageId === s.id
                      return (
                        <button key={s.id} onClick={() => moveChatDeal(s.id)} className="w-full text-left px-3 py-1.5 text-xs hover:bg-accent flex items-center gap-2" style={active ? { background: s.color + '15' } : {}}>
                          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: s.color }} />
                          <span className="flex-1 truncate" style={active ? { color: s.color, fontWeight: 600 } : {}}>{s.name}</span>
                          {active && <Check className="w-3 h-3 flex-shrink-0" style={{ color: s.color }} />}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* Finalizar (ganho / perdido) */}
              <div className="relative flex-shrink-0">
                <button
                  onClick={() => { setChatEndOpen((v) => !v); setChatMoveOpen(false) }}
                  title="Finalizar negócio"
                  className="p-2 rounded-lg hover:bg-accent transition flex items-center gap-1 text-muted-foreground"
                >
                  <Flag className="w-3.5 h-3.5" /><span className="text-[10px] font-medium hidden sm:inline">Finalizar</span>
                </button>
                {chatEndOpen && (
                  <div className="absolute right-0 top-full mt-1 z-20 w-44 rounded-lg border border-border shadow-lg py-1" style={{ background: 'hsl(var(--surface-3))' }}>
                    <button onClick={() => endChatDeal('WON')} className="w-full text-left px-3 py-2 text-xs hover:bg-accent flex items-center gap-2" style={{ color: '#10B981' }}>
                      <Trophy className="w-3 h-3" /> Marcar ganho
                    </button>
                    <button onClick={() => endChatDeal('LOST')} className="w-full text-left px-3 py-2 text-xs hover:bg-accent flex items-center gap-2" style={{ color: '#EF4444' }}>
                      <XCircle className="w-3 h-3" /> Perdido / esfriou
                    </button>
                  </div>
                )}
              </div>

              <button onClick={closeChat} className="p-1.5 rounded-lg hover:bg-accent transition flex-shrink-0">
                <X className="w-4 h-4" />
              </button>
            </div>

            {chatConv === null && (
              <div className="flex-1 flex items-center justify-center">
                <Loader2 className="w-6 h-6 animate-spin" style={{ color: '#00AEEF' }} />
              </div>
            )}
            {chatConv === false && (
              <div className="flex-1 flex flex-col items-center justify-center gap-2 text-center px-6">
                <MessageCircle className="w-8 h-8 text-muted-foreground opacity-40" />
                <p className="text-sm text-muted-foreground">Nenhuma conversa no WhatsApp para este contato ainda</p>
              </div>
            )}
            {chatConv && (
              <ConversationChat
                conversationId={chatConv.id}
                instanceId={chatConv.instanceId}
                remoteJid={chatConv.remoteJid}
              />
            )}
          </div>
        </div>
      )}

      {renameModal && (
        <Modal onClose={() => !saving && setRenameModal(false)} title="Renomear funil">
          <form onSubmit={submitRename} className="space-y-3">
            <Field label="Nome do funil *">
              <input
                autoFocus
                value={renameForm}
                onChange={(e) => setRenameForm(e.target.value)}
                placeholder="Vendas B2B"
                disabled={saving}
                className={inputCls}
                style={{ background: 'hsl(var(--surface-sunken))' }}
              />
            </Field>
            <FormActions saving={saving} onCancel={() => setRenameModal(false)} label="Salvar" />
          </form>
        </Modal>
      )}

      {reevalResult && (
        <ReevalModal
          result={reevalResult}
          applying={reevalApplying}
          onClose={() => !reevalApplying && setReevalResult(null)}
          onApply={applyReeval}
        />
      )}

      {inactiveResult && (
        <InactiveModal
          result={inactiveResult}
          applying={inactiveApplying}
          onClose={() => !inactiveApplying && setInactiveResult(null)}
          onApply={applyCleanInactive}
        />
      )}

      {renderPipelineModal()}
    </div>
  )
}

// ─── Modal de resumo da reavaliação com IA ──────────────────────────
const REEVAL_META: Record<ReevalItem['action'], { label: string; color: string }> = {
  win: { label: 'Ganho', color: '#10B981' },
  move: { label: 'Mover', color: '#0ea5e9' },
  remove: { label: 'Remover', color: '#EF4444' },
  keep: { label: 'Manter', color: '#64748b' },
}

function ReevalModal({
  result,
  applying,
  onClose,
  onApply,
}: {
  result: ReevalResult
  applying: boolean
  onClose: () => void
  onApply: () => void
}) {
  const { counts, items, truncated } = result
  // Ordena: mudanças primeiro (ganho, mover, remover), manter por último.
  const order: Record<ReevalItem['action'], number> = { win: 0, move: 1, remove: 2, keep: 3 }
  const sorted = [...items].sort((a, b) => order[a.action] - order[b.action])
  const hasChanges = counts.win > 0 || counts.move > 0 || counts.remove > 0

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)' }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="rounded-2xl border border-border w-full max-w-lg flex flex-col overflow-hidden"
        style={{ background: 'hsl(var(--surface-1))', height: 'min(80vh, 620px)' }}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4" style={{ color: '#00AEEF' }} />
            <h2 className="text-base font-semibold text-foreground">Reavaliação da pipeline</h2>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-accent transition"><X className="w-4 h-4" /></button>
        </div>

        <div className="flex gap-2 px-5 py-3 border-b border-border flex-shrink-0 flex-wrap">
          <Counter label="ganhos" value={counts.win} color="#10B981" />
          <Counter label="mover" value={counts.move} color="#0ea5e9" />
          <Counter label="remover" value={counts.remove} color="#EF4444" />
          <Counter label="manter" value={counts.keep} color="#64748b" />
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1.5">
          {sorted.map((item) => {
            const meta = REEVAL_META[item.action]
            return (
              <div key={item.dealId} className="rounded-lg border border-border p-2.5" style={{ background: 'hsl(var(--surface-3))' }}>
                <div className="flex items-center justify-between gap-2 mb-1">
                  <p className="text-xs font-semibold text-foreground truncate">{item.contactName || item.title}</p>
                  <span
                    className="text-[9px] font-bold px-1.5 py-0.5 rounded flex-shrink-0"
                    style={{ background: meta.color + '25', color: meta.color }}
                  >
                    {meta.label}
                  </span>
                </div>
                <p className="text-[10px] text-muted-foreground mb-0.5">
                  {item.action === 'move'
                    ? `${item.fromStage} → ${item.toStage}`
                    : item.action === 'win'
                    ? `${item.fromStage} → Ganho${item.value != null ? ` · ${formatCurrency(item.value)}` : ''}`
                    : item.fromStage}
                </p>
                <p className="text-[10px] text-muted-foreground leading-snug">{item.reason}</p>
              </div>
            )
          })}
          {items.length === 0 && (
            <div className="text-center py-10 text-xs text-muted-foreground">Nenhum card para avaliar.</div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-border flex-shrink-0">
          {truncated && (
            <p className="text-[10px] text-amber-500/80 mb-2">
              Muitos cards — só os {counts.total} mais recentes foram avaliados nesta rodada.
            </p>
          )}
          {!hasChanges && (
            <p className="text-[11px] text-muted-foreground mb-2">Nenhuma mudança sugerida pela IA.</p>
          )}
          <div className="flex gap-2">
            <button
              onClick={onClose}
              disabled={applying}
              className="flex-1 py-2.5 rounded-lg border border-border text-sm text-muted-foreground hover:bg-accent transition disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              onClick={onApply}
              disabled={applying || !hasChanges}
              className="btn-primary flex-1 justify-center disabled:opacity-50"
            >
              {applying ? 'Aplicando...' : 'Aplicar mudanças'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function Counter({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-border" style={{ background: 'hsl(var(--surface-3))' }}>
      <span className="text-sm font-bold" style={{ color }}>{value}</span>
      <span className="text-[11px] text-muted-foreground">{label}</span>
    </div>
  )
}

// "há quanto tempo" desde a última resposta do cliente.
function sinceLabel(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const h = Math.floor(diff / 3600_000)
  if (h < 24) return `há ${h}h sem responder`
  const d = Math.floor(h / 24)
  return `há ${d} dia${d > 1 ? 's' : ''} sem responder`
}

// ─── Modal de limpeza de inativos ───────────────────────────────────
function InactiveModal({
  result, applying, onClose, onApply,
}: {
  result: InactiveResult
  applying: boolean
  onClose: () => void
  onApply: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)' }} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="rounded-2xl border border-border w-full max-w-lg flex flex-col overflow-hidden" style={{ background: 'hsl(var(--surface-1))', height: 'min(80vh, 560px)' }}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4" style={{ color: '#F59E0B' }} />
            <h2 className="text-base font-semibold text-foreground">Limpar cards inativos</h2>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-accent transition"><X className="w-4 h-4" /></button>
        </div>

        <div className="px-5 py-3 border-b border-border flex-shrink-0">
          <p className="text-xs text-muted-foreground">
            {result.count} card(s) com cliente há {result.hours}h+ sem responder. Eles voltam ao funil automaticamente se mandarem nova mensagem.
          </p>
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1.5">
          {result.items.map((item) => (
            <div key={item.dealId} className="rounded-lg border border-border p-2.5" style={{ background: 'hsl(var(--surface-3))' }}>
              <p className="text-xs font-semibold text-foreground truncate">{item.contactName || item.title}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">{sinceLabel(item.lastInbound)}</p>
            </div>
          ))}
          {result.items.length === 0 && <div className="text-center py-10 text-xs text-muted-foreground">Nenhum card inativo.</div>}
        </div>

        <div className="px-5 py-3 border-t border-border flex-shrink-0 flex gap-2">
          <button onClick={onClose} disabled={applying} className="flex-1 py-2.5 rounded-lg border border-border text-sm text-muted-foreground hover:bg-accent transition disabled:opacity-50">Cancelar</button>
          <button onClick={onApply} disabled={applying || result.count === 0} className="flex-1 py-2.5 rounded-lg text-sm font-semibold text-foreground justify-center flex items-center gap-1.5 transition disabled:opacity-50" style={{ background: 'linear-gradient(135deg, #EF4444, #DC2626)', boxShadow: '0 0 12px #EF444440' }}>
            {applying ? 'Removendo...' : `Remover ${result.count}`}
          </button>
        </div>
      </div>
    </div>
  )
}

function Modal({ children, onClose, title }: { children: React.ReactNode; onClose: () => void; title: string }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)' }} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="rounded-2xl p-6 w-full max-w-md border border-border" style={{ background: 'hsl(var(--surface-1))' }}>
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold text-foreground">{title}</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-accent transition"><X className="w-4 h-4" /></button>
        </div>
        {children}
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs font-medium text-muted-foreground block mb-1">{label}</label>
      {children}
    </div>
  )
}

function FormActions({ saving, onCancel, label }: { saving: boolean; onCancel: () => void; label: string }) {
  return (
    <div className="flex gap-2 pt-2">
      <button type="button" onClick={onCancel} disabled={saving} className="flex-1 py-2.5 rounded-lg border border-border text-sm text-muted-foreground hover:bg-accent transition disabled:opacity-50">
        Cancelar
      </button>
      <button type="submit" disabled={saving} className="btn-primary flex-1 justify-center disabled:opacity-50">
        {saving ? 'Salvando...' : label}
      </button>
    </div>
  )
}
