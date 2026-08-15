'use client'

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import {
  Check, CheckCircle2, ChevronDown, ExternalLink, FileDown, Link2, Loader2, LogIn,
  RefreshCw, Search, ShieldCheck, Smartphone, Sparkles, UserPlus, Users, X,
} from 'lucide-react'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { PageHeader } from '@/components/layout/page-header'

interface WhatsappInstance {
  id: string
  name: string
  number?: string
  status: string
}

interface Participant {
  id: string
  phone: string
  name: string
  role: string
  canImport: boolean
}

interface WhatsappGroup {
  jid: string
  subject: string
  description: string
  participantCount: number
  role: string
  pictureUrl?: string | null
  participants?: Participant[]
  inviteCode?: string
  joined?: boolean
}

const fieldClass = 'w-full rounded-xl border border-border bg-[hsl(var(--surface-2))] px-3 py-2.5 text-sm text-foreground outline-none transition focus:border-primary/60 focus:ring-2 focus:ring-primary/10'

function errorMessage(error: any, fallback: string) {
  return error?.message || error?.response?.data?.message || fallback
}

function csvCell(value: unknown) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`
}

function maskedPhone(phone: string) {
  if (!phone) return 'Número protegido pelo WhatsApp'
  return `+${phone.slice(0, 2)} ••• ••• ${phone.slice(-4)}`
}

export default function GroupsPage() {
  const [instances, setInstances] = useState<WhatsappInstance[]>([])
  const [instanceId, setInstanceId] = useState('')
  const [showInstanceMenu, setShowInstanceMenu] = useState(false)
  const [groups, setGroups] = useState<WhatsappGroup[]>([])
  const [search, setSearch] = useState('')
  const [loadingInstances, setLoadingInstances] = useState(true)
  const [loadingGroups, setLoadingGroups] = useState(false)
  const [inviteLink, setInviteLink] = useState('')
  const [invitePreview, setInvitePreview] = useState<WhatsappGroup | null>(null)
  const [inspecting, setInspecting] = useState(false)
  const [joining, setJoining] = useState(false)
  const [membershipConfirmed, setMembershipConfirmed] = useState(false)
  const [selectedGroup, setSelectedGroup] = useState<WhatsappGroup | null>(null)
  const [loadingParticipants, setLoadingParticipants] = useState(false)
  const [selectedParticipantIds, setSelectedParticipantIds] = useState<string[]>([])
  const [importing, setImporting] = useState(false)
  const instanceMenuRef = useRef<HTMLDivElement>(null)
  const deferredSearch = useDeferredValue(search)

  useEffect(() => {
    let active = true
    api.get('/whatsapp/instances')
      .then((response) => {
        if (!active) return
        const data = response.data || []
        setInstances(data)
        const connected = data.find((instance: WhatsappInstance) => instance.status === 'CONNECTED')
        setInstanceId(connected?.id || data[0]?.id || '')
      })
      .catch((error) => toast.error(errorMessage(error, 'Não foi possível carregar as contas do WhatsApp')))
      .finally(() => { if (active) setLoadingInstances(false) })
    return () => { active = false }
  }, [])

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

  const visibleGroups = useMemo(() => {
    const term = deferredSearch.trim().toLocaleLowerCase('pt-BR')
    if (!term) return groups
    return groups.filter((group) => `${group.subject} ${group.description}`.toLocaleLowerCase('pt-BR').includes(term))
  }, [deferredSearch, groups])

  const connectedInstance = instances.find((instance) => instance.id === instanceId)
  const importableParticipants = selectedGroup?.participants?.filter((participant) => participant.canImport) || []

  const loadGroups = useCallback(async () => {
    if (!instanceId) {
      toast.error('Conecte uma conta do WhatsApp primeiro')
      return
    }
    setLoadingGroups(true)
    try {
      const response = await api.get('/groups', { params: { instanceId } })
      setGroups(response.data || [])
      toast.success(`${response.data?.length || 0} grupos sincronizados`)
    } catch (error) {
      toast.error(errorMessage(error, 'Não foi possível sincronizar os grupos'))
    } finally {
      setLoadingGroups(false)
    }
  }, [instanceId])

  const inspectInvite = async () => {
    if (!instanceId) { toast.error('Selecione uma conta conectada'); return }
    if (!inviteLink.includes('chat.whatsapp.com/')) { toast.error('Cole um link de convite válido'); return }
    setInspecting(true)
    try {
      const response = await api.post('/groups/inspect', { instanceId, inviteLink })
      setInvitePreview(response.data)
    } catch (error) {
      setInvitePreview(null)
      toast.error(errorMessage(error, 'Não foi possível consultar o convite'))
    } finally {
      setInspecting(false)
    }
  }

  const joinGroup = async () => {
    if (!membershipConfirmed) { toast.error('Confirme sua autorização para entrar no grupo'); return }
    setJoining(true)
    try {
      await api.post('/groups/join', { instanceId, inviteLink, membershipConfirmed: true })
      toast.success('Conta adicionada ao grupo')
      setInvitePreview((current) => current ? { ...current, joined: true } : current)
      await loadGroups()
    } catch (error) {
      toast.error(errorMessage(error, 'Não foi possível entrar no grupo'))
    } finally {
      setJoining(false)
    }
  }

  const openGroup = async (group: WhatsappGroup) => {
    setSelectedParticipantIds([])
    if (!instanceId) return
    setLoadingParticipants(true)
    try {
      const response = await api.get(`/groups/${encodeURIComponent(group.jid)}/participants`, { params: { instanceId } })
      setSelectedGroup(response.data)
    } catch (error) {
      toast.error(errorMessage(error, 'Não foi possível carregar os participantes'))
    } finally {
      setLoadingParticipants(false)
    }
  }

  const toggleParticipant = (id: string) => {
    setSelectedParticipantIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])
  }

  const downloadSelectedParticipants = () => {
    if (!selectedGroup || !selectedParticipantIds.length) {
      toast.error('Selecione ao menos um contato para baixar')
      return
    }
    const selected = importableParticipants.filter((participant) => selectedParticipantIds.includes(participant.id))
    if (!selected.length) {
      toast.error('Nenhum telefone disponível na seleção')
      return
    }
    const rows = [
      ['Nome', 'Telefone', 'Função', 'Grupo'],
      ...selected.map((participant) => [participant.name, participant.phone, participant.role, selectedGroup.subject]),
    ]
    const csv = `\uFEFF${rows.map((row) => row.map(csvCell).join(';')).join('\r\n')}`
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a')
    const slug = selectedGroup.subject.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'grupo'
    link.href = url
    link.download = `contatos-${slug}-${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(link)
    link.click()
    link.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    toast.success(`${selected.length} contatos baixados em CSV`)
  }

  const importParticipants = async () => {
    if (!selectedGroup || !selectedParticipantIds.length) { toast.error('Selecione ao menos um contato'); return }
    setImporting(true)
    try {
      const response = await api.post('/groups/import', {
        instanceId,
        groupJid: selectedGroup.jid,
        participantIds: selectedParticipantIds,
        consentConfirmed: true,
      })
      toast.success(`${response.data?.total || 0} contatos importados para o CRM`)
      setSelectedParticipantIds([])
    } catch (error) {
      toast.error(errorMessage(error, 'Não foi possível importar os contatos'))
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="app-page space-y-6">
      <PageHeader
        eyebrow="Inteligência de audiência"
        title="Localizador de grupos"
        description="Consulte convites e organize grupos da conta conectada. Nada é coletado sem uma ação explícita."
        icon={Sparkles}
        tone="emerald"
        actions={(
          <div className="app-status border-primary/20 bg-primary/10 text-primary">
            <ShieldCheck className="h-3.5 w-3.5" /> Sessão autorizada
          </div>
        )}
      />

      <section>
        <div className="app-tool-shell">
          <div className="flex flex-wrap items-center gap-3 border-b border-border p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-400"><Users className="h-5 w-5" /></div>
            <div className="min-w-[180px] flex-1">
              <h2 className="text-sm font-bold text-foreground">Grupos da conta</h2>
              <p className="text-[11px] text-muted-foreground">Pesquise apenas entre grupos já vinculados.</p>
            </div>
            <div ref={instanceMenuRef} className="relative w-full sm:w-64">
              <button
                type="button"
                aria-label="Conta do WhatsApp"
                aria-haspopup="listbox"
                aria-expanded={showInstanceMenu}
                onClick={() => setShowInstanceMenu((current) => !current)}
                disabled={loadingInstances || !instances.length}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-xl border bg-[hsl(var(--surface-2))] px-3 py-2 text-left transition focus:outline-none focus:ring-2 focus:ring-primary/10 disabled:cursor-not-allowed disabled:opacity-50',
                  connectedInstance?.status === 'CONNECTED' ? 'border-emerald-500/20 hover:border-emerald-500/35' : 'border-border hover:border-primary/30',
                )}
              >
                <span className={cn('h-2 w-2 shrink-0 rounded-full', connectedInstance?.status === 'CONNECTED' ? 'bg-emerald-400 shadow-[0_0_8px_#34d399]' : 'bg-amber-400')} />
                <span className="min-w-0 flex-1 truncate text-xs font-semibold text-foreground">
                  {loadingInstances ? 'Carregando contas…' : connectedInstance?.name || 'Selecione uma conta'}
                </span>
                <span className="shrink-0 text-[9px] text-muted-foreground">{connectedInstance?.status === 'CONNECTED' ? 'Conectada' : 'Pendente'}</span>
                <ChevronDown className={cn('h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform', showInstanceMenu && 'rotate-180')} />
              </button>

              {showInstanceMenu ? (
                <div role="listbox" aria-label="Contas do WhatsApp disponíveis" className="absolute left-0 right-0 top-full z-50 mt-2 overflow-hidden rounded-xl border border-border bg-[hsl(var(--surface-1))] p-1.5 shadow-[0_20px_50px_-16px_rgba(0,0,0,.95)]">
                  <div className="px-2.5 pb-1.5 pt-1 text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Escolha uma conta</div>
                  <div className="max-h-56 space-y-1 overflow-y-auto">
                    {instances.map((instance) => {
                      const connected = instance.status === 'CONNECTED'
                      const selected = instance.id === instanceId
                      return (
                        <button
                          key={instance.id}
                          type="button"
                          role="option"
                          aria-selected={selected}
                          disabled={!connected}
                          onClick={() => {
                            setInstanceId(instance.id)
                            setGroups([])
                            setShowInstanceMenu(false)
                          }}
                          className={cn(
                            'flex w-full items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left transition',
                            selected ? 'border-primary/25 bg-primary/10' : 'border-transparent hover:bg-accent/70',
                            !connected && 'cursor-not-allowed opacity-45',
                          )}
                        >
                          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent text-muted-foreground"><Smartphone className="h-3.5 w-3.5" /></span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-xs font-semibold text-foreground">{instance.name}</span>
                            <span className="block truncate text-[10px] text-muted-foreground">{instance.number || (connected ? 'Conta conectada' : 'Conta desconectada')}</span>
                          </span>
                          {selected ? <Check className="h-4 w-4 shrink-0 text-primary" /> : <span className={cn('h-2 w-2 shrink-0 rounded-full', connected ? 'bg-emerald-400' : 'bg-muted-foreground')} />}
                        </button>
                      )
                    })}
                  </div>
                </div>
              ) : null}
            </div>
            <button type="button" onClick={() => void loadGroups()} disabled={loadingGroups || !instanceId} className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-3 py-2 text-xs font-bold text-white transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40">
              {loadingGroups ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Sincronizar
            </button>
          </div>
          <div className="p-4">
            <div className="relative mb-3">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por assunto ou descrição" className={`${fieldClass} pl-9`} />
            </div>
            <div className="overflow-hidden rounded-xl border border-border">
              <div className="hidden grid-cols-[minmax(0,1fr)_110px_120px_42px] gap-3 border-b border-border bg-[hsl(var(--surface-2))] px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground md:grid">
                <span>Grupo</span><span>Participantes</span><span>Permissão</span><span />
              </div>
              <div className="max-h-[410px] divide-y divide-border overflow-y-auto">
                {visibleGroups.map((group) => (
                  <button type="button" key={group.jid} onClick={() => void openGroup(group)} className="grid w-full gap-3 px-4 py-3 text-left transition hover:bg-accent/50 md:grid-cols-[minmax(0,1fr)_110px_120px_42px] md:items-center">
                    <span className="min-w-0">
                      <span className="block truncate text-xs font-semibold text-foreground">{group.subject}</span>
                      <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">{group.description || 'Sem descrição'}</span>
                    </span>
                    <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground"><Users className="h-3.5 w-3.5" /> {group.participantCount}</span>
                    <span className="text-[11px] text-muted-foreground">{group.role}</span>
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-border text-muted-foreground"><ExternalLink className="h-3.5 w-3.5" /></span>
                  </button>
                ))}
                {!visibleGroups.length ? (
                  <div className="px-6 py-12 text-center">
                    <Users className="mx-auto mb-2 h-7 w-7 text-muted-foreground/40" />
                    <p className="text-sm font-medium text-foreground">Nenhum grupo carregado</p>
                    <p className="mt-1 text-xs text-muted-foreground">Sincronize uma conta conectada para carregar seus grupos.</p>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>

      </section>

      {loadingParticipants ? (
        <div className="flex h-36 items-center justify-center rounded-2xl border border-border"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
      ) : selectedGroup ? (
        <section className="app-tool-shell">
          <div className="flex flex-wrap items-center gap-3 border-b border-border p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary"><UserPlus className="h-5 w-5" /></div>
            <div className="min-w-[220px] flex-1">
              <h2 className="text-sm font-bold text-foreground">Contatos disponíveis · {selectedGroup.subject}</h2>
              <p className="text-[11px] text-muted-foreground">Selecione somente pessoas que autorizaram contato fora do grupo.</p>
            </div>
            <button type="button" onClick={() => setSelectedGroup(null)} aria-label="Fechar participantes" className="rounded-lg p-2 text-muted-foreground hover:bg-accent hover:text-foreground"><X className="h-4 w-4" /></button>
          </div>
          <div className="grid lg:grid-cols-[minmax(0,1fr)_310px]">
            <div className="border-b border-border p-4 lg:border-b-0 lg:border-r">
              <div className="mb-2 flex items-center justify-between text-[10px]">
                <button type="button" onClick={() => setSelectedParticipantIds(importableParticipants.map((participant) => participant.id))} className="text-primary hover:underline">Selecionar disponíveis</button>
                <button type="button" onClick={() => setSelectedParticipantIds([])} className="text-muted-foreground hover:text-foreground">Limpar</button>
              </div>
              <div className="max-h-72 overflow-y-auto rounded-xl border border-border">
                {(selectedGroup.participants || []).map((participant) => {
                  const selected = selectedParticipantIds.includes(participant.id)
                  return (
                    <button type="button" key={participant.id} disabled={!participant.canImport} onClick={() => toggleParticipant(participant.id)} aria-pressed={selected} className="flex w-full items-center gap-3 border-b border-border px-3 py-2.5 text-left last:border-b-0 hover:bg-accent/40 disabled:cursor-not-allowed disabled:opacity-45">
                      <span className={`flex h-4 w-4 items-center justify-center rounded border ${selected ? 'border-primary bg-primary text-white' : 'border-border'}`}>{selected ? <Check className="h-3 w-3" /> : null}</span>
                      <span className="min-w-0 flex-1"><span className="block truncate text-xs font-medium text-foreground">{participant.name}</span><span className="block text-[10px] text-muted-foreground">{maskedPhone(participant.phone)}</span></span>
                      <span className="rounded-full bg-accent px-2 py-0.5 text-[9px] text-muted-foreground">{participant.role}</span>
                    </button>
                  )
                })}
                {!selectedGroup.participants?.length ? <p className="p-8 text-center text-xs text-muted-foreground">Nenhum número disponível nesta sessão.</p> : null}
              </div>
            </div>
            <div className="p-4">
              <div className="rounded-xl border border-border bg-[hsl(var(--surface-2))] p-3">
                <p className="text-xs font-bold text-foreground">Importar para o CRM</p>
                <p className="mt-1 text-[10px] leading-4 text-muted-foreground">Os números protegidos pelo WhatsApp não são revelados nem importados. Duplicados são atualizados sem criar cópias.</p>
                <div className="my-3 flex items-center justify-between rounded-lg border border-border px-3 py-2"><span className="text-[10px] text-muted-foreground">Selecionados</span><span className="text-sm font-bold text-primary">{selectedParticipantIds.length}</span></div>
                <button type="button" onClick={() => void importParticipants()} disabled={importing || !selectedParticipantIds.length} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-xs font-bold text-white hover:bg-primary/90 disabled:opacity-40">
                  {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />} Importar contatos
                </button>
                <button type="button" onClick={downloadSelectedParticipants} disabled={!selectedParticipantIds.length} className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-primary/30 px-4 py-2.5 text-xs font-bold text-primary hover:bg-primary/10 disabled:opacity-40">
                  <FileDown className="h-4 w-4" /> Baixar selecionados (.CSV)
                </button>
                <p className="mt-2 text-[9px] leading-4 text-muted-foreground">O arquivo contém somente os contatos selecionados.</p>
              </div>
            </div>
          </div>
        </section>
      ) : null}

      <section className="app-surface p-4">
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary"><Link2 className="h-5 w-5" /></div>
          <div><h2 className="text-sm font-bold text-foreground">Analisar convite</h2><p className="text-[11px] text-muted-foreground">Consulte um link antes de entrar.</p></div>
        </div>
        <label htmlFor="invite-link" className="mb-1.5 block text-[11px] font-medium text-muted-foreground">Link do grupo</label>
        <textarea id="invite-link" rows={3} value={inviteLink} onChange={(event) => { setInviteLink(event.target.value); setInvitePreview(null) }} placeholder="https://chat.whatsapp.com/…" className={`${fieldClass} resize-none`} />
        <button type="button" onClick={() => void inspectInvite()} disabled={inspecting || !inviteLink} className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-primary/30 bg-primary/10 px-4 py-2.5 text-xs font-bold text-primary hover:bg-primary/15 disabled:opacity-40">
          {inspecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} Consultar convite
        </button>

        {invitePreview ? (
          <div className="mt-4 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3">
            <div className="flex items-start gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-400"><Users className="h-4 w-4" /></div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-bold text-foreground">{invitePreview.subject}</p>
                <p className="mt-0.5 text-[10px] text-muted-foreground">{invitePreview.participantCount} participantes</p>
              </div>
              <CheckCircle2 className="h-4 w-4 text-emerald-400" />
            </div>
            <p className="mt-3 line-clamp-3 text-[11px] leading-4 text-muted-foreground">{invitePreview.description || 'Convite válido, sem descrição pública.'}</p>
            <label className="mt-3 flex cursor-pointer items-start gap-2 text-[10px] text-muted-foreground">
              <input type="checkbox" checked={membershipConfirmed} onChange={(event) => setMembershipConfirmed(event.target.checked)} className="mt-0.5 accent-[#00AEEF]" />
              Confirmo que tenho autorização para participar deste grupo.
            </label>
            <button type="button" onClick={() => void joinGroup()} disabled={joining || invitePreview.joined} className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 py-2.5 text-xs font-bold text-white hover:bg-emerald-400 disabled:opacity-50">
              {joining ? <Loader2 className="h-4 w-4 animate-spin" /> : invitePreview.joined ? <Check className="h-4 w-4" /> : <LogIn className="h-4 w-4" />}
              {invitePreview.joined ? 'Grupo adicionado' : 'Entrar no grupo'}
            </button>
          </div>
        ) : (
          <div className="mt-4 rounded-xl border border-dashed border-border px-4 py-5 text-center text-[11px] text-muted-foreground">
            A consulta mostra nome, descrição e quantidade de participantes antes de qualquer ação.
          </div>
        )}
      </section>

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-500/15 bg-amber-500/5 px-4 py-3 text-[10px] text-amber-300/80">
        <span className="inline-flex items-center gap-2"><ShieldCheck className="h-3.5 w-3.5" /> Use somente grupos e contatos para os quais você possui autorização.</span>
        <span>{connectedInstance ? `Conta ativa: ${connectedInstance.name}` : 'Nenhuma conta selecionada'}</span>
      </div>
    </div>
  )
}
