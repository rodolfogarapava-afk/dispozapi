'use client'

import Link from 'next/link'
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import {
  Bold, Check, CheckCircle2, ChevronDown, Clock3, FileSpreadsheet, FileText,
  FolderOpen, Image as ImageIcon, Italic, Loader2, Megaphone, Paperclip, Pause, Play,
  Plus, Quote, Search, Send, Settings2, Smartphone, Trash2, Users, X,
} from 'lucide-react'
import { api } from '@/lib/api'
import { wsClient } from '@/lib/ws'
import { confirmToast } from '@/lib/confirm'
import { cn } from '@/lib/utils'
import { DarkSelect } from '@/components/ui/dark-select'
import { getPlan } from '@/lib/plans'
import { useAuthStore } from '@/store/auth.store'

type AttachmentKind = 'image' | 'audio' | 'video' | 'document'

interface Attachment {
  url: string
  fileName: string
  mimetype: string
  kind: AttachmentKind
}

interface MessageStep {
  id: string
  text: string
  attachment?: Attachment
}

interface Campaign {
  id: string
  name: string
  message: string
  messages?: MessageStep[]
  status: string
  totalSent: number
  totalFailed: number
  createdAt: string
  instanceId?: string | null
  instanceName?: string | null
  _count?: { contacts: number }
}

interface WhatsappInstance {
  id: string
  name: string
  number?: string | null
  status: 'CONNECTED' | 'CONNECTING' | 'DISCONNECTED' | string
}

interface Contact {
  id: string
  name: string
  phone?: string
}

interface ContactGroupList {
  id: string
  name: string
  contactCount: number
}

interface Cadence {
  minDelayMs: number
  maxDelayMs: number
  pauseEvery: number
  pauseMs: number
  maxPerRun: number
}

interface Progress {
  sent: number
  failed: number
  total: number
}

type ComposerPanel = 'contacts' | 'message' | 'attachment'

const DEFAULT_MESSAGE: MessageStep = {
  id: '1',
  text: '',
}

const DEFAULT_CADENCE: Cadence = {
  minDelayMs: 15000,
  maxDelayMs: 30000,
  pauseEvery: 20,
  pauseMs: 180000,
  maxPerRun: 100,
}

const STATUS: Record<string, { label: string; color: string }> = {
  DRAFT: { label: 'Rascunho', color: '#94A3B8' },
  SCHEDULED: { label: 'Agendada', color: '#F59E0B' },
  RUNNING: { label: 'Em andamento', color: '#00AEEF' },
  PAUSED: { label: 'Pausada', color: '#F59E0B' },
  FINISHED: { label: 'Concluída', color: '#10B981' },
}

const inputClass = 'w-full rounded-xl border border-border bg-transparent px-3 py-2 text-sm text-foreground outline-none transition focus:border-primary/60 focus:ring-2 focus:ring-primary/10'

function splitCsvLine(line: string, delimiter: string): string[] {
  const cells: string[] = []
  let cell = ''
  let quoted = false
  for (let index = 0; index < line.length; index++) {
    const char = line[index]
    if (char === '"' && quoted && line[index + 1] === '"') {
      cell += '"'
      index++
    } else if (char === '"') {
      quoted = !quoted
    } else if (char === delimiter && !quoted) {
      cells.push(cell.trim())
      cell = ''
    } else {
      cell += char
    }
  }
  cells.push(cell.trim())
  return cells
}

function parseCsv(text: string): Array<{ name?: string; phone?: string; email?: string }> {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  if (!lines.length) return []
  const delimiters = [',', ';', '\t']
  const delimiter = delimiters.sort((a, b) => splitCsvLine(lines[0], b).length - splitCsvLine(lines[0], a).length)[0]
  const split = (line: string) => splitCsvLine(line, delimiter)
  const header = split(lines[0]).map((cell) => cell.toLocaleLowerCase('pt-BR'))
  const hasHeader = header.some((cell) => /nome|name|telefone|phone|celular|whats|email|e-mail/.test(cell))
  const nameIndex = Math.max(0, hasHeader ? header.findIndex((cell) => /nome|name/.test(cell)) : 0)
  const detectedPhone = hasHeader ? header.findIndex((cell) => /telefone|phone|celular|whats/.test(cell)) : 1
  const phoneIndex = detectedPhone >= 0 ? detectedPhone : 1
  const emailIndex = hasHeader ? header.findIndex((cell) => /email|e-mail/.test(cell)) : -1

  return lines.slice(hasHeader ? 1 : 0).flatMap((line) => {
    const columns = split(line)
    const phone = String(columns[phoneIndex] || '').replace(/\D/g, '')
    if (!/^\d{10,15}$/.test(phone)) return []
    return [{ name: columns[nameIndex] || phone, phone, email: emailIndex >= 0 ? columns[emailIndex] : undefined }]
  })
}

function fileToBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Não foi possível ler o arquivo'))
    reader.onload = () => resolve(String(reader.result || '').split(',')[1] || '')
    reader.readAsDataURL(file)
  })
}

function errorMessage(error: any, fallback: string) {
  return error?.response?.data?.message || error?.message || fallback
}

function formatDuration(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.round(milliseconds / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  if (hours) return `${hours}h${minutes ? ` ${minutes}min` : ''}`
  if (minutes) return `${minutes}min${seconds ? ` ${seconds}s` : ''}`
  return `${seconds}s`
}

export default function CampaignsPage() {
  const user = useAuthStore((state) => state.user)
  const plan = getPlan(user?.organization?.plan)
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [contacts, setContacts] = useState<Contact[]>([])
  const [contactGroups, setContactGroups] = useState<ContactGroupList[]>([])
  const [selectedContactGroupId, setSelectedContactGroupId] = useState('')
  const [groupContacts, setGroupContacts] = useState<Contact[]>([])
  const [loadingGroupContacts, setLoadingGroupContacts] = useState(false)
  const [campaignContactIds, setCampaignContactIds] = useState<string[]>([])
  const [showContactImporter, setShowContactImporter] = useState(false)
  const [instances, setInstances] = useState<WhatsappInstance[]>([])
  const [selectedInstanceId, setSelectedInstanceId] = useState('')
  const [showInstanceMenu, setShowInstanceMenu] = useState(false)
  const [cadence, setCadence] = useState<Cadence>(DEFAULT_CADENCE)
  const [progress, setProgress] = useState<Record<string, Progress>>({})
  const [loading, setLoading] = useState(true)
  const [loadingInstances, setLoadingInstances] = useState(true)
  const [saving, setSaving] = useState(false)
  const [actionCampaignId, setActionCampaignId] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [name, setName] = useState('')
  const [message, setMessage] = useState<MessageStep>(DEFAULT_MESSAGE)
  const [selectedContactIds, setSelectedContactIds] = useState<string[]>([])
  const [contactSearch, setContactSearch] = useState('')
  const [showManualContact, setShowManualContact] = useState(false)
  const [manualContactName, setManualContactName] = useState('')
  const [manualContactPhone, setManualContactPhone] = useState('')
  const [addingManualContact, setAddingManualContact] = useState(false)
  const [clearingCampaignList, setClearingCampaignList] = useState(false)
  const [mobilePanel, setMobilePanel] = useState<ComposerPanel>('contacts')
  const [draggingAttachment, setDraggingAttachment] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const instanceMenuRef = useRef<HTMLDivElement>(null)
  const deferredSearch = useDeferredValue(contactSearch)
  const activeCampaigns = campaigns.filter((campaign) => campaign.status === 'RUNNING').length
  const reachedCampaignLimit = activeCampaigns >= plan.maxActiveCampaigns

  useEffect(() => {
    const noticeId = toast.custom((notice) => (
      <div
        role="status"
        className="flex w-[calc(100vw-2rem)] max-w-lg items-start gap-3 rounded-2xl border border-amber-500/30 bg-[hsl(var(--surface-1))] p-4 shadow-[0_18px_55px_-20px_rgba(245,158,11,.65)]"
      >
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/15 text-amber-300">
          <Clock3 className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-foreground">Antes de iniciar o disparo</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Aguarde pelo menos duas horas antes de realizar o disparo, para evitar restrições.
          </p>
        </div>
        <button type="button" onClick={() => toast.dismiss(notice.id)} aria-label="Fechar aviso" className="rounded-lg p-1.5 text-muted-foreground transition hover:bg-accent hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>
    ), { duration: 12000, position: 'top-center' })

    return () => toast.dismiss(noticeId)
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setLoadingInstances(true)
    try {
      const requestKey = Date.now()
      const [campaignResponse, contactsResponse, cadenceResponse, instancesResponse, contactGroupsResponse] = await Promise.all([
        api.get('/campaigns', { params: { _t: requestKey } }),
        api.get('/contacts', { params: { limit: 500, _t: requestKey } }),
        api.get('/campaigns/antispam', { params: { _t: requestKey } }),
        api.get('/whatsapp/instances', { params: { _t: requestKey } }).catch(() => ({ data: [] })),
        api.get('/contacts/group-lists', { params: { _t: requestKey } }).catch(() => ({ data: [] })),
      ])
      const availableInstances: WhatsappInstance[] = Array.isArray(instancesResponse.data) ? instancesResponse.data : []
      const availableGroups: ContactGroupList[] = Array.isArray(contactGroupsResponse.data) ? contactGroupsResponse.data : []
      setCampaigns(campaignResponse.data || [])
      setContacts(contactsResponse.data?.data || [])
      setContactGroups(availableGroups)
      setSelectedContactGroupId((current) => availableGroups.some((group) => group.id === current) ? current : '')
      setCadence(cadenceResponse.data || DEFAULT_CADENCE)
      setInstances(availableInstances)
      setSelectedInstanceId((current) => {
        if (availableInstances.some((instance) => instance.id === current && instance.status === 'CONNECTED')) return current
        return availableInstances.find((instance) => instance.status === 'CONNECTED')?.id || ''
      })
    } catch (error) {
      toast.error(errorMessage(error, 'Não foi possível carregar as campanhas'))
    } finally {
      setLoading(false)
      setLoadingInstances(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    if (!selectedContactGroupId) {
      setGroupContacts([])
      setLoadingGroupContacts(false)
      return
    }

    let active = true
    setGroupContacts([])
    setLoadingGroupContacts(true)
    api.get(`/contacts/group-lists/${encodeURIComponent(selectedContactGroupId)}`, { params: { _t: Date.now() } })
      .then((response) => {
        if (active) setGroupContacts(Array.isArray(response.data?.contacts) ? response.data.contacts : [])
      })
      .catch((error) => {
        if (!active) return
        setGroupContacts([])
        toast.error(errorMessage(error, 'Não foi possível carregar os contatos do grupo'))
      })
      .finally(() => { if (active) setLoadingGroupContacts(false) })

    return () => { active = false }
  }, [selectedContactGroupId])

  useEffect(() => {
    const stopProgress = wsClient.on('campaign_progress', (payload: any) => {
      setProgress((current) => ({
        ...current,
        [payload.campaignId]: { sent: payload.sent, failed: payload.failed, total: payload.total },
      }))
    })
    const stopDone = wsClient.on('campaign_done', () => { void load() })
    return () => { stopProgress(); stopDone() }
  }, [load])

  useEffect(() => {
    if (!showInstanceMenu) return
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!instanceMenuRef.current?.contains(event.target as Node)) setShowInstanceMenu(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setShowInstanceMenu(false)
    }
    document.addEventListener('pointerdown', closeOnOutsideClick)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [showInstanceMenu])

  const sourceContacts = groupContacts
  const campaignContacts = useMemo(() => {
    const ids = new Set(campaignContactIds)
    return contacts.filter((contact) => ids.has(contact.id))
  }, [campaignContactIds, contacts])

  const filteredContacts = useMemo(() => {
    const term = deferredSearch.trim().toLocaleLowerCase('pt-BR')
    if (!term) return campaignContacts
    return campaignContacts.filter((contact) => `${contact.name} ${contact.phone || ''}`.toLocaleLowerCase('pt-BR').includes(term))
  }, [campaignContacts, deferredSearch])

  const newGroupContactCount = useMemo(() => {
    const alreadyAdded = new Set(campaignContactIds)
    return sourceContacts.filter((contact) => !alreadyAdded.has(contact.id)).length
  }, [campaignContactIds, sourceContacts])

  const currentMessage = message
  const messageReady = Boolean(message.text.trim() || message.attachment)
  const selectedInstance = instances.find((instance) => instance.id === selectedInstanceId)
  const connectedInstances = instances.filter((instance) => instance.status === 'CONNECTED')
  const cadenceRunContacts = Math.min(selectedContactIds.length || cadence.maxPerRun, cadence.maxPerRun)
  const cadenceIntervals = Math.max(0, cadenceRunContacts - 1)
  const cadencePauses = cadence.pauseEvery > 0 && cadence.pauseMs > 0
    ? Math.floor(cadenceIntervals / cadence.pauseEvery)
    : 0
  const cadenceMinimumTime = (cadenceIntervals * cadence.minDelayMs) + (cadencePauses * cadence.pauseMs)
  const cadenceMaximumTime = (cadenceIntervals * cadence.maxDelayMs) + (cadencePauses * cadence.pauseMs)

  const updateCurrentMessage = (patch: Partial<MessageStep>) => {
    setMessage((current) => ({ ...current, ...patch }))
  }

  const insertFormatting = (before: string, after = before) => {
    const textarea = textareaRef.current
    if (!textarea) return
    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const selected = currentMessage.text.slice(start, end)
    const nextText = `${currentMessage.text.slice(0, start)}${before}${selected}${after}${currentMessage.text.slice(end)}`.slice(0, 4096)
    updateCurrentMessage({ text: nextText })
    requestAnimationFrame(() => {
      textarea.focus()
      textarea.setSelectionRange(
        Math.min(start + before.length, nextText.length),
        Math.min(end + before.length, nextText.length),
      )
    })
  }

  const toggleContact = (id: string) => {
    setSelectedContactIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])
  }

  const changeContactGroup = (groupId: string) => {
    setSelectedContactGroupId(groupId)
  }

  const openContactImporter = () => {
    if (!contactGroups.length) {
      toast.error('Nenhum grupo com contatos foi encontrado')
      return
    }
    setSelectedContactGroupId(contactGroups[0].id)
    setShowContactImporter(true)
  }

  const closeContactImporter = () => {
    setShowContactImporter(false)
    setSelectedContactGroupId('')
  }

  const addContactsToCampaign = () => {
    const alreadyAdded = new Set(campaignContactIds)
    const chosen = sourceContacts.filter((contact) => !alreadyAdded.has(contact.id))
    if (!chosen.length) {
      toast.error('Todos os contatos deste grupo já estão na campanha')
      return
    }
    setContacts((current) => {
      const known = new Set(current.map((contact) => contact.id))
      return [...current, ...chosen.filter((contact) => !known.has(contact.id))]
    })
    setCampaignContactIds((current) => Array.from(new Set([...current, ...chosen.map((contact) => contact.id)])))
    setSelectedContactIds((current) => Array.from(new Set([...current, ...chosen.map((contact) => contact.id)])))
    closeContactImporter()
    toast.success(`Grupo adicionado: ${chosen.length} ${chosen.length === 1 ? 'contato' : 'contatos'}`)
  }

  const addManualContact = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const phone = manualContactPhone.replace(/\D/g, '')
    if (!/^\d{10,15}$/.test(phone)) {
      toast.error('Informe um telefone válido com DDI e DDD')
      return
    }

    const existing = contacts.find((contact) => String(contact.phone || '').replace(/\D/g, '') === phone)
    if (existing) {
      setCampaignContactIds((current) => Array.from(new Set([...current, existing.id])))
      setSelectedContactIds((current) => Array.from(new Set([...current, existing.id])))
      setContactSearch('')
      setManualContactPhone('')
      setManualContactName('')
      setShowManualContact(false)
      toast.success('Telefone já estava no CRM e foi selecionado')
      return
    }

    setAddingManualContact(true)
    try {
      const response = await api.post('/contacts', {
        name: manualContactName.trim() || `Teste ${phone.slice(-4)}`,
        phone,
        status: 'ACTIVE',
        source: 'TESTE_MANUAL',
        tags: ['Teste'],
      })
      const contact: Contact = response.data
      setContacts((current) => [contact, ...current])
      setCampaignContactIds((current) => Array.from(new Set([...current, contact.id])))
      setSelectedContactIds((current) => Array.from(new Set([...current, contact.id])))
      setContactSearch('')
      setManualContactPhone('')
      setManualContactName('')
      setShowManualContact(false)
      toast.success('Telefone adicionado e selecionado')
    } catch (error) {
      toast.error(errorMessage(error, 'Não foi possível adicionar o telefone'))
    } finally {
      setAddingManualContact(false)
    }
  }

  const clearCampaignList = async () => {
    const visibleCount = campaignContacts.length
    if (!visibleCount || clearingCampaignList) return
    const confirmed = await confirmToast(
      `Limpar os ${visibleCount} contatos desta lista da campanha? Eles continuarão salvos em Contatos e Grupos.`,
      { confirmLabel: 'Limpar lista' },
    )
    if (!confirmed) return

    setClearingCampaignList(true)
    try {
      setCampaignContactIds([])
      setSelectedContactIds([])
      setContactSearch('')
      toast.success('Lista da campanha limpa. Contatos e grupos foram preservados.')
    } finally {
      setClearingCampaignList(false)
    }
  }

  const importCsv = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setImporting(true)
    const toastId = toast.loading('Validando e importando contatos…')
    try {
      const rows = parseCsv(await file.text())
      if (!rows.length) throw new Error('Nenhum telefone válido foi encontrado')
      const response = await api.post('/contacts/bulk-import', {
        contacts: rows,
        consentConfirmed: true,
        source: 'CSV',
        consentSource: `Arquivo ${file.name}`,
      })
      const imported: Contact[] = response.data?.contacts || []
      setContacts((current) => {
        const ids = new Set(current.map((contact) => contact.id))
        return [...imported.filter((contact) => !ids.has(contact.id)), ...current]
      })
      setCampaignContactIds((current) => Array.from(new Set([...current, ...imported.map((contact) => contact.id)])))
      setSelectedContactIds((current) => Array.from(new Set([...current, ...imported.map((contact) => contact.id)])))
      toast.success(`${response.data?.total || imported.length} contatos prontos`, { id: toastId })
    } catch (error) {
      toast.error(errorMessage(error, 'Falha ao importar a lista'), { id: toastId })
    } finally {
      setImporting(false)
    }
  }

  const handleAttachmentFile = async (file: File) => {
    if (file.size > 10 * 1024 * 1024) {
      toast.error('O anexo deve ter no máximo 10 MB')
      return
    }
    setUploading(true)
    try {
      const response = await api.post('/campaigns/assets', {
        fileBase64: await fileToBase64(file),
        mimetype: file.type || 'application/octet-stream',
        fileName: file.name,
      })
      updateCurrentMessage({ attachment: response.data })
      toast.success('Anexo adicionado à mensagem')
    } catch (error) {
      toast.error(errorMessage(error, 'Falha ao enviar o anexo'))
    } finally {
      setUploading(false)
    }
  }

  const uploadAttachment = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file) void handleAttachmentFile(file)
  }

  const dropAttachment = (event: React.DragEvent<HTMLLabelElement>) => {
    event.preventDefault()
    setDraggingAttachment(false)
    const file = event.dataTransfer.files?.[0]
    if (file && !uploading) void handleAttachmentFile(file)
  }

  const resetComposer = () => {
    setName('')
    setMessage({ ...DEFAULT_MESSAGE })
    setMobilePanel('contacts')
    setCampaignContactIds([])
    setSelectedContactIds([])
    setShowContactImporter(false)
    setSelectedContactGroupId('')
  }

  const saveCampaign = async (startNow: boolean) => {
    if (!name.trim()) { toast.error('Dê um nome à campanha'); return }
    if (!selectedInstanceId) { toast.error('Selecione uma instância conectada'); return }
    if (selectedInstance?.status !== 'CONNECTED') { toast.error('A instância selecionada não está conectada'); return }
    if (!messageReady) { toast.error('Escreva a mensagem padrão'); return }
    if (!selectedContactIds.length) { toast.error('Selecione ao menos um destinatário'); return }
    setSaving(true)
    try {
      await api.patch('/campaigns/antispam', cadence)
      const response = await api.post('/campaigns', {
        name: name.trim(),
        messages: [message],
        contactIds: selectedContactIds,
        instanceId: selectedInstanceId,
        consentConfirmed: true,
      })
      if (startNow) await api.post(`/campaigns/${response.data.id}/start`, { config: cadence, instanceId: selectedInstanceId })
      toast.success(startNow ? 'Campanha iniciada' : 'Rascunho salvo')
      resetComposer()
      await load()
    } catch (error) {
      toast.error(errorMessage(error, 'Não foi possível salvar a campanha'))
    } finally {
      setSaving(false)
    }
  }

  const startCampaign = async (campaign: Campaign) => {
    const total = campaign._count?.contacts || 0
    const resuming = campaign.status === 'PAUSED'
    const instanceId = campaign.instanceId || selectedInstanceId
    const instance = instances.find((item) => item.id === instanceId)
    if (!instanceId || !instance) { toast.error('Selecione uma instância conectada'); return }
    if (instance.status !== 'CONNECTED') { toast.error(`A instância "${instance.name}" não está conectada`); return }
    const confirmed = await confirmToast(`${resuming ? 'Retomar' : 'Iniciar'} “${campaign.name}” para ${total} contatos usando ${instance.name}?`, { confirmLabel: resuming ? 'Retomar' : 'Iniciar' })
    if (!confirmed) return
    setActionCampaignId(campaign.id)
    try {
      await api.post(`/campaigns/${campaign.id}/start`, { config: cadence, instanceId })
      toast.success(resuming ? 'Campanha retomada' : 'Campanha iniciada')
      await load()
    } catch (error) {
      toast.error(errorMessage(error, resuming ? 'Não foi possível retomar' : 'Não foi possível iniciar'))
    } finally {
      setActionCampaignId(null)
    }
  }

  const pauseCampaign = async (campaign: Campaign) => {
    const confirmed = await confirmToast(`Pausar “${campaign.name}”? O próximo contato ficará aguardando até você retomar.`, { confirmLabel: 'Pausar' })
    if (!confirmed) return
    setActionCampaignId(campaign.id)
    try {
      await api.post(`/campaigns/${campaign.id}/pause`)
      toast.success('Campanha pausada')
      await load()
    } catch (error) {
      toast.error(errorMessage(error, 'Não foi possível pausar'))
    } finally {
      setActionCampaignId(null)
    }
  }

  const removeCampaign = async (campaign: Campaign) => {
    const confirmed = await confirmToast(`Excluir “${campaign.name}”?`, { confirmLabel: 'Excluir', danger: true })
    if (!confirmed) return
    try {
      await api.delete(`/campaigns/${campaign.id}`)
      toast.success('Campanha excluída')
      await load()
    } catch (error) {
      toast.error(errorMessage(error, 'Não foi possível excluir'))
    }
  }

  return (
    <div className="app-page space-y-5">
      <section className="app-tool-shell">
        <div className="grid gap-3 border-b border-border bg-gradient-to-r from-primary/[0.025] via-transparent to-violet-500/[0.025] p-3 sm:p-4 xl:grid-cols-[minmax(320px,1.3fr)_minmax(280px,1fr)_minmax(220px,0.72fr)] xl:items-stretch">
          <div className="flex min-w-0 flex-col rounded-2xl border border-border bg-[hsl(var(--surface-1))] p-3.5 shadow-sm">
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><Megaphone className="h-3.5 w-3.5" /></span>
              <div className="min-w-0 flex-1">
                <label htmlFor="campaign-name" className="block text-xs font-semibold text-foreground">Nome da campanha</label>
                <span className="block truncate text-[10px] text-muted-foreground">Identifique este disparo para encontrá-lo depois</span>
              </div>
              <span className={cn('rounded-full border border-border px-2 py-0.5 text-[9px] tabular-nums', name.length >= 70 ? 'text-amber-400' : 'text-muted-foreground')}>{name.length}/80</span>
            </div>
            <div className={cn(
              'mt-3 flex items-center rounded-xl border bg-[hsl(var(--surface-2))] px-3 transition focus-within:ring-2 focus-within:ring-primary/10',
              name.trim() ? 'border-primary/25 focus-within:border-primary/60' : 'border-border focus-within:border-primary/50',
            )}>
              <input
                id="campaign-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Ex.: Retorno clientes agosto"
                maxLength={80}
                autoComplete="off"
                className="min-w-0 flex-1 bg-transparent py-2.5 text-sm font-semibold text-foreground outline-none placeholder:font-normal placeholder:text-muted-foreground/65"
              />
              {name.trim() ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" aria-label="Nome preenchido" /> : null}
            </div>
          </div>

          <div className="flex min-w-0 flex-col rounded-2xl border border-border bg-[hsl(var(--surface-1))] p-3.5 shadow-sm">
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-violet-500/10 text-violet-300"><Smartphone className="h-3.5 w-3.5" /></span>
              <div className="min-w-0 flex-1">
                <label htmlFor="campaign-instance" className="block text-xs font-semibold text-foreground">Instância de envio</label>
                <span className="block truncate text-[10px] text-muted-foreground">Número usado para enviar</span>
              </div>
              <span className={cn(
                'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[9px] font-semibold',
                selectedInstance?.status === 'CONNECTED'
                  ? 'border-emerald-500/20 bg-emerald-500/[0.07] text-emerald-400'
                  : 'border-amber-500/20 bg-amber-500/[0.07] text-amber-400',
              )}>
                <span className={cn('h-1.5 w-1.5 rounded-full', selectedInstance?.status === 'CONNECTED' ? 'bg-emerald-400 shadow-[0_0_8px_#34d399]' : 'bg-amber-400')} />
                {selectedInstance?.status === 'CONNECTED' ? 'Conectada' : 'Pendente'}
              </span>
            </div>
            <div ref={instanceMenuRef} className="relative mt-3">
              <button
                id="campaign-instance"
                type="button"
                aria-haspopup="listbox"
                aria-expanded={showInstanceMenu}
                onClick={() => setShowInstanceMenu((current) => !current)}
                disabled={loadingInstances || !instances.length}
                className={cn(
                  'flex w-full items-center gap-3 rounded-xl border bg-[hsl(var(--surface-2))] px-3 py-2.5 text-left transition focus:outline-none focus:ring-2 focus:ring-primary/10 disabled:cursor-not-allowed disabled:opacity-50',
                  selectedInstance?.status === 'CONNECTED' ? 'border-emerald-500/20 hover:border-emerald-500/35' : 'border-amber-500/20 hover:border-amber-500/35',
                )}
              >
                <Smartphone className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
                  {loadingInstances ? 'Carregando instâncias…' : selectedInstance ? `${selectedInstance.name}${selectedInstance.number ? ` · ${selectedInstance.number}` : ''}` : 'Selecione uma instância'}
                </span>
                <ChevronDown className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', showInstanceMenu && 'rotate-180')} />
              </button>

              {showInstanceMenu ? (
                <div role="listbox" aria-label="Instâncias disponíveis" className="absolute left-0 right-0 top-full z-50 mt-2 overflow-hidden rounded-xl border border-border bg-[hsl(var(--surface-1))] p-1.5 shadow-[0_20px_50px_-16px_rgba(0,0,0,.95)]">
                  <div className="px-2.5 pb-1.5 pt-1 text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Escolha uma instância</div>
                  <div className="max-h-56 space-y-1 overflow-y-auto">
                    {instances.map((instance) => {
                      const connected = instance.status === 'CONNECTED'
                      const selected = instance.id === selectedInstanceId
                      return (
                        <button
                          key={instance.id}
                          type="button"
                          role="option"
                          aria-selected={selected}
                          disabled={!connected}
                          onClick={() => {
                            setSelectedInstanceId(instance.id)
                            setShowInstanceMenu(false)
                          }}
                          className={cn(
                            'flex w-full items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left transition',
                            selected ? 'border-primary/25 bg-primary/10' : 'border-transparent hover:bg-accent/70',
                            !connected && 'cursor-not-allowed opacity-45',
                          )}
                        >
                          <span className={cn('h-2 w-2 shrink-0 rounded-full', connected ? 'bg-emerald-400 shadow-[0_0_8px_#34d399]' : 'bg-muted-foreground')} />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-xs font-semibold text-foreground">{instance.name}</span>
                            <span className="block truncate text-[10px] text-muted-foreground">{instance.number || 'Número não identificado'}</span>
                          </span>
                          {selected ? <Check className="h-4 w-4 shrink-0 text-primary" /> : <span className="text-[9px] text-muted-foreground">{connected ? 'Disponível' : 'Desconectada'}</span>}
                        </button>
                      )
                    })}
                  </div>
                </div>
              ) : null}
            </div>
            {!loadingInstances && !connectedInstances.length ? (
              <p className="mt-2 text-[10px] text-amber-400">Nenhuma conta conectada. <Link href="/instances" className="font-semibold underline">Conectar agora</Link></p>
            ) : null}
          </div>

          <div className="flex min-w-0 flex-col rounded-2xl border border-border bg-[hsl(var(--surface-1))] p-3.5 shadow-sm">
            <div className="flex items-center gap-2.5">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-400"><Send className="h-3.5 w-3.5" /></span>
              <div>
                <p className="text-xs font-semibold text-foreground">Resumo do disparo</p>
                <p className="text-[10px] text-muted-foreground">Confira antes de iniciar</p>
              </div>
            </div>
            <div className="mt-3 grid flex-1 grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setMobilePanel('contacts')}
                className={cn(
                  'flex min-w-0 flex-col justify-center rounded-xl border px-3 py-2 text-left transition hover:bg-accent/60',
                  selectedContactIds.length ? 'border-primary/25 bg-primary/[0.07]' : 'border-border bg-[hsl(var(--surface-2))]',
                )}
              >
                <span className="text-base font-bold tabular-nums text-foreground">{selectedContactIds.length}</span>
                <span className="truncate text-[9px] uppercase tracking-wider text-muted-foreground">Contatos</span>
              </button>
              <button
                type="button"
                onClick={() => setMobilePanel('message')}
                className={cn(
                  'flex min-w-0 flex-col justify-center rounded-xl border px-3 py-2 text-left transition hover:bg-accent/60',
                  messageReady ? 'border-emerald-500/20 bg-emerald-500/[0.06]' : 'border-border bg-[hsl(var(--surface-2))]',
                )}
              >
                <span className="truncate text-sm font-bold text-foreground">{messageReady ? 'Pronta' : 'Vazia'}</span>
                <span className="truncate text-[9px] uppercase tracking-wider text-muted-foreground">Mensagem</span>
              </button>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-3 border-b border-border bg-[hsl(var(--surface-2))] p-1.5 xl:hidden" aria-label="Etapas da campanha">
          {([
            { id: 'contacts', label: 'Lista', detail: `${selectedContactIds.length}/${campaignContacts.length}`, icon: Users },
            { id: 'message', label: 'Mensagem', detail: 'Padrão', icon: Send },
            { id: 'attachment', label: 'Anexos', detail: currentMessage.attachment ? '1' : '0', icon: Paperclip },
          ] as const).map(({ id, label, detail, icon: Icon }) => (
            <button
              type="button"
              key={id}
              onClick={() => setMobilePanel(id)}
              aria-pressed={mobilePanel === id}
              className={cn(
                'flex min-w-0 items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-[10px] font-semibold transition',
                mobilePanel === id ? 'bg-primary/15 text-primary shadow-sm' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
              )}
            >
              <Icon className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{label}</span>
              <span className="rounded-full bg-background/50 px-1.5 py-0.5 text-[9px]">{detail}</span>
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 xl:h-[clamp(340px,44vh,480px)] xl:grid-cols-[240px_minmax(0,1fr)_225px]">
          <aside className={cn('min-h-0 flex-col border-b border-border p-3 sm:p-4 xl:flex xl:border-b-0 xl:border-r', mobilePanel === 'contacts' ? 'flex' : 'hidden')}>
            <div className="mb-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-foreground">Destinatários</p>
                <p className="truncate text-[11px] text-muted-foreground">{campaignContacts.length} {campaignContacts.length === 1 ? 'contato adicionado' : 'contatos adicionados'}</p>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button type="button" onClick={openContactImporter} className="col-span-2 inline-flex items-center justify-center gap-2 rounded-lg border border-violet-500/25 bg-violet-500/10 px-3 py-2.5 text-[10px] font-bold text-violet-300 transition hover:bg-violet-500/15">
                  <FolderOpen className="h-3.5 w-3.5" /> ADICIONAR GRUPO
                </button>
                <label className="inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-lg bg-emerald-500 px-2 py-2 text-[10px] font-bold text-white transition hover:bg-emerald-400">
                  {importing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileSpreadsheet className="h-3.5 w-3.5" />}
                  CARREGAR CSV
                  <input type="file" accept=".csv,.txt,text/csv" onChange={importCsv} disabled={importing} className="sr-only" />
                </label>
                <button
                  type="button"
                  onClick={() => setShowManualContact((current) => !current)}
                  className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-primary/40 px-2 py-2 text-[10px] font-bold text-primary transition hover:bg-primary/10"
                  aria-expanded={showManualContact}
                >
                  <Plus className="h-3.5 w-3.5" /> TELEFONE
                </button>
              </div>
            </div>
            {showManualContact ? (
              <form onSubmit={addManualContact} className="mb-3 space-y-2 rounded-xl border border-primary/25 bg-primary/5 p-2.5">
                <div className="flex items-center justify-between">
                  <p className="text-[11px] font-semibold text-foreground">Adicionar para teste</p>
                  <button type="button" onClick={() => setShowManualContact(false)} aria-label="Fechar telefone manual" className="text-muted-foreground hover:text-foreground">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
                <label htmlFor="manual-contact-name" className="sr-only">Nome do contato</label>
                <input
                  id="manual-contact-name"
                  value={manualContactName}
                  onChange={(event) => setManualContactName(event.target.value)}
                  placeholder="Nome (opcional)"
                  className={`${inputClass} py-1.5 text-xs`}
                />
                <label htmlFor="manual-contact-phone" className="sr-only">Telefone com DDI e DDD</label>
                <input
                  id="manual-contact-phone"
                  value={manualContactPhone}
                  onChange={(event) => setManualContactPhone(event.target.value)}
                  placeholder="+55 11 99999-9999"
                  inputMode="tel"
                  autoFocus
                  className={`${inputClass} py-1.5 text-xs`}
                />
                <p className="text-[9px] leading-relaxed text-muted-foreground">Inclua o DDI e o DDD do número.</p>
                <button type="submit" disabled={addingManualContact} className="btn-primary w-full justify-center py-1.5 text-[10px] disabled:opacity-50">
                  {addingManualContact ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                  ADICIONAR E SELECIONAR
                </button>
              </form>
            ) : null}
            <div className="relative mb-2">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input value={contactSearch} onChange={(event) => setContactSearch(event.target.value)} placeholder="Buscar nos destinatários" className={`${inputClass} py-1.5 pl-8 text-xs`} />
            </div>
            <div className="mb-2 flex items-center justify-between text-[10px]">
              <button type="button" onClick={() => setSelectedContactIds((current) => Array.from(new Set([...current, ...filteredContacts.map((contact) => contact.id)])))} className="text-primary hover:underline">
                {contactSearch.trim() ? 'Selecionar visíveis' : 'Selecionar todos'}
              </button>
              <button
                type="button"
                onClick={() => setSelectedContactIds([])}
                disabled={!selectedContactIds.length}
                className="text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
              >
                Limpar seleção{selectedContactIds.length ? ` (${selectedContactIds.length})` : ''}
              </button>
            </div>
            <button
              type="button"
              onClick={() => void clearCampaignList()}
              disabled={clearingCampaignList || !campaignContacts.length}
              className="mb-2 inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-amber-500/25 px-2 py-1.5 text-[10px] font-semibold text-amber-400 transition hover:bg-amber-500/10 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {clearingCampaignList ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
              {clearingCampaignList ? 'Limpando lista…' : `Limpar lista da campanha (${campaignContacts.length})`}
            </button>
            <div className="min-h-28 max-h-[46vh] space-y-1 overflow-y-auto overscroll-contain pr-1 xl:min-h-0 xl:max-h-none xl:flex-1">
              {filteredContacts.map((contact) => {
                const selected = selectedContactIds.includes(contact.id)
                return (
                  <button
                    type="button"
                    key={contact.id}
                    onClick={() => toggleContact(contact.id)}
                    className={`flex w-full items-center gap-2 rounded-xl border px-2.5 py-2 text-left transition ${selected ? 'border-primary/30 bg-primary/10' : 'border-transparent hover:bg-accent/60'}`}
                    aria-pressed={selected}
                  >
                    <span className={`flex h-4 w-4 items-center justify-center rounded border ${selected ? 'border-primary bg-primary text-white' : 'border-border'}`}>
                      {selected ? <Check className="h-3 w-3" /> : null}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-medium text-foreground">{contact.name}</span>
                      <span className="block truncate text-[10px] text-muted-foreground">{contact.phone || 'Sem telefone'}</span>
                    </span>
                  </button>
                )
              })}
              {!filteredContacts.length ? (
                <div className="rounded-xl border border-dashed border-border px-3 py-8 text-center text-xs text-muted-foreground">
                  <Users className="mx-auto mb-2 h-5 w-5 opacity-40" /> Nenhum destinatário adicionado
                </div>
              ) : null}
            </div>
          </aside>

          <div className={cn('min-h-0 min-w-0 flex-col border-b border-border xl:flex xl:border-b-0 xl:border-r', mobilePanel === 'message' ? 'flex' : 'hidden')}>
            <div className="flex items-center gap-2 border-b border-border px-4 py-3">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary"><Send className="h-3.5 w-3.5" /></span>
              <div>
                <p className="text-xs font-semibold text-foreground">Mensagem padrão</p>
                <p className="text-[9px] text-muted-foreground">Conteúdo único do disparo</p>
              </div>
              <span className={cn('ml-auto rounded-full border px-2 py-0.5 text-[9px] font-semibold', messageReady ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-400' : 'border-border text-muted-foreground')}>
                {messageReady ? 'Pronta' : 'Não preenchida'}
              </span>
            </div>
            <div className="flex items-center gap-1 border-b border-border px-4 py-2">
              <ToolbarButton label="Negrito" onClick={() => insertFormatting('*')}><Bold className="h-3.5 w-3.5" /></ToolbarButton>
              <ToolbarButton label="Itálico" onClick={() => insertFormatting('_')}><Italic className="h-3.5 w-3.5" /></ToolbarButton>
              <ToolbarButton label="Citação" onClick={() => insertFormatting('> ', '')}><Quote className="h-3.5 w-3.5" /></ToolbarButton>
              <span className="mx-1 h-4 w-px bg-border" />
              <button type="button" onClick={() => insertFormatting('{nome}', '')} className="rounded-lg px-2 py-1 text-[10px] font-medium text-primary hover:bg-primary/10">{'{nome}'}</button>
              <span className="ml-auto text-[10px] text-muted-foreground">{currentMessage.text.length}/4096</span>
            </div>
            <textarea
              ref={textareaRef}
              value={currentMessage.text}
              onChange={(event) => updateCurrentMessage({ text: event.target.value.slice(0, 4096) })}
              placeholder="Escreva a mensagem padrão. Use {nome} para personalizar."
              className="min-h-[300px] flex-1 resize-none bg-[hsl(var(--surface-2))] p-4 text-sm leading-6 text-foreground outline-none placeholder:text-muted-foreground/60 sm:min-h-[340px] sm:p-5 xl:min-h-0"
            />
            <div className="border-t border-border bg-[hsl(var(--surface-2))] px-5 py-3 text-[10px] text-muted-foreground">
              A mensagem será enviada exatamente como foi escrita acima.
            </div>
          </div>

          <aside className={cn('min-h-0 overflow-y-auto p-3 sm:p-4 xl:block', mobilePanel === 'attachment' ? 'block' : 'hidden')}>
            <div className="mb-3 flex items-center justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-foreground">Anexo</p>
                <p className="text-[11px] text-muted-foreground">Mensagem padrão</p>
              </div>
              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/10 px-2.5 py-2 text-[10px] font-bold text-primary transition hover:bg-primary/15">
                {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                ADICIONAR
                <input type="file" accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx" onChange={uploadAttachment} disabled={uploading} className="sr-only" />
              </label>
            </div>
            {currentMessage.attachment ? (
              <div className="rounded-xl border border-primary/25 bg-primary/5 p-3">
                <div className="flex items-start gap-2.5">
                  <div className="flex h-9 w-9 flex-none items-center justify-center rounded-lg bg-primary/10 text-primary">
                    {currentMessage.attachment.kind === 'image' ? <ImageIcon className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-semibold text-foreground">{currentMessage.attachment.fileName}</p>
                    <p className="mt-0.5 text-[10px] uppercase text-muted-foreground">{currentMessage.attachment.kind}</p>
                  </div>
                  <button type="button" onClick={() => updateCurrentMessage({ attachment: undefined })} aria-label="Remover anexo" className="rounded-md p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ) : (
              <label
                onDragEnter={(event) => { event.preventDefault(); setDraggingAttachment(true) }}
                onDragOver={(event) => event.preventDefault()}
                onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDraggingAttachment(false) }}
                onDrop={dropAttachment}
                className={cn(
                  'flex min-h-44 cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed bg-[hsl(var(--surface-2))] px-4 text-center transition',
                  draggingAttachment ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/30',
                )}
              >
                {uploading ? <Loader2 className="mb-2 h-6 w-6 animate-spin text-primary" /> : <Paperclip className="mb-2 h-6 w-6 text-muted-foreground/50" />}
                <span className="text-xs font-medium text-foreground">{draggingAttachment ? 'Solte o arquivo aqui' : 'Solte ou selecione um arquivo'}</span>
                <span className="mt-1 text-[10px] text-muted-foreground">Imagem, áudio, vídeo ou documento · 10 MB</span>
                <input type="file" accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx" onChange={uploadAttachment} disabled={uploading} className="sr-only" />
              </label>
            )}
            <div className="mt-4 rounded-xl border border-border p-3">
              <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Conteúdo do disparo</p>
              <button type="button" onClick={() => setMobilePanel('message')} className="flex w-full items-center gap-2 text-left">
                <span className={cn('flex h-6 w-6 items-center justify-center rounded-lg', messageReady ? 'bg-emerald-500/15 text-emerald-400' : 'bg-accent text-muted-foreground')}><Send className="h-3 w-3" /></span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[11px] font-medium text-foreground">Mensagem padrão</span>
                  <span className="block truncate text-[10px] text-muted-foreground">{message.text || message.attachment?.fileName || 'Ainda não preenchida'}</span>
                </span>
              </button>
            </div>
          </aside>
        </div>

        <div className="border-t border-border bg-[hsl(var(--surface-2))] p-3 sm:p-4">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-start gap-2.5">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><Settings2 className="h-4 w-4" /></span>
              <div>
                <p className="text-sm font-bold text-foreground">Ritmo dos disparos</p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">Escolha quanto esperar entre os contatos e quando fazer uma pausa.</p>
              </div>
            </div>
            <button type="button" onClick={() => setCadence(DEFAULT_CADENCE)} className="rounded-lg border border-border px-3 py-1.5 text-[10px] font-semibold text-muted-foreground transition hover:bg-accent hover:text-foreground">Restaurar padrão</button>
          </div>

          <div className="mb-4 rounded-xl border border-primary/20 bg-primary/[0.06] p-3 sm:p-4">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-primary">Como esta configuração funciona</p>
            <div className="mt-3 grid gap-3 text-[11px] leading-5 text-muted-foreground md:grid-cols-3">
              <p><strong className="block text-xs text-foreground">1. Envia para um contato</strong>Depois, espera entre <span className="font-bold text-primary">{cadence.minDelayMs / 1000} e {cadence.maxDelayMs / 1000} segundos</span> antes do próximo.</p>
              <p><strong className="block text-xs text-foreground">2. Faz uma pausa maior</strong>{cadence.pauseEvery > 0 && cadence.pauseMs > 0 ? <>Depois de cada <span className="font-bold text-primary">{cadence.pauseEvery} contatos</span>, pausa por <span className="font-bold text-primary">{formatDuration(cadence.pauseMs)}</span>.</> : 'A pausa automática está desativada.'}</p>
              <p><strong className="block text-xs text-foreground">3. Encerra a rodada</strong>Envia no máximo <span className="font-bold text-primary">{cadence.maxPerRun} contatos</span>. Se restarem contatos, a campanha ficará pausada para você continuar.</p>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-primary/10 pt-3 text-[10px] text-muted-foreground">
              <Clock3 className="h-3.5 w-3.5 text-primary" />
              <span>Estimativa para {cadenceRunContacts} {cadenceRunContacts === 1 ? 'contato' : 'contatos'}:</span>
              <strong className="text-foreground">{cadenceRunContacts <= 1 ? 'envio imediato' : `${formatDuration(cadenceMinimumTime)} a ${formatDuration(cadenceMaximumTime)}`}</strong>
              {!selectedContactIds.length ? <span className="text-muted-foreground/70">(exemplo de uma rodada completa)</span> : null}
            </div>
          </div>

          <div className="grid gap-3 lg:grid-cols-3">
            <div className="rounded-xl border border-border bg-[hsl(var(--surface-1))] p-3">
              <div className="mb-3"><p className="text-xs font-bold text-foreground">Tempo entre contatos</p><p className="mt-0.5 text-[10px] text-muted-foreground">O sistema sorteia um tempo dentro deste intervalo.</p></div>
              <div className="grid grid-cols-2 gap-2">
                <CadenceField label="Esperar pelo menos" suffix="segundos" value={cadence.minDelayMs / 1000} min={5} onChange={(value) => setCadence((current) => ({ ...current, minDelayMs: value * 1000, maxDelayMs: Math.max(current.maxDelayMs, value * 1000) }))} />
                <CadenceField label="Esperar no máximo" suffix="segundos" value={cadence.maxDelayMs / 1000} min={Math.max(5, cadence.minDelayMs / 1000)} onChange={(value) => setCadence((current) => ({ ...current, maxDelayMs: value * 1000 }))} />
              </div>
            </div>
            <div className="rounded-xl border border-border bg-[hsl(var(--surface-1))] p-3">
              <div className="mb-3"><p className="text-xs font-bold text-foreground">Pausa automática</p><p className="mt-0.5 text-[10px] text-muted-foreground">Use zero para desativar essa pausa extra.</p></div>
              <div className="grid grid-cols-2 gap-2">
                <CadenceField label="Pausar depois de" suffix="contatos" value={cadence.pauseEvery} min={0} onChange={(value) => setCadence((current) => ({ ...current, pauseEvery: value }))} />
                <CadenceField label="Pausar durante" suffix="minutos" value={cadence.pauseMs / 60000} min={0} step={0.5} onChange={(value) => setCadence((current) => ({ ...current, pauseMs: value * 60000 }))} />
              </div>
            </div>
            <div className="rounded-xl border border-border bg-[hsl(var(--surface-1))] p-3">
              <div className="mb-3"><p className="text-xs font-bold text-foreground">Tamanho da rodada</p><p className="mt-0.5 text-[10px] text-muted-foreground">Ao atingir o limite, você poderá continuar a campanha depois.</p></div>
              <CadenceField label="Encerrar a rodada após" suffix="contatos" value={cadence.maxPerRun} min={1} onChange={(value) => setCadence((current) => ({ ...current, maxPerRun: value }))} />
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-3 border-t border-border px-3 py-3 sm:px-4">
          <button type="button" onClick={() => void saveCampaign(false)} disabled={saving || loadingInstances} className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-border px-4 py-2.5 text-xs font-semibold text-foreground transition hover:bg-accent disabled:opacity-50 sm:w-auto">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Clock3 className="h-4 w-4" />} Salvar rascunho
          </button>
          <button type="button" onClick={() => void saveCampaign(true)} disabled={saving || loadingInstances || reachedCampaignLimit} title={reachedCampaignLimit ? `Limite do plano ${plan.name} atingido` : undefined} className="btn-primary w-full justify-center px-5 py-2.5 disabled:opacity-50 sm:w-auto">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} {reachedCampaignLimit ? 'Limite de campanhas' : 'Iniciar campanha'}
          </button>
        </div>
      </section>

      {showContactImporter ? (
        <ContactImporterModal
          groups={contactGroups}
          selectedGroupId={selectedContactGroupId}
          contactCount={sourceContacts.length}
          newContactCount={newGroupContactCount}
          loading={loadingGroupContacts}
          onGroupChange={changeContactGroup}
          onClose={closeContactImporter}
          onAdd={addContactsToCampaign}
        />
      ) : null}

      <section>
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-foreground">Campanhas recentes</h2>
            <p className="mt-1 text-[10px] font-medium text-violet-300">Plano {plan.name}: {activeCampaigns}/{plan.maxActiveCampaigns} ativas agora</p>
            <p className="text-xs text-muted-foreground">Acompanhe status, entregas e falhas.</p>
          </div>
          <span className="text-xs text-muted-foreground">{campaigns.length} campanhas</span>
        </div>
        {loading ? (
          <div className="flex h-40 items-center justify-center rounded-2xl border border-border"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
        ) : campaigns.length ? (
          <div className="grid gap-3 lg:grid-cols-2">
            {campaigns.map((campaign) => (
              <CampaignCard key={campaign.id} campaign={campaign} progress={progress[campaign.id]} busy={actionCampaignId === campaign.id} onStart={startCampaign} onPause={pauseCampaign} onRemove={removeCampaign} />
            ))}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-border px-6 py-10 text-center text-sm text-muted-foreground">Sua primeira campanha aparecerá aqui.</div>
        )}
      </section>
    </div>
  )
}

function ContactImporterModal({
  groups,
  selectedGroupId,
  contactCount,
  newContactCount,
  loading,
  onGroupChange,
  onClose,
  onAdd,
}: {
  groups: ContactGroupList[]
  selectedGroupId: string
  contactCount: number
  newContactCount: number
  loading: boolean
  onGroupChange: (groupId: string) => void
  onClose: () => void
  onAdd: () => void
}) {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="contact-importer-title"
        className="app-surface flex w-full flex-col overflow-visible rounded-b-none border-b-0 sm:max-w-md sm:rounded-2xl sm:border-b"
      >
        <header className="flex items-start gap-3 border-b border-border px-4 py-4 sm:px-5">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-500/10 text-violet-300">
            <FolderOpen className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="contact-importer-title" className="text-base font-bold text-foreground">Adicionar grupo</h2>
            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">Todos os contatos do grupo escolhido entrarão na campanha.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar seleção de grupo" className="rounded-lg p-2 text-muted-foreground transition hover:bg-accent hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="space-y-4 p-4 sm:p-5">
          <div>
            <label htmlFor="campaign-contact-import-source" className="mb-1.5 block text-[10px] font-bold uppercase tracking-[0.13em] text-muted-foreground">Grupo de contatos</label>
            <DarkSelect
              id="campaign-contact-import-source"
              ariaLabel="Grupo de contatos"
              value={selectedGroupId}
              options={groups.map((group) => ({ value: group.id, label: group.name, description: `${group.contactCount} ${group.contactCount === 1 ? 'contato' : 'contatos'}` }))}
              onChange={onGroupChange}
              placeholder="Selecione um grupo"
            />
          </div>

          <div className="flex items-center gap-3 rounded-xl border border-violet-500/20 bg-violet-500/[0.06] p-3.5">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-500/10 text-violet-300">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Users className="h-4 w-4" />}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-foreground">{loading ? 'Carregando contatos…' : `${contactCount} ${contactCount === 1 ? 'contato no grupo' : 'contatos no grupo'}`}</p>
              <p className="mt-0.5 text-[10px] text-muted-foreground">
                {loading ? 'Aguarde um instante.' : newContactCount === contactCount ? 'Todos serão adicionados à campanha.' : `${newContactCount} ainda não estão nesta campanha.`}
              </p>
            </div>
          </div>
        </div>

        <footer className="flex gap-2 border-t border-border bg-[hsl(var(--surface-2))] px-4 py-3 sm:justify-end sm:px-5">
          <button type="button" onClick={onClose} className="flex-1 rounded-xl border border-border px-4 py-2.5 text-xs font-semibold text-foreground transition hover:bg-accent sm:flex-none">Cancelar</button>
          <button type="button" onClick={onAdd} disabled={!newContactCount || loading} className="btn-primary flex-1 justify-center px-4 py-2.5 disabled:cursor-not-allowed disabled:opacity-40 sm:flex-none">
            <Plus className="h-4 w-4" /> Adicionar à campanha
          </button>
        </footer>
      </section>
    </div>
  )
}

function ToolbarButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" aria-label={label} title={label} onClick={onClick} className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground">{children}</button>
}

function CadenceField({ label, suffix, value, min, step = 1, onChange }: { label: string; suffix: string; value: number; min: number; step?: number; onChange: (value: number) => void }) {
  const displayValue = Number.isInteger(value) ? value : Number(value.toFixed(1))
  return (
    <label className="block rounded-xl border border-border bg-[hsl(var(--surface-2))] px-3 py-2.5 transition focus-within:border-primary/40 focus-within:ring-2 focus-within:ring-primary/10">
      <span className="block text-[10px] font-medium text-muted-foreground">{label}</span>
      <span className="mt-1 flex items-center gap-1.5">
        <input type="number" min={min} step={step} value={displayValue} onChange={(event) => onChange(Math.max(min, Number(event.target.value) || min))} className="min-w-0 flex-1 bg-transparent text-base font-bold text-foreground outline-none" />
        <span className="text-[10px] text-muted-foreground">{suffix}</span>
      </span>
    </label>
  )
}

function CampaignCard({ campaign, progress, busy, onStart, onPause, onRemove }: {
  campaign: Campaign
  progress?: Progress
  busy: boolean
  onStart: (campaign: Campaign) => void
  onPause: (campaign: Campaign) => void
  onRemove: (campaign: Campaign) => void
}) {
  const status = STATUS[campaign.status] || STATUS.DRAFT
  const total = campaign._count?.contacts || 0
  const sent = progress?.sent ?? campaign.totalSent
  const failed = progress?.failed ?? campaign.totalFailed
  const percentage = total ? Math.min(100, Math.round(((sent + failed) / total) * 100)) : 0
  const steps = campaign.messages?.length || 1

  return (
    <article className="app-surface p-4">
      <div className="mb-3 flex items-start gap-3">
        <div className="flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-primary/10 text-primary"><Megaphone className="h-4 w-4" /></div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-sm font-bold text-foreground">{campaign.name}</h3>
            <span className="rounded-full px-2 py-0.5 text-[9px] font-bold" style={{ color: status.color, background: `${status.color}18` }}>{status.label}</span>
          </div>
          <p className="mt-0.5 text-[11px] text-muted-foreground">{total} contatos · {steps} {steps === 1 ? 'mensagem' : 'mensagens'}</p>
          <p className="mt-1 flex items-center gap-1 text-[10px] text-muted-foreground">
            <Smartphone className="h-3 w-3 text-primary" /> {campaign.instanceName || 'Instância definida ao iniciar'}
          </p>
        </div>
      </div>
      <p className="mb-3 line-clamp-2 min-h-8 text-xs leading-4 text-muted-foreground">{campaign.message}</p>
      <div className="mb-3">
        <div className="mb-1 flex justify-between text-[10px] text-muted-foreground"><span>{sent} enviados{failed ? ` · ${failed} falhas` : ''}</span><span>{percentage}%</span></div>
        <div className="h-1.5 overflow-hidden rounded-full bg-accent"><div className="h-full rounded-full bg-primary transition-all" style={{ width: `${percentage}%` }} /></div>
      </div>
      <div className="flex items-center gap-2">
        {campaign.status === 'FINISHED' ? (
          <span className="inline-flex items-center gap-1.5 px-2 text-xs text-emerald-400"><CheckCircle2 className="h-3.5 w-3.5" /> Finalizada</span>
        ) : (
          <>
            {campaign.status !== 'RUNNING' ? (
              <button type="button" disabled={busy} onClick={() => onStart(campaign)} className="inline-flex items-center gap-1.5 rounded-lg border border-primary/25 bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary transition hover:bg-primary/15 disabled:cursor-wait disabled:opacity-50">
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                {campaign.status === 'PAUSED' ? 'Retomar' : 'Iniciar'}
              </button>
            ) : null}
            <button
              type="button"
              disabled={campaign.status !== 'RUNNING' || busy}
              onClick={() => onPause(campaign)}
              title={campaign.status === 'RUNNING' ? 'Pausar campanha' : 'Disponível quando a campanha estiver em andamento'}
              className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-400 transition hover:bg-amber-500/15 disabled:cursor-not-allowed disabled:border-border disabled:bg-transparent disabled:text-muted-foreground/45"
            >
              {busy && campaign.status === 'RUNNING' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Pause className="h-3.5 w-3.5" />}
              Pausar
            </button>
          </>
        )}
        <button type="button" onClick={() => onRemove(campaign)} aria-label={`Excluir ${campaign.name}`} className="ml-auto rounded-lg p-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></button>
      </div>
    </article>
  )
}
