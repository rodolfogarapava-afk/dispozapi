'use client'
export const dynamic = 'force-dynamic'
import { useEffect, useState, useRef, useCallback } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import toast from 'react-hot-toast'
import { api } from '@/lib/api'
import { wsClient } from '@/lib/ws'
import { Send, RefreshCw, Wifi, WifiOff, QrCode, Search, Phone, MoreVertical, Check, CheckCheck, Paperclip, MessageSquare, X, Loader2, Trash2, Users, Bot, Pause, Play, Sparkles, ArrowLeft, GitBranch, Mic, Filter, Trophy, Flag } from 'lucide-react'
import { confirmToast } from '@/lib/confirm'
import { MediaBubble } from '@/components/whatsapp/media-bubble'
import { sendFileMessage } from '@/lib/upload'
import { useAudioRecorder } from '@/lib/use-audio-recorder'

interface Instance { id: string; name: string; status: string }
interface Conversation {
  id: string
  instanceId: string
  remoteJid: string
  pushName?: string
  lastMessage?: string
  lastMessageAt?: string
  unreadCount: number
  profilePicUrl?: string | null
  isGroup?: boolean
  botPaused?: boolean
  botPausedUntil?: string | null
  botPausedReason?: string | null
  aiCategory?: string | null
  stageId?: string | null
  stageName?: string | null
  stageColor?: string | null
}

// Rótulo/cor por motivo de pausa do bot.
const PAUSE_LABELS: Record<string, { label: string; color: string }> = {
  HUMANO: { label: 'Humano atendendo', color: '#f59e0b' },
  SUPORTE: { label: 'Suporte', color: '#0ea5e9' },
  FECHADO: { label: 'Venda fechada', color: '#10b981' },
  MANUAL: { label: 'Pausado', color: '#6b7280' },
}
const SALES_PIPELINE_ENABLED = false
function pauseInfo(reason?: string | null) {
  if (!reason) return { label: 'Pausado', color: '#6b7280' }
  return PAUSE_LABELS[reason] || { label: reason, color: '#8b5cf6' }
}
// "PROSPECCAO" -> "Prospeccao" (categoria da IA, exibida com sufixo "(IA)")
function titleCase(s?: string | null) {
  if (!s) return ''
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()
}
interface Message {
  id: string
  content: string
  senderName?: string | null
  fromMe: boolean
  timestamp: string
  status?: string
  mediaUrl?: string | null
  mediaType?: string | null
}

function uniqueMessages(items: Message[]) {
  const seenIds = new Set<string>()
  return items.filter((message) => {
    if (!message.id) return true
    if (seenIds.has(message.id)) return false
    seenIds.add(message.id)
    return true
  })
}

// Cor estável para o nome do remetente em grupos (estilo WhatsApp).
const SENDER_COLORS = ['#00AEEF', '#34D399', '#F59E0B', '#F472B6', '#A78BFA', '#FB7185', '#22D3EE', '#FACC15']
function senderColor(name?: string | null) {
  if (!name) return SENDER_COLORS[0]
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return SENDER_COLORS[h % SENDER_COLORS.length]
}

function sortConversations(items: Conversation[]) {
  return [...items].sort((a, b) => {
    const aTime = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0
    const bTime = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0
    return bTime - aTime
  })
}

export default function WhatsappPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [instances, setInstances] = useState<Instance[]>([])
  const [activeInstance, setActiveInstance] = useState<Instance | null>(null)
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [filtered, setFiltered] = useState<Conversation[]>([])
  const [activeConv, setActiveConv] = useState<Conversation | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [text, setText] = useState('')
  const [pendingImage, setPendingImage] = useState<{ file: File; preview: string } | null>(null)
  const [qrCode, setQrCode] = useState<string | null>(null)
  const [qrLoading, setQrLoading] = useState(false)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [newInstanceName, setNewInstanceName] = useState('')
  const [creatingInstance, setCreatingInstance] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [loadingInstances, setLoadingInstances] = useState(true)
  const [deleteTarget, setDeleteTarget] = useState<Instance | null>(null)
  const [deletingInstance, setDeletingInstance] = useState(false)
  const [loadingConvs, setLoadingConvs] = useState(false)
  const [loadingMsgs, setLoadingMsgs] = useState(false)
  const [sending, setSending] = useState(false)
  const [search, setSearch] = useState('')
  const [showPausedOnly, setShowPausedOnly] = useState(false)
  const [stageFilter, setStageFilter] = useState<string | null>(null) // stageId, null = todas
  const [filterMenuOpen, setFilterMenuOpen] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const activeConvRef = useRef<Conversation | null>(null)
  const activeInstanceRef = useRef<Instance | null>(null)
  const loadingInstancesRef = useRef(false)
  const loadingConversationsRef = useRef(false)
  const loadingMessagesRef = useRef<string | null>(null)

  const scrollToBottom = () => {
    setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50)
  }

  const mergeConversation = useCallback((conversation: Conversation, incomingMessage?: Message) => {
    setConversations((prev) => {
      const currentActiveId = activeConvRef.current?.id
      const exists = prev.some((item) => item.id === conversation.id)
      const nextConversation = {
        ...conversation,
        unreadCount:
          currentActiveId === conversation.id
            ? 0
            : incomingMessage && !incomingMessage.fromMe
              ? conversation.unreadCount
              : conversation.unreadCount,
      }
      const next = exists
        ? prev.map((item) => (item.id === conversation.id ? { ...item, ...nextConversation } : item))
        : [nextConversation, ...prev]
      return sortConversations(next)
    })

    setActiveConv((prev) => (prev?.id === conversation.id ? { ...prev, ...conversation } : prev))
  }, [])

  const loadInstances = useCallback(async () => {
    if (loadingInstancesRef.current) return
    loadingInstancesRef.current = true
    try {
      const r = await api.get('/whatsapp/instances')
      const data = r.data || []
      setInstances(data)
      setActiveInstance((prev) => {
        const next = prev ? data.find((item: Instance) => item.id === prev.id) || data[0] || null : data[0] || null
        if (prev && next && prev.id === next.id && prev.name === next.name && prev.status === next.status) return prev
        return next
      })
    } catch {} finally {
      loadingInstancesRef.current = false
      setLoadingInstances(false)
    }
  }, [])

  const qrPollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const qrRefreshRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const qrSessionRef = useRef(0)
  const stopQrPoll = useCallback(() => {
    if (qrPollRef.current) {
      clearInterval(qrPollRef.current)
      qrPollRef.current = null
    }
    if (qrRefreshRef.current) {
      clearInterval(qrRefreshRef.current)
      qrRefreshRef.current = null
    }
  }, [])

  const closeQr = useCallback(() => {
    qrSessionRef.current += 1
    setQrCode(null)
    setQrLoading(false)
    stopQrPoll()
  }, [stopQrPoll])

  const loadConversations = useCallback(async (silent = false) => {
    const instanceId = activeInstanceRef.current?.id
    if (!instanceId || loadingConversationsRef.current) return
    loadingConversationsRef.current = true
    if (!silent) setLoadingConvs(true)
    try {
      const r = await api.get('/whatsapp/conversations', { params: { instanceId } })
      if (activeInstanceRef.current?.id !== instanceId) return
      const data = sortConversations(r.data || [])
      setConversations(data)
      setFiltered(data)
      setActiveConv((prev) => (prev ? data.find((item) => item.id === prev.id) || null : null))
    } catch {} finally {
      loadingConversationsRef.current = false
      if (!silent) setLoadingConvs(false)
    }
  }, [])

  const loadMessages = useCallback(async (conv: Conversation, silent = false) => {
    if (loadingMessagesRef.current === conv.id) return
    loadingMessagesRef.current = conv.id
    if (!silent) {
      setLoadingMsgs(true)
      setMessages([])
    }
    try {
      const r = await api.get(`/whatsapp/conversations/${encodeURIComponent(conv.id)}/messages`)
      if (silent && activeConvRef.current?.id !== conv.id) return
      setMessages(uniqueMessages(r.data || []))
      setConversations((prev) => prev.map((item) => (item.id === conv.id ? { ...item, unreadCount: 0 } : item)))
      setActiveConv((prev) => (prev?.id === conv.id ? { ...prev, unreadCount: 0 } : prev))
      scrollToBottom()
    } catch {} finally {
      if (loadingMessagesRef.current === conv.id) loadingMessagesRef.current = null
      if (!silent) setLoadingMsgs(false)
    }
  }, [])

  useEffect(() => {
    const offMsg = wsClient.on('new_message', (payload: any) => {
      if (payload.instanceId !== activeInstanceRef.current?.id) return

      const nextConversation: Conversation = payload.conversation
      const nextMessage: Message = payload.message
      const isActiveConversation = payload.conversationId === activeConvRef.current?.id

      mergeConversation(
        {
          ...nextConversation,
          unreadCount: isActiveConversation ? 0 : nextConversation.unreadCount,
        },
        nextMessage
      )

      if (!isActiveConversation) return

      setMessages((prev) => {
        if (prev.some((item) => item.id === nextMessage.id)) return prev
        const updated = [...prev, nextMessage].sort(
          (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
        )
        scrollToBottom()
        return updated
      })
    })

    const offConn = wsClient.on('connection_update', (payload: any) => {
      setInstances((prev) => prev.map((item) => (item.id === payload.instanceId ? { ...item, status: payload.status } : item)))
      setActiveInstance((prev) => (prev && prev.id === payload.instanceId ? { ...prev, status: payload.status } : prev))
    })

    const offQr = wsClient.on('qrcode_updated', (payload: any) => {
      if (activeInstanceRef.current?.id === payload.instanceId) setQrCode(payload.qrCode)
    })

    const patchConvBot = (convId: string, patch: Partial<Conversation>) => {
      setConversations((prev) => prev.map((c) => (c.id === convId ? { ...c, ...patch } : c)))
      setActiveConv((prev) => (prev && prev.id === convId ? { ...prev, ...patch } : prev))
    }
    const offPaused = wsClient.on('bot_paused', (p: any) => {
      patchConvBot(p.conversationId, { botPaused: true, botPausedReason: p.botPausedReason, botPausedUntil: p.botPausedUntil })
    })
    const offResumed = wsClient.on('bot_resumed', (p: any) => {
      patchConvBot(p.conversationId, { botPaused: false, botPausedReason: null, botPausedUntil: null })
    })
    const offAi = wsClient.on('conversation_ai', (p: any) => {
      patchConvBot(p.conversationId, { aiCategory: p.aiCategory })
    })

    return () => {
      offMsg()
      offConn()
      offQr()
      offPaused()
      offResumed()
      offAi()
    }
  }, [mergeConversation])

  useEffect(() => {
    activeInstanceRef.current = activeInstance
  }, [activeInstance])

  useEffect(() => {
    if (!activeInstance) return
    setActiveConv(null)
    setMessages([])
    loadConversations()
    const poll = setInterval(() => void loadConversations(true), 8000)
    return () => clearInterval(poll)
  }, [activeInstance, loadConversations])

  useEffect(() => {
    activeConvRef.current = activeConv
  }, [activeConv])

  const activeConversationId = activeConv?.id
  useEffect(() => {
    if (!activeConversationId) return
    const poll = setInterval(() => {
      if (activeConvRef.current) void loadMessages(activeConvRef.current, true)
    }, 5000)
    return () => clearInterval(poll)
  }, [activeConversationId, loadMessages])

  useEffect(() => {
    loadInstances()
    const poll = setInterval(() => void loadInstances(), 15000)
    return () => {
      clearInterval(poll)
      stopQrPoll()
    }
  }, [loadInstances, stopQrPoll])

  useEffect(() => {
    let list = conversations
    if (showPausedOnly) list = list.filter((c) => c.botPaused)
    if (stageFilter) list = list.filter((c) => c.stageId === stageFilter)
    const q = search.trim().toLowerCase()
    if (q) {
      list = list.filter(
        (c) =>
          c.pushName?.toLowerCase().includes(q) ||
          c.remoteJid?.includes(q) ||
          c.lastMessage?.toLowerCase().includes(q)
      )
    }
    setFiltered(list)
  }, [search, conversations, showPausedOnly, stageFilter])

  const pausedCount = conversations.filter((c) => c.botPaused).length

  // Etapas presentes nas conversas (para o menu de filtro), com contagem.
  const stageOptions = (() => {
    const map = new Map<string, { id: string; name: string; color: string; count: number }>()
    for (const c of conversations) {
      if (!c.stageId || !c.stageName) continue
      const ex = map.get(c.stageId)
      if (ex) ex.count++
      else map.set(c.stageId, { id: c.stageId, name: c.stageName, color: c.stageColor || '#00AEEF', count: 1 })
    }
    return Array.from(map.values())
  })()
  const activeStage = stageOptions.find((s) => s.id === stageFilter)

  // Deeplink ?to=<telefone> vindo da pipeline: seleciona a conversa do contato.
  const handledToRef = useRef<string | null>(null)
  useEffect(() => {
    const to = searchParams.get('to')
    if (!to || conversations.length === 0 || handledToRef.current === to) return
    const digits = to.replace(/\D/g, '')
    const match = conversations.find((c) => c.remoteJid.replace(/\D/g, '').startsWith(digits))
    handledToRef.current = to
    if (match) {
      selectConversation(match)
    } else {
      // sem conversa ainda: filtra a lista pelo telefone para o usuário localizar/iniciar
      setSearch(digits)
      toast('Nenhuma conversa encontrada para esse contato ainda', { icon: '💬' })
    }
    router.replace('/whatsapp')
  }, [searchParams, conversations, router])

  const selectConversation = (conv: Conversation) => {
    setActiveConv(conv)
    loadMessages(conv)
    setPipeMenuOpen(false)
    setBotMenuOpen(false)
    setFinishMenuOpen(false)
    setPipeDeal(null)
  }

  const [botMenuOpen, setBotMenuOpen] = useState(false)

  // ── Menu Funil (pipeline) da conversa ativa ──────────────────────
  interface PipeStage { id: string; name: string; color: string; order: number }
  interface PipeDeal { id: string; title: string; stageId: string; status: string; value: number }
  const [pipeMenuOpen, setPipeMenuOpen] = useState(false)
  const [pipeStages, setPipeStages] = useState<PipeStage[]>([])
  const [pipeDeal, setPipeDeal] = useState<PipeDeal | null>(null)
  const [pipeLoading, setPipeLoading] = useState(false)

  const loadPipeline = useCallback(async (convId: string) => {
    setPipeLoading(true)
    try {
      const { data } = await api.get(`/whatsapp/conversations/${convId}/pipeline`)
      setPipeStages(data.stages || [])
      setPipeDeal(data.deal || null)
    } catch {
      setPipeStages([])
      setPipeDeal(null)
    }
    setPipeLoading(false)
  }, [])

  const openPipeMenu = () => {
    const next = !pipeMenuOpen
    setPipeMenuOpen(next)
    if (next && activeConv) loadPipeline(activeConv.id)
  }

  const moveToStage = async (stageId: string) => {
    if (!activeConv) return
    setPipeMenuOpen(false)
    try {
      const deal = await api.patch(`/whatsapp/conversations/${activeConv.id}/pipeline`, { stageId })
      setPipeDeal(deal.data ? { id: deal.data.id, title: deal.data.title, stageId: deal.data.stageId, status: deal.data.status, value: deal.data.value } : null)
      const stage = pipeStages.find((s) => s.id === stageId)
      toast.success(stage ? `Movido para ${stage.name}` : 'Negócio movido')
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Falha ao mover no funil')
    }
  }

  // Finaliza o negócio do contato direto da conversa (Ganho/Perdido).
  // Sai do quadro da pipeline (board só mostra OPEN); WON conta receita.
  const [finishMenuOpen, setFinishMenuOpen] = useState(false)
  const finishDeal = async (status: 'WON' | 'LOST') => {
    if (!activeConv) return
    setFinishMenuOpen(false)
    const label = status === 'WON' ? 'Ganho' : 'Perdido'
    const ok = await confirmToast(
      status === 'WON'
        ? 'Marcar como GANHO? Sai do funil e passa a contar como receita nos relatórios.'
        : 'Marcar como PERDIDO? Sai do funil. O contato volta se mandar nova mensagem.',
      { confirmLabel: label, danger: status === 'LOST' },
    )
    if (!ok) return
    try {
      await api.post(`/whatsapp/conversations/${activeConv.id}/pipeline/finish`, { status })
      setPipeDeal(null)
      setActiveConv((p) => (p ? { ...p, aiCategory: null } : p))
      setConversations((prev) => prev.map((c) => (c.id === activeConv.id ? { ...c, stageId: undefined, stageName: undefined, stageColor: undefined, aiCategory: null } : c)))
      toast.success(status === 'WON' ? 'Negócio ganho! 🏆' : 'Negócio marcado como perdido')
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Falha ao finalizar')
    }
  }

  const removeFromPipeline = async () => {
    if (!activeConv) return
    setPipeMenuOpen(false)
    const ok = await confirmToast('Tirar este contato do funil? Ele volta automaticamente se mandar nova mensagem.', { confirmLabel: 'Tirar do funil', danger: true })
    if (!ok) return
    try {
      await api.delete(`/whatsapp/conversations/${activeConv.id}/pipeline`)
      setPipeDeal(null)
      setActiveConv((p) => (p ? { ...p, aiCategory: null } : p))
      toast.success('Removido do funil')
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Falha ao remover do funil')
    }
  }

  // Pausa/reativa o bot na conversa ativa. reason undefined = reativar.
  const toggleBot = async (paused: boolean, reason?: string) => {
    if (!activeConv) return
    setBotMenuOpen(false)
    // Guarda o estado anterior desta conversa para reverter se a API falhar.
    const convId = activeConv.id
    const prevState = {
      botPaused: activeConv.botPaused,
      botPausedReason: activeConv.botPausedReason,
      botPausedUntil: activeConv.botPausedUntil,
    }
    // otimista
    const patch: Partial<Conversation> = paused
      ? { botPaused: true, botPausedReason: reason || 'MANUAL' }
      : { botPaused: false, botPausedReason: null, botPausedUntil: null }
    setActiveConv((p) => (p ? { ...p, ...patch } : p))
    setConversations((prev) => prev.map((c) => (c.id === convId ? { ...c, ...patch } : c)))
    try {
      await api.patch(`/whatsapp/conversations/${convId}/bot`, { paused, reason })
      toast.success(paused ? 'Bot pausado nesta conversa' : 'Bot reativado')
    } catch (e: any) {
      // Rollback: desfaz o otimista para não exibir um estado que o servidor recusou.
      setActiveConv((p) => (p && p.id === convId ? { ...p, ...prevState } : p))
      setConversations((prev) => prev.map((c) => (c.id === convId ? { ...c, ...prevState } : c)))
      toast.error(e?.response?.data?.message || 'Falha ao alterar o bot')
    }
  }

  // Fecha os menus/dropdowns do cabeçalho e da lista ao clicar fora.
  useEffect(() => {
    if (!pipeMenuOpen && !finishMenuOpen && !botMenuOpen && !filterMenuOpen) return
    const handler = () => {
      setPipeMenuOpen(false)
      setFinishMenuOpen(false)
      setBotMenuOpen(false)
      setFilterMenuOpen(false)
    }
    window.addEventListener('click', handler)
    return () => window.removeEventListener('click', handler)
  }, [pipeMenuOpen, finishMenuOpen, botMenuOpen, filterMenuOpen])

  // Classifica a conversa com IA sob demanda (botão manual).
  const [classifying, setClassifying] = useState(false)
  const classifyConversation = async () => {
    if (!activeConv || classifying) return
    setClassifying(true)
    try {
      const { data } = await api.post(`/whatsapp/conversations/${activeConv.id}/classify`)
      const cat = data?.result?.category
      toast.success(cat ? `Classificado como: ${cat}` : 'Sem categoria definida')
      if (cat) setActiveConv((p) => (p ? { ...p, aiCategory: cat } : p))
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Falha ao classificar')
    }
    setClassifying(false)
  }

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault()
    if (pendingImage) return sendPendingImage()
    if (!text.trim() || !activeConv || !activeInstance || sending) return

    setSending(true)
    const textToSend = text
    setText('')

    try {
      await api.post('/whatsapp/send', { instanceId: activeInstance.id, to: activeConv.remoteJid, message: textToSend })
      setConversations((prev) =>
        sortConversations(
          prev.map((item) =>
            item.id === activeConv.id
              ? { ...item, lastMessage: textToSend, lastMessageAt: new Date().toISOString() }
              : item
          )
        )
      )
    } catch (e: any) {
      setText(textToSend)
      toast.error(e?.response?.data?.message || 'Falha ao enviar mensagem')
    }

    setSending(false)
  }

  const fileInputRef = useRef<HTMLInputElement>(null)
  const handleFilePick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = '' // permite re-selecionar o mesmo arquivo
    if (!file || !activeConv || !activeInstance) return
    setSending(true)
    const t = toast.loading('Enviando arquivo...')
    try {
      await sendFileMessage({ instanceId: activeInstance.id, to: activeConv.remoteJid, file })
      toast.success('Enviado', { id: t })
    } catch (err: any) {
      toast.error(err?.response?.data?.message || err?.message || 'Falha ao enviar arquivo', { id: t })
    }
    setSending(false)
  }

  // Ctrl+V de imagem no campo de texto → stageia preview + permite escrever legenda.
  const handlePaste = (e: React.ClipboardEvent) => {
    const item = Array.from(e.clipboardData.items).find((it) => it.type.startsWith('image/'))
    if (!item) return
    const file = item.getAsFile()
    if (!file) return
    e.preventDefault()
    if (pendingImage) URL.revokeObjectURL(pendingImage.preview)
    setPendingImage({ file, preview: URL.createObjectURL(file) })
  }

  const cancelPendingImage = () => {
    if (pendingImage) URL.revokeObjectURL(pendingImage.preview)
    setPendingImage(null)
  }

  // Envia a imagem colada com a legenda digitada (image + caption num send só).
  const sendPendingImage = async () => {
    if (!pendingImage || !activeConv || !activeInstance || sending) return
    setSending(true)
    const caption = text
    const t = toast.loading('Enviando imagem...')
    try {
      await sendFileMessage({ instanceId: activeInstance.id, to: activeConv.remoteJid, file: pendingImage.file, caption: caption.trim() || undefined })
      toast.success('Enviado', { id: t })
      setText('')
      cancelPendingImage()
    } catch (err: any) {
      toast.error(err?.response?.data?.message || err?.message || 'Falha ao enviar imagem', { id: t })
    }
    setSending(false)
  }

  const recorder = useAudioRecorder()
  const startRecording = async () => {
    const ok = await recorder.start()
    if (!ok) toast.error('Não foi possível acessar o microfone')
  }
  const stopAndSendAudio = async () => {
    const file = await recorder.stop()
    if (!file || !activeConv || !activeInstance) return
    setSending(true)
    const t = toast.loading('Enviando áudio...')
    try {
      await sendFileMessage({ instanceId: activeInstance.id, to: activeConv.remoteJid, file, asAudio: true })
      toast.success('Áudio enviado', { id: t })
    } catch (err: any) {
      toast.error(err?.response?.data?.message || err?.message || 'Falha ao enviar áudio', { id: t })
    }
    setSending(false)
  }

  const getQrCode = async (inst: Instance) => {
    stopQrPoll()
    const sessionId = ++qrSessionRef.current
    let qrRefreshInFlight = false
    setQrLoading(true)
    setQrCode(null)

    const refreshQr = async (showError = false) => {
      if (qrRefreshInFlight || qrSessionRef.current !== sessionId) return
      qrRefreshInFlight = true
      try {
        const { data } = await api.get(`/whatsapp/instances/${inst.id}/qrcode`)
        if (qrSessionRef.current !== sessionId) return
        const nextQrCode = data?.base64 || data?.qrcode?.base64 || null
        if (nextQrCode) setQrCode(nextQrCode)
        setQrLoading(false)
      } catch (e: any) {
        if (qrSessionRef.current !== sessionId) return
        if (showError) {
          setQrLoading(false)
          toast.error(e?.response?.data?.message || 'Erro ao gerar QR Code')
        }
      } finally {
        qrRefreshInFlight = false
      }
    }

    await refreshQr(true)
    if (qrSessionRef.current !== sessionId) return

    // O QR da Evolution expira. Busca uma nova imagem antes do limite,
    // mantendo a atual visível caso uma renovação temporariamente falhe.
    qrRefreshRef.current = setInterval(() => void refreshQr(), 20000)
    qrPollRef.current = setInterval(async () => {
      try {
        const r = await api.get(`/whatsapp/instances/${inst.id}/status`)
        if (r.data?.instance?.state === 'open') {
          closeQr()
          void loadInstances()
          void loadConversations()
          toast.success('WhatsApp conectado!')
        }
      } catch {}
    }, 3000)
  }

  const confirmDelete = async () => {
    if (!deleteTarget || deletingInstance) return
    setDeletingInstance(true)
    try {
      await api.delete(`/whatsapp/instances/${deleteTarget.id}`)
      toast.success('Instância excluída')
      const removedId = deleteTarget.id
      setDeleteTarget(null)
      setInstances((prev) => {
        const next = prev.filter((i) => i.id !== removedId)
        setActiveInstance((cur) => (cur?.id === removedId ? next[0] || null : cur))
        return next
      })
      if (activeInstance?.id === removedId) {
        setConversations([])
        setFiltered([])
        setActiveConv(null)
        setMessages([])
        closeQr()
      }
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Falha ao excluir instância')
    } finally {
      setDeletingInstance(false)
    }
  }

  const openCreateModal = () => {
    setNewInstanceName('')
    setCreateError(null)
    setShowCreateModal(true)
  }

  const closeCreateModal = () => {
    if (creatingInstance) return
    setShowCreateModal(false)
    setNewInstanceName('')
    setCreateError(null)
  }

  const submitCreateInstance = async (e: React.FormEvent) => {
    e.preventDefault()
    const name = newInstanceName.trim()
    if (!name || creatingInstance) return
    setCreatingInstance(true)
    setCreateError(null)
    try {
      await api.post('/whatsapp/instances', { name })
      await loadInstances()
      setShowCreateModal(false)
      setNewInstanceName('')
      toast.success('Instância criada')
    } catch (e: any) {
      setCreateError(e?.response?.data?.message || e?.message || 'Falha ao criar instância')
    } finally {
      setCreatingInstance(false)
    }
  }

  const phone = (jid: string) => jid?.replace('@s.whatsapp.net', '').replace('@g.us', '') || ''
  const timeStr = (t?: string) =>
    t ? new Date(t).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : ''
  const av = (name?: string) => (name || '?')[0]?.toUpperCase()
  const totalUnread = conversations.reduce((a, c) => a + (c.unreadCount || 0), 0)

  return (
    <div className="app-page flex h-full flex-col !pb-0" style={{ height: 'calc(100vh - 56px - 40px)' }}>
      <header className="mb-2 flex flex-shrink-0 flex-wrap items-center justify-between gap-2">
        <div className="app-page-eyebrow !mb-0 text-primary">
          <MessageSquare className="h-3.5 w-3.5" />
          Central de atendimento
        </div>
        <div className="flex max-w-full flex-wrap items-center gap-2">
          {totalUnread > 0 && (
            <span
              className="px-2 py-0.5 rounded-full text-xs font-bold text-white"
              style={{ background: '#00AEEF', boxShadow: '0 0 8px #00AEEF50' }}
            >
              {totalUnread}
            </span>
          )}
          <div className="flex max-w-full gap-2 overflow-x-auto pb-0.5">
            {instances.map((inst) => (
              <div
                key={inst.id}
                className="group relative flex shrink-0 items-center rounded-xl border transition"
                style={{
                  background: activeInstance?.id === inst.id ? '#00AEEF18' : 'hsl(var(--surface-2))',
                  borderColor: activeInstance?.id === inst.id ? '#00AEEF35' : 'hsl(var(--border))',
                }}
              >
                <button
                  onClick={() => setActiveInstance(inst)}
                  className="flex items-center gap-1.5 py-1.5 pl-3 pr-2 text-xs font-medium"
                  style={{ color: activeInstance?.id === inst.id ? '#00AEEF' : 'hsl(var(--muted-foreground))' }}
                >
                  {inst.status === 'CONNECTED' ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
                  {inst.name}
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: inst.status === 'CONNECTED' ? '#10B981' : '#EF4444' }} />
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); setDeleteTarget(inst) }}
                  title="Excluir instância"
                  aria-label={`Excluir instância ${inst.name}`}
                  className="py-1.5 pl-1 pr-2 text-muted-foreground opacity-60 transition hover:text-red-400 focus:opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ))}
            <button
              onClick={openCreateModal}
              className="app-button-secondary shrink-0 border-dashed py-1.5"
            >
              + Nova instância
            </button>
          </div>
        </div>
      </header>

      {loadingInstances ? (
        <div
          className="app-tool-shell flex flex-1 items-center justify-center"
          style={{ background: 'hsl(var(--surface-1))' }}
        >
          <Loader2 className="w-6 h-6 animate-spin" style={{ color: '#00AEEF' }} />
        </div>
      ) : instances.length === 0 ? (
        <div
          className="app-tool-shell flex flex-1 flex-col items-center justify-center text-center"
          style={{ background: 'hsl(var(--surface-1))' }}
        >
          <div className="w-16 h-16 rounded-full flex items-center justify-center mb-4" style={{ background: '#00AEEF15' }}>
            <QrCode className="w-8 h-8" style={{ color: '#00AEEF' }} />
          </div>
          <h2 className="text-base font-semibold text-foreground mb-2">Conecte seu WhatsApp</h2>
          <p className="text-sm text-muted-foreground mb-4">Crie uma instância e escaneie o QR Code</p>
          <button onClick={openCreateModal} className="btn-primary">
            Criar instância
          </button>
        </div>
      ) : (
        <div className="app-tool-shell flex min-h-0 flex-1" style={{ background: 'hsl(var(--surface-1))' }}>
          {/* Lista: ocupa tudo no mobile; escondida quando há conversa aberta */}
          <div className={`${activeConv ? 'hidden' : 'flex'} lg:flex w-full lg:w-72 border-r border-border flex-col flex-shrink-0`}>
            <div className="p-3 border-b border-border flex gap-2">
              <div
                className="flex-1 flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-border"
                style={{ background: 'hsl(var(--surface-sunken))' }}
              >
                <Search className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar conversas..."
                  className="flex-1 bg-transparent text-xs text-foreground placeholder:text-muted-foreground outline-none"
                />
              </div>
              {/* Filtro (menu): bot pausado + etapas do funil */}
              <div className="relative flex-shrink-0">
                <button
                  onClick={(e) => { e.stopPropagation(); setFilterMenuOpen((v) => !v) }}
                  title="Filtrar conversas"
                  className={`p-1.5 rounded-lg border transition ${
                    showPausedOnly || stageFilter ? 'border-primary text-primary bg-primary/10' : 'border-border text-muted-foreground hover:bg-accent'
                  }`}
                >
                  <Filter className="w-3.5 h-3.5" />
                </button>
                {filterMenuOpen && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setFilterMenuOpen(false)} />
                    <div className="absolute right-0 top-full mt-1 z-20 w-56 rounded-lg border border-border shadow-lg py-1 max-h-80 overflow-y-auto" style={{ background: 'hsl(var(--surface-3))' }}>
                      <p className="px-3 py-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">Filtrar por</p>
                      <button
                        onClick={() => { setShowPausedOnly(false); setStageFilter(null); setFilterMenuOpen(false) }}
                        className="w-full text-left px-3 py-1.5 text-xs hover:bg-accent flex items-center gap-2"
                        style={!showPausedOnly && !stageFilter ? { color: '#00AEEF', fontWeight: 600 } : {}}
                      >
                        <span className="flex-1">Todas as conversas</span>
                        {!showPausedOnly && !stageFilter && <Check className="w-3 h-3" style={{ color: '#00AEEF' }} />}
                      </button>
                      {pausedCount > 0 && (
                        <button
                          onClick={() => { setShowPausedOnly(true); setStageFilter(null); setFilterMenuOpen(false) }}
                          className="w-full text-left px-3 py-1.5 text-xs hover:bg-accent flex items-center gap-2"
                          style={showPausedOnly ? { color: '#f59e0b', fontWeight: 600 } : {}}
                        >
                          <Pause className="w-3 h-3" style={{ color: '#f59e0b' }} />
                          <span className="flex-1">Bot pausado</span>
                          <span className="text-[10px] text-muted-foreground">{pausedCount}</span>
                          {showPausedOnly && <Check className="w-3 h-3" style={{ color: '#f59e0b' }} />}
                        </button>
                      )}
                      {SALES_PIPELINE_ENABLED && stageOptions.length > 0 && (
                        <>
                          <p className="px-3 py-1.5 mt-1 text-[10px] uppercase tracking-wide text-muted-foreground border-t border-border">Etapa do funil</p>
                          {stageOptions.map((s) => {
                            const active = stageFilter === s.id
                            return (
                              <button
                                key={s.id}
                                onClick={() => { setStageFilter(s.id); setShowPausedOnly(false); setFilterMenuOpen(false) }}
                                className="w-full text-left px-3 py-1.5 text-xs hover:bg-accent flex items-center gap-2"
                                style={active ? { background: s.color + '15' } : {}}
                              >
                                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: s.color }} />
                                <span className="flex-1 truncate" style={active ? { color: s.color, fontWeight: 600 } : {}}>{s.name}</span>
                                <span className="text-[10px] text-muted-foreground">{s.count}</span>
                                {active && <Check className="w-3 h-3 flex-shrink-0" style={{ color: s.color }} />}
                              </button>
                            )
                          })}
                        </>
                      )}
                    </div>
                  </>
                )}
              </div>
              <button onClick={() => void loadConversations()} className="p-1.5 rounded-lg hover:bg-accent transition" title="Atualizar">
                <RefreshCw className={`w-3.5 h-3.5 text-muted-foreground ${loadingConvs ? 'animate-spin' : ''}`} />
              </button>
            </div>

            {/* Chip do filtro ativo */}
            {(showPausedOnly || activeStage) && (
              <div className="mx-3 mt-2 flex items-center gap-1.5 flex-wrap">
                {showPausedOnly && (
                  <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium border border-amber-500 text-amber-500 bg-amber-500/10">
                    <Pause className="w-2.5 h-2.5" /> Bot pausado
                    <button onClick={() => setShowPausedOnly(false)}><X className="w-2.5 h-2.5" /></button>
                  </span>
                )}
                {activeStage && (
                  <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium border" style={{ borderColor: activeStage.color + '60', color: activeStage.color, background: activeStage.color + '12' }}>
                    <span className="w-2 h-2 rounded-full" style={{ background: activeStage.color }} /> {activeStage.name}
                    <button onClick={() => setStageFilter(null)}><X className="w-2.5 h-2.5" /></button>
                  </span>
                )}
              </div>
            )}

            {activeInstance?.status !== 'CONNECTED' && (
              <div className="p-3 border-b border-border text-center">
                <p className="text-xs text-muted-foreground mb-2">WhatsApp desconectado</p>
                <button onClick={() => getQrCode(activeInstance!)} className="btn-primary mx-auto text-xs py-1.5">
                  <QrCode className="w-3 h-3" /> Ver QR Code
                </button>
              </div>
            )}

            <div className="flex-1 overflow-y-auto">
              {loadingConvs && <div className="p-4 text-center text-xs text-muted-foreground">Carregando...</div>}
              {!loadingConvs && filtered.length === 0 && (
                <div className="p-6 text-center text-xs text-muted-foreground">
                  {search ? 'Nenhuma conversa encontrada' : 'Nenhuma conversa ainda'}
                </div>
              )}
              {filtered.map((conv) => (
                <button
                  key={conv.id}
                  onClick={() => selectConversation(conv)}
                  className="w-full flex items-center gap-2.5 p-3 border-b border-border/40 text-left transition"
                  style={activeConv?.id === conv.id ? { background: '#00AEEF0D' } : {}}
                  onMouseEnter={(e) => {
                    if (activeConv?.id !== conv.id) (e.currentTarget as HTMLButtonElement).style.background = 'hsl(var(--accent))'
                  }}
                  onMouseLeave={(e) => {
                    if (activeConv?.id !== conv.id) (e.currentTarget as HTMLButtonElement).style.background = 'transparent'
                  }}
                >
                  <div
                    className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 overflow-hidden"
                    style={{ background: '#00AEEF20', color: '#00AEEF' }}
                  >
                    {conv.profilePicUrl ? (
                      <img
                        src={conv.profilePicUrl}
                        alt=""
                        className="w-full h-full object-cover"
                        onError={(e) => {
                          ;(e.target as HTMLImageElement).style.display = 'none'
                        }}
                      />
                    ) : conv.isGroup ? (
                      <Users className="w-4 h-4" />
                    ) : (
                      av(conv.pushName || phone(conv.remoteJid))
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-1 min-w-0 text-xs font-semibold text-foreground">
                        {conv.isGroup && <Users className="w-3 h-3 flex-shrink-0 opacity-70" />}
                        <span className="truncate">{conv.pushName || phone(conv.remoteJid)}</span>
                      </span>
                      {conv.lastMessageAt && (
                        <span className="text-[10px] text-muted-foreground flex-shrink-0 ml-1">{timeStr(conv.lastMessageAt)}</span>
                      )}
                    </div>
                    <p className="text-[10px] text-muted-foreground truncate mt-0.5">{conv.lastMessage || '...'}</p>
                    <div className="flex items-center gap-1 flex-wrap mt-1">
                      {conv.botPaused && (
                        <span
                          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-medium"
                          style={{ background: `${pauseInfo(conv.botPausedReason).color}20`, color: pauseInfo(conv.botPausedReason).color }}
                        >
                          <Pause className="w-2 h-2" /> {pauseInfo(conv.botPausedReason).label}
                        </span>
                      )}
                      {conv.aiCategory && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-medium bg-violet-500/15 text-violet-400">
                          <Sparkles className="w-2 h-2" /> {titleCase(conv.aiCategory)} (IA)
                        </span>
                      )}
                      {SALES_PIPELINE_ENABLED && conv.stageName && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-medium" style={{ background: (conv.stageColor || '#00AEEF') + '20', color: conv.stageColor || '#00AEEF' }}>
                          <GitBranch className="w-2 h-2" /> {conv.stageName}
                        </span>
                      )}
                    </div>
                  </div>
                  {conv.unreadCount > 0 && (
                    <span
                      className="w-4 h-4 rounded-full text-[9px] font-bold flex items-center justify-center flex-shrink-0 text-white"
                      style={{ background: '#00AEEF', boxShadow: '0 0 6px #00AEEF50' }}
                    >
                      {conv.unreadCount > 9 ? '9+' : conv.unreadCount}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>

          {activeConv ? (
            <div className="flex-1 flex flex-col min-w-0">
              <div className="flex items-center gap-3 px-4 py-3 border-b border-border flex-shrink-0" style={{ background: 'hsl(var(--surface-2))' }}>
                {/* Voltar à lista (mobile) */}
                <button
                  onClick={() => setActiveConv(null)}
                  className="p-1 -ml-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent lg:hidden flex-shrink-0"
                  aria-label="Voltar"
                >
                  <ArrowLeft className="w-4 h-4" />
                </button>
                <div className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold overflow-hidden" style={{ background: '#00AEEF20', color: '#00AEEF' }}>
                  {activeConv.profilePicUrl ? (
                    <img
                      src={activeConv.profilePicUrl}
                      alt=""
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        ;(e.target as HTMLImageElement).style.display = 'none'
                      }}
                    />
                  ) : activeConv.isGroup ? (
                    <Users className="w-4 h-4" />
                  ) : (
                    av(activeConv.pushName || phone(activeConv.remoteJid))
                  )}
                </div>
                <div className="flex-1">
                  <p className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                    {activeConv.isGroup && <Users className="w-3.5 h-3.5 flex-shrink-0 opacity-70" />}
                    <span className="truncate">{activeConv.pushName || phone(activeConv.remoteJid)}</span>
                    {!activeConv.isGroup && activeConv.pushName && (
                      <span className="text-[11px] font-normal text-muted-foreground flex-shrink-0">{phone(activeConv.remoteJid)}</span>
                    )}
                  </p>
                  <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                    {activeConv.botPaused ? (
                      <span className="flex items-center gap-1" style={{ color: pauseInfo(activeConv.botPausedReason).color }}>
                        <Pause className="w-2.5 h-2.5" /> Bot pausado · {pauseInfo(activeConv.botPausedReason).label}
                        {activeConv.botPausedUntil && ` até ${new Date(activeConv.botPausedUntil).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`}
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-emerald-500"><Bot className="w-2.5 h-2.5" /> Bot ativo</span>
                    )}
                    {activeConv.aiCategory && (
                      <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-400">
                        <Sparkles className="w-2.5 h-2.5" /> {titleCase(activeConv.aiCategory)} (IA)
                      </span>
                    )}
                  </p>
                </div>
                <div className="flex gap-1 items-center">
                  {SALES_PIPELINE_ENABLED && !activeConv.isGroup && (
                    <button
                      onClick={classifyConversation}
                      disabled={classifying}
                      title="Classificar com IA"
                      className="p-2 rounded-lg hover:bg-accent transition disabled:opacity-50"
                    >
                      <Sparkles className={`w-3.5 h-3.5 ${classifying ? 'animate-pulse text-primary' : 'text-muted-foreground'}`} />
                    </button>
                  )}
                  {SALES_PIPELINE_ENABLED && !activeConv.isGroup && (
                    <div className="relative">
                      <button
                        onClick={(e) => { e.stopPropagation(); setFinishMenuOpen(false); setBotMenuOpen(false); openPipeMenu() }}
                        title="Funil"
                        className="p-2 rounded-lg hover:bg-accent transition flex items-center gap-1 text-muted-foreground"
                      >
                        <GitBranch className="w-3.5 h-3.5" /><span className="text-[10px] font-medium">Funil</span>
                      </button>
                      {pipeMenuOpen && (
                        <div className="absolute right-0 top-full mt-1 z-20 w-52 rounded-lg border border-border bg-card shadow-lg py-1">
                          {pipeLoading ? (
                            <div className="flex items-center justify-center py-3">
                              <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                            </div>
                          ) : pipeStages.length === 0 ? (
                            <p className="px-3 py-2 text-[11px] text-muted-foreground">Nenhum funil configurado</p>
                          ) : (
                            <>
                              <p className="px-3 py-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">Mover para estágio</p>
                              {pipeStages.map((s) => {
                                const active = pipeDeal?.stageId === s.id
                                return (
                                  <button
                                    key={s.id}
                                    onClick={() => moveToStage(s.id)}
                                    className="w-full text-left px-3 py-1.5 text-xs hover:bg-accent flex items-center gap-2"
                                    style={active ? { background: s.color + '15' } : {}}
                                  >
                                    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: s.color }} />
                                    <span className="flex-1 truncate" style={active ? { color: s.color, fontWeight: 600 } : {}}>{s.name}</span>
                                    {active && <Check className="w-3 h-3 flex-shrink-0" style={{ color: s.color }} />}
                                  </button>
                                )
                              })}
                              {pipeDeal && (
                                <button
                                  onClick={removeFromPipeline}
                                  className="w-full text-left px-3 py-1.5 text-xs hover:bg-accent flex items-center gap-2 border-t border-border mt-1 text-red-400"
                                >
                                  <Trash2 className="w-3 h-3" /> Tirar do funil
                                </button>
                              )}
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                  {SALES_PIPELINE_ENABLED && !activeConv.isGroup && (
                    <div className="relative">
                      <button
                        onClick={(e) => { e.stopPropagation(); setPipeMenuOpen(false); setBotMenuOpen(false); setFinishMenuOpen((v) => !v) }}
                        title="Finalizar negócio"
                        className="p-2 rounded-lg hover:bg-accent transition flex items-center gap-1 text-muted-foreground"
                      >
                        <Trophy className="w-3.5 h-3.5" /><span className="text-[10px] font-medium">Finalizar</span>
                      </button>
                      {finishMenuOpen && (
                        <div className="absolute right-0 top-full mt-1 z-20 w-44 rounded-lg border border-border bg-card shadow-lg py-1">
                          <button
                            onClick={() => finishDeal('WON')}
                            className="w-full text-left px-3 py-1.5 text-xs hover:bg-accent flex items-center gap-2 text-emerald-500"
                          >
                            <Trophy className="w-3.5 h-3.5" /> Ganho (conta receita)
                          </button>
                          <button
                            onClick={() => finishDeal('LOST')}
                            className="w-full text-left px-3 py-1.5 text-xs hover:bg-accent flex items-center gap-2 text-red-400"
                          >
                            <Flag className="w-3.5 h-3.5" /> Perdido / Frio
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                  <div className="relative">
                    {activeConv.botPaused ? (
                      <button
                        onClick={() => toggleBot(false)}
                        title="Reativar bot"
                        className="p-2 rounded-lg hover:bg-accent transition flex items-center gap-1 text-emerald-500"
                      >
                        <Play className="w-3.5 h-3.5" /><span className="text-[10px] font-medium">Reativar</span>
                      </button>
                    ) : (
                      <button
                        onClick={(e) => { e.stopPropagation(); setPipeMenuOpen(false); setFinishMenuOpen(false); setBotMenuOpen((v) => !v) }}
                        title="Pausar bot"
                        className="p-2 rounded-lg hover:bg-accent transition flex items-center gap-1 text-muted-foreground"
                      >
                        <Pause className="w-3.5 h-3.5" /><span className="text-[10px] font-medium">Pausar bot</span>
                      </button>
                    )}
                    {botMenuOpen && !activeConv.botPaused && (
                      <div className="absolute right-0 top-full mt-1 z-20 w-44 rounded-lg border border-border bg-card shadow-lg py-1">
                        {[
                          { reason: 'HUMANO', label: 'Humano atendendo' },
                          { reason: 'SUPORTE', label: 'Suporte' },
                          { reason: 'FECHADO', label: 'Venda fechada' },
                          { reason: 'MANUAL', label: 'Apenas pausar' },
                        ].map((opt) => (
                          <button
                            key={opt.reason}
                            onClick={() => toggleBot(true, opt.reason)}
                            className="w-full text-left px-3 py-1.5 text-xs hover:bg-accent flex items-center gap-2"
                          >
                            <span className="w-2 h-2 rounded-full" style={{ background: pauseInfo(opt.reason).color }} />
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <button onClick={() => loadMessages(activeConv)} className="p-2 rounded-lg hover:bg-accent transition">
                    <RefreshCw className={`w-3.5 h-3.5 text-muted-foreground ${loadingMsgs ? 'animate-spin' : ''}`} />
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-1.5" style={{ background: 'hsl(var(--surface-0))' }}>
                {loadingMsgs && <div className="text-center text-xs text-muted-foreground pt-8">Carregando mensagens...</div>}
                {!loadingMsgs && messages.length === 0 && <div className="text-center text-xs text-muted-foreground pt-8">Nenhuma mensagem</div>}
                {messages.map((msg, i) => {
                  const showDate =
                    i === 0 ||
                    new Date(messages[i - 1].timestamp).toDateString() !== new Date(msg.timestamp).toDateString()
                  return (
                    <div key={msg.id || `${msg.timestamp}-${msg.fromMe ? 'out' : 'in'}-${i}`}>
                      {showDate && (
                        <div className="text-center my-3">
                          <span
                            className="text-[10px] text-muted-foreground px-3 py-1 rounded-full border border-border"
                            style={{ background: 'hsl(var(--surface-1))' }}
                          >
                            {new Date(msg.timestamp).toLocaleDateString('pt-BR', {
                              weekday: 'long',
                              day: '2-digit',
                              month: 'long',
                            })}
                          </span>
                        </div>
                      )}
                      <div className={`flex ${msg.fromMe ? 'justify-end' : 'justify-start'}`}>
                        <div
                          className="max-w-[70%] px-3 py-2 rounded-xl text-xs leading-relaxed"
                          style={
                            msg.fromMe
                              ? {
                                  background: 'linear-gradient(135deg, #00AEEF, #0A84FF)',
                                  color: 'white',
                                  borderRadius: '12px 12px 2px 12px',
                                  boxShadow: '0 2px 8px #00AEEF30',
                                }
                              : {
                                  background: 'hsl(var(--surface-3))',
                                  border: '1px solid hsl(var(--border))',
                                  color: 'hsl(var(--foreground))',
                                  borderRadius: '12px 12px 12px 2px',
                                }
                          }
                        >
                          {!msg.fromMe && activeConv.isGroup && msg.senderName && (
                            <p className="text-[11px] font-semibold mb-0.5" style={{ color: senderColor(msg.senderName) }}>
                              {msg.senderName}
                            </p>
                          )}
                          {msg.mediaUrl && <MediaBubble mediaUrl={msg.mediaUrl} mediaType={msg.mediaType} fromMe={msg.fromMe} />}
                          {msg.content && msg.content !== '[mídia]' && <p className="whitespace-pre-wrap break-words">{msg.content}</p>}
                          {!msg.mediaUrl && msg.content === '[mídia]' && <p className="italic opacity-70">📎 mídia</p>}
                          <div
                            className={`flex items-center justify-end gap-1 mt-1 ${msg.fromMe ? 'text-white/60' : 'text-muted-foreground'}`}
                            style={{ fontSize: '9px' }}
                          >
                            {timeStr(msg.timestamp)}
                            {msg.fromMe &&
                              (msg.status === 'READ' ? (
                                <CheckCheck className="w-2.5 h-2.5" style={{ color: '#4FC3F7' }} />
                              ) : (
                                <Check className="w-2.5 h-2.5" />
                              ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })}
                <div ref={messagesEndRef} />
              </div>

              {pendingImage && (
                <div className="flex items-center gap-3 px-3 pt-3 border-t border-border flex-shrink-0" style={{ background: 'hsl(var(--surface-2))' }}>
                  <div className="relative">
                    <img src={pendingImage.preview} alt="" className="w-16 h-16 rounded-lg object-cover border border-border" />
                    <button
                      type="button"
                      onClick={cancelPendingImage}
                      title="Remover imagem"
                      className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full flex items-center justify-center bg-red-500 hover:bg-red-600 transition"
                    >
                      <X className="w-3 h-3 text-white" />
                    </button>
                  </div>
                  <span className="text-xs text-muted-foreground">Imagem colada · escreva uma legenda e envie</span>
                </div>
              )}
              <form
                onSubmit={sendMessage}
                className="flex items-center gap-2 p-3 border-t border-border flex-shrink-0"
                style={{ background: 'hsl(var(--surface-2))', borderTop: pendingImage ? 'none' : undefined }}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*,video/*,audio/*,application/pdf,.pdf,.doc,.docx,.xls,.xlsx"
                  className="hidden"
                  onChange={handleFilePick}
                />
                {recorder.recording ? (
                  // ── Modo gravação de áudio ──
                  <>
                    <button
                      type="button"
                      onClick={recorder.cancel}
                      title="Cancelar"
                      className="w-10 h-10 rounded-xl flex items-center justify-center hover:bg-accent transition flex-shrink-0"
                    >
                      <Trash2 className="w-4 h-4 text-red-400" />
                    </button>
                    <div className="flex-1 flex items-center gap-2 px-3 py-2 rounded-xl border border-border" style={{ background: 'hsl(var(--surface-sunken))' }}>
                      <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse flex-shrink-0" />
                      <span className="text-sm text-foreground tabular-nums">
                        {Math.floor(recorder.seconds / 60)}:{String(recorder.seconds % 60).padStart(2, '0')}
                      </span>
                      <span className="text-xs text-muted-foreground">Gravando...</span>
                    </div>
                    <button
                      type="button"
                      onClick={stopAndSendAudio}
                      disabled={sending}
                      title="Enviar áudio"
                      className="w-10 h-10 rounded-xl flex items-center justify-center transition flex-shrink-0 disabled:opacity-40"
                      style={{ background: 'linear-gradient(135deg, #00AEEF, #0A84FF)', boxShadow: '0 0 12px #00AEEF40' }}
                    >
                      <Send className="w-4 h-4 text-white" />
                    </button>
                  </>
                ) : (
                  // ── Modo texto normal ──
                  <>
                    <div className="flex-1 flex items-center gap-2 px-3 py-2 rounded-xl border border-border" style={{ background: 'hsl(var(--surface-sunken))' }}>
                      <input
                        value={text}
                        onChange={(e) => setText(e.target.value)}
                        onPaste={handlePaste}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault()
                            sendMessage(e as any)
                          }
                        }}
                        placeholder={pendingImage ? 'Escreva uma legenda...' : 'Digite uma mensagem...'}
                        disabled={sending}
                        className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none disabled:opacity-50"
                      />
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={sending}
                        title="Anexar foto, documento ou áudio"
                        className="p-1 rounded-lg hover:bg-accent transition flex-shrink-0 disabled:opacity-40"
                      >
                        <Paperclip className="w-3.5 h-3.5 text-muted-foreground" />
                      </button>
                    </div>
                    {text.trim() || pendingImage ? (
                      <button
                        type="submit"
                        disabled={sending}
                        className="w-10 h-10 rounded-xl flex items-center justify-center transition flex-shrink-0 disabled:opacity-40"
                        style={{ background: 'linear-gradient(135deg, #00AEEF, #0A84FF)', boxShadow: '0 0 12px #00AEEF40' }}
                      >
                        <Send className="w-4 h-4 text-white" />
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={startRecording}
                        disabled={sending}
                        title="Gravar áudio"
                        className="w-10 h-10 rounded-xl flex items-center justify-center transition flex-shrink-0 disabled:opacity-40"
                        style={{ background: 'linear-gradient(135deg, #00AEEF, #0A84FF)', boxShadow: '0 0 12px #00AEEF40' }}
                      >
                        <Mic className="w-4 h-4 text-white" />
                      </button>
                    )}
                  </>
                )}
              </form>
            </div>
          ) : (
            // Placeholder só no desktop; no mobile a lista ocupa a tela inteira
            <div className="hidden lg:flex flex-1 flex-col items-center justify-center gap-3" style={{ background: 'hsl(var(--surface-0))' }}>
              <div className="w-16 h-16 rounded-full flex items-center justify-center" style={{ background: '#00AEEF10' }}>
                <MessageSquare className="w-7 h-7" style={{ color: '#00AEEF', opacity: 0.5 }} />
              </div>
              <p className="text-sm text-muted-foreground">Selecione uma conversa para começar</p>
            </div>
          )}
        </div>
      )}

      {(qrCode || qrLoading) && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)' }}
          onClick={closeQr}
        >
          <div
            className="app-surface relative w-full max-w-sm p-6"
            style={{ background: 'hsl(var(--surface-1))', boxShadow: '0 0 40px rgba(0,174,239,0.2)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={closeQr}
              className="absolute top-3 right-3 p-1.5 rounded-lg hover:bg-accent transition"
              aria-label="Fechar"
            >
              <X className="w-4 h-4 text-muted-foreground" />
            </button>
            <div className="flex flex-col items-center text-center">
              <div className="w-12 h-12 rounded-full flex items-center justify-center mb-3" style={{ background: '#00AEEF15' }}>
                <QrCode className="w-6 h-6" style={{ color: '#00AEEF' }} />
              </div>
              <h3 className="text-base font-semibold text-foreground mb-1">Escaneie o QR Code</h3>
              <p className="text-xs text-muted-foreground mb-4">
                WhatsApp → Configurações → Aparelhos conectados → Conectar aparelho
              </p>
              <div
                className="w-64 h-64 rounded-xl flex items-center justify-center"
                style={{ background: 'white' }}
              >
                {qrCode ? (
                  <img src={qrCode} alt="QR Code" className="w-full h-full rounded-xl" />
                ) : (
                  <Loader2 className="w-8 h-8 animate-spin" style={{ color: '#00AEEF' }} />
                )}
              </div>
              <p className="text-[11px] text-muted-foreground mt-3">
                Esta janela fecha sozinha ao conectar
              </p>
            </div>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)' }}
          onClick={() => !deletingInstance && setDeleteTarget(null)}
        >
          <div
            className="app-surface relative w-full max-w-sm p-6"
            style={{ background: 'hsl(var(--surface-1))', boxShadow: '0 0 40px rgba(239,68,68,0.18)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setDeleteTarget(null)}
              disabled={deletingInstance}
              className="absolute top-3 right-3 p-1.5 rounded-lg hover:bg-accent transition disabled:opacity-40"
              aria-label="Fechar"
            >
              <X className="w-4 h-4 text-muted-foreground" />
            </button>
            <div className="flex flex-col items-center text-center mb-4">
              <div
                className="w-12 h-12 rounded-full flex items-center justify-center mb-3"
                style={{ background: '#EF444415' }}
              >
                <Trash2 className="w-6 h-6" style={{ color: '#EF4444' }} />
              </div>
              <h3 className="text-base font-semibold text-foreground mb-1">Excluir instância</h3>
              <p className="text-xs text-muted-foreground">
                Tem certeza que deseja excluir <span className="text-foreground font-semibold">{deleteTarget.name}</span>?
                Isso desconecta o WhatsApp e remove conversas e mensagens.
              </p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                disabled={deletingInstance}
                className="flex-1 px-3 py-2 rounded-lg text-xs font-medium border border-border text-muted-foreground hover:bg-accent transition disabled:opacity-40"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={confirmDelete}
                disabled={deletingInstance}
                className="flex-1 px-3 py-2 rounded-lg text-xs font-semibold text-foreground transition disabled:opacity-40 flex items-center justify-center gap-1.5"
                style={{ background: 'linear-gradient(135deg, #EF4444, #DC2626)', boxShadow: '0 0 12px #EF444440' }}
              >
                {deletingInstance && <Loader2 className="w-3 h-3 animate-spin" />}
                {deletingInstance ? 'Excluindo...' : 'Excluir'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showCreateModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)' }}
          onClick={closeCreateModal}
        >
          <form
            onSubmit={submitCreateInstance}
            className="app-surface relative w-full max-w-sm p-6"
            style={{ background: 'hsl(var(--surface-1))', boxShadow: '0 0 40px rgba(0,174,239,0.2)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={closeCreateModal}
              disabled={creatingInstance}
              className="absolute top-3 right-3 p-1.5 rounded-lg hover:bg-accent transition disabled:opacity-40"
              aria-label="Fechar"
            >
              <X className="w-4 h-4 text-muted-foreground" />
            </button>

            <div className="flex flex-col items-center text-center mb-4">
              <div className="w-12 h-12 rounded-full flex items-center justify-center mb-3" style={{ background: '#00AEEF15' }}>
                <QrCode className="w-6 h-6" style={{ color: '#00AEEF' }} />
              </div>
              <h3 className="text-base font-semibold text-foreground mb-1">Nova instância</h3>
              <p className="text-xs text-muted-foreground">Dê um nome para sua nova conexão WhatsApp</p>
            </div>

            <div className="mb-4">
              <label className="block text-xs text-muted-foreground mb-1.5">Nome da instância</label>
              <input
                autoFocus
                value={newInstanceName}
                onChange={(e) => setNewInstanceName(e.target.value)}
                placeholder="ex: principal"
                disabled={creatingInstance}
                className="w-full px-3 py-2 rounded-lg border border-border bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none focus:border-[#00AEEF] transition disabled:opacity-50"
                style={{ background: 'hsl(var(--surface-sunken))' }}
              />
              {createError && (
                <p className="text-[11px] mt-2" style={{ color: '#EF4444' }}>
                  {createError}
                </p>
              )}
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={closeCreateModal}
                disabled={creatingInstance}
                className="flex-1 px-3 py-2 rounded-lg text-xs font-medium border border-border text-muted-foreground hover:bg-accent transition disabled:opacity-40"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={!newInstanceName.trim() || creatingInstance}
                className="flex-1 px-3 py-2 rounded-lg text-xs font-semibold text-foreground transition disabled:opacity-40 flex items-center justify-center gap-1.5"
                style={{ background: 'linear-gradient(135deg, #00AEEF, #0A84FF)', boxShadow: '0 0 12px #00AEEF40' }}
              >
                {creatingInstance && <Loader2 className="w-3 h-3 animate-spin" />}
                {creatingInstance ? 'Criando...' : 'Criar'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
