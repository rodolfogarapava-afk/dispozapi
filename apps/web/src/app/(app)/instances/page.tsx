'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import {
  CheckCircle2, Loader2, MessageSquare, Phone, Plus, QrCode,
  RefreshCw, Smartphone, Trash2, Wifi, WifiOff, X,
} from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { api } from '@/lib/api'
import { wsClient } from '@/lib/ws'
import { cn } from '@/lib/utils'

interface WhatsappInstance {
  id: string
  name: string
  number?: string | null
  status: 'CONNECTED' | 'CONNECTING' | 'DISCONNECTED' | string
}

const STATUS = {
  CONNECTED: {
    label: 'Conectada',
    icon: Wifi,
    className: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-400',
  },
  CONNECTING: {
    label: 'Aguardando conexão',
    icon: RefreshCw,
    className: 'border-amber-500/25 bg-amber-500/10 text-amber-400',
  },
  DISCONNECTED: {
    label: 'Desconectada',
    icon: WifiOff,
    className: 'border-rose-500/25 bg-rose-500/10 text-rose-400',
  },
} as const

function statusInfo(status: string) {
  return STATUS[status as keyof typeof STATUS] || STATUS.DISCONNECTED
}

function formatPhone(value?: string | null) {
  const digits = String(value || '').replace(/\D/g, '')
  if (!digits) return 'Sem número conectado'
  if (digits.length === 13 && digits.startsWith('55')) {
    return `+55 (${digits.slice(2, 4)}) ${digits.slice(4, 9)}-${digits.slice(9)}`
  }
  if (digits.length === 12 && digits.startsWith('55')) {
    return `+55 (${digits.slice(2, 4)}) ${digits.slice(4, 8)}-${digits.slice(8)}`
  }
  return `+${digits}`
}

function errorMessage(error: any, fallback: string) {
  return error?.response?.data?.message || error?.message || fallback
}

function qrSource(value: string) {
  return value.startsWith('data:') ? value : `data:image/png;base64,${value}`
}

export default function InstancesPage() {
  const [instances, setInstances] = useState<WhatsappInstance[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<WhatsappInstance | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [qrTarget, setQrTarget] = useState<WhatsappInstance | null>(null)
  const [qrCode, setQrCode] = useState('')
  const [qrLoading, setQrLoading] = useState(false)
  const qrStatusTimer = useRef<ReturnType<typeof setInterval> | null>(null)
  const qrRefreshTimer = useRef<ReturnType<typeof setInterval> | null>(null)
  const qrSession = useRef(0)

  const loadInstances = useCallback(async (silent = false) => {
    if (!silent) setRefreshing(true)
    try {
      const response = await api.get('/whatsapp/instances')
      setInstances(Array.isArray(response.data) ? response.data : [])
    } catch (error) {
      if (!silent) toast.error(errorMessage(error, 'Não foi possível carregar as instâncias'))
    } finally {
      setLoading(false)
      if (!silent) setRefreshing(false)
    }
  }, [])

  const stopQrTimers = useCallback(() => {
    if (qrStatusTimer.current) clearInterval(qrStatusTimer.current)
    if (qrRefreshTimer.current) clearInterval(qrRefreshTimer.current)
    qrStatusTimer.current = null
    qrRefreshTimer.current = null
  }, [])

  const closeQr = useCallback(() => {
    qrSession.current += 1
    stopQrTimers()
    setQrTarget(null)
    setQrCode('')
    setQrLoading(false)
  }, [stopQrTimers])

  useEffect(() => {
    void loadInstances()
    const poll = setInterval(() => void loadInstances(true), 12000)
    return () => clearInterval(poll)
  }, [loadInstances])

  useEffect(() => {
    const stopConnection = wsClient.on('connection_update', (payload: any) => {
      setInstances((current) => current.map((instance) => (
        instance.id === payload.instanceId ? { ...instance, status: payload.status } : instance
      )))
    })
    const stopQr = wsClient.on('qrcode_updated', (payload: any) => {
      if (qrTarget?.id === payload.instanceId && payload.qrCode) setQrCode(payload.qrCode)
    })
    return () => {
      stopConnection()
      stopQr()
    }
  }, [qrTarget?.id])

  useEffect(() => () => stopQrTimers(), [stopQrTimers])

  const openQr = async (instance: WhatsappInstance) => {
    stopQrTimers()
    const session = ++qrSession.current
    let refreshingQr = false
    setQrTarget(instance)
    setQrCode('')
    setQrLoading(true)

    const refreshQr = async (showError = false) => {
      if (refreshingQr || qrSession.current !== session) return
      refreshingQr = true
      try {
        const response = await api.get(`/whatsapp/instances/${encodeURIComponent(instance.id)}/qrcode`)
        if (qrSession.current !== session) return
        const nextQr = response.data?.base64 || response.data?.qrcode?.base64 || ''
        if (nextQr) setQrCode(nextQr)
        setQrLoading(false)
      } catch (error) {
        if (qrSession.current !== session) return
        setQrLoading(false)
        if (showError) toast.error(errorMessage(error, 'Não foi possível gerar o QR Code'))
      } finally {
        refreshingQr = false
      }
    }

    await refreshQr(true)
    if (qrSession.current !== session) return

    qrRefreshTimer.current = setInterval(() => void refreshQr(), 20000)
    qrStatusTimer.current = setInterval(async () => {
      try {
        const response = await api.get(`/whatsapp/instances/${encodeURIComponent(instance.id)}/status`)
        if (response.data?.instance?.state !== 'open' || qrSession.current !== session) return
        closeQr()
        await loadInstances(true)
        toast.success('WhatsApp conectado com sucesso')
      } catch {}
    }, 3000)
  }

  const submitCreate = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const name = newName.trim()
    if (!name || creating) return
    setCreating(true)
    setCreateError('')
    try {
      await api.post('/whatsapp/instances', { name })
      setShowCreate(false)
      setNewName('')
      await loadInstances(true)
      toast.success('Instância criada. Clique em Conectar para ler o QR Code.')
    } catch (error) {
      setCreateError(errorMessage(error, 'Não foi possível criar a instância'))
    } finally {
      setCreating(false)
    }
  }

  const confirmDelete = async () => {
    if (!deleteTarget || deleting) return
    setDeleting(true)
    try {
      await api.delete(`/whatsapp/instances/${encodeURIComponent(deleteTarget.id)}`)
      setInstances((current) => current.filter((instance) => instance.id !== deleteTarget.id))
      setDeleteTarget(null)
      toast.success('Instância excluída')
    } catch (error) {
      toast.error(errorMessage(error, 'Não foi possível excluir a instância'))
    } finally {
      setDeleting(false)
    }
  }

  const connectedCount = instances.filter((instance) => instance.status === 'CONNECTED').length

  return (
    <div className="app-page space-y-6 pb-8">
      <PageHeader
        eyebrow="Conexões do WhatsApp"
        title="Instâncias"
        description="Conecte e gerencie os números usados nas conversas, grupos e campanhas."
        icon={Smartphone}
        actions={(
          <button type="button" onClick={() => { setCreateError(''); setNewName(''); setShowCreate(true) }} className="btn-primary w-full justify-center px-4 py-2.5 sm:w-auto">
            <Plus className="h-4 w-4" /> Nova instância
          </button>
        )}
      />

      <section className="grid gap-3 sm:grid-cols-3">
        <SummaryCard label="Total de instâncias" value={instances.length} icon={Smartphone} tone="primary" />
        <SummaryCard label="Conectadas" value={connectedCount} icon={Wifi} tone="emerald" />
        <SummaryCard label="Desconectadas" value={instances.length - connectedCount} icon={WifiOff} tone="rose" />
      </section>

      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-foreground">Seus números</h2>
            <p className="text-xs text-muted-foreground">O status é atualizado automaticamente.</p>
          </div>
          <button type="button" onClick={() => void loadInstances()} disabled={refreshing} className="inline-flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-xs font-medium text-muted-foreground transition hover:bg-accent hover:text-foreground disabled:opacity-50">
            <RefreshCw className={cn('h-3.5 w-3.5', refreshing && 'animate-spin')} /> Atualizar
          </button>
        </div>

        {loading ? (
          <div className="flex min-h-56 items-center justify-center rounded-2xl border border-border bg-[hsl(var(--surface-1))]">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : instances.length ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {instances.map((instance) => (
              <InstanceCard
                key={instance.id}
                instance={instance}
                onConnect={() => void openQr(instance)}
                onDelete={() => setDeleteTarget(instance)}
              />
            ))}
          </div>
        ) : (
          <div className="flex min-h-64 flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-[hsl(var(--surface-1))] px-6 text-center">
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary"><Smartphone className="h-6 w-6" /></div>
            <h3 className="text-sm font-bold text-foreground">Nenhuma instância cadastrada</h3>
            <p className="mt-1 max-w-sm text-xs leading-5 text-muted-foreground">Crie uma instância e escaneie o QR Code para conectar seu primeiro número.</p>
            <button type="button" onClick={() => setShowCreate(true)} className="btn-primary mt-4 px-4 py-2.5"><Plus className="h-4 w-4" /> Nova instância</button>
          </div>
        )}
      </section>

      {qrTarget ? (
        <Modal onClose={closeQr}>
          <div className="text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary"><QrCode className="h-6 w-6" /></div>
            <h3 className="text-base font-bold text-foreground">Conectar {qrTarget.name}</h3>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">No WhatsApp, abra Aparelhos conectados e escolha Conectar aparelho.</p>
            <div className="mx-auto mt-5 flex h-64 w-64 max-w-full items-center justify-center overflow-hidden rounded-2xl bg-white p-2">
              {qrCode ? <Image src={qrSource(qrCode)} alt={`QR Code de ${qrTarget.name}`} width={256} height={256} unoptimized className="h-full w-full object-contain" /> : <Loader2 className="h-8 w-8 animate-spin text-primary" />}
            </div>
            <div className="mt-4 flex items-center justify-center gap-2 text-[11px] text-muted-foreground">
              {qrLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              O QR Code é renovado automaticamente
            </div>
          </div>
        </Modal>
      ) : null}

      {showCreate ? (
        <Modal onClose={() => { if (!creating) setShowCreate(false) }}>
          <form onSubmit={submitCreate}>
            <div className="mb-5 flex items-start gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><Smartphone className="h-5 w-5" /></div>
              <div><h3 className="text-base font-bold text-foreground">Nova instância</h3><p className="mt-0.5 text-xs text-muted-foreground">Identifique o número antes de conectar.</p></div>
            </div>
            <label className="block text-xs font-medium text-muted-foreground" htmlFor="instance-name">Nome da instância</label>
            <input id="instance-name" autoFocus value={newName} onChange={(event) => setNewName(event.target.value)} disabled={creating} maxLength={60} placeholder="Ex.: Vendas, Suporte ou Principal" className="mt-1.5 w-full rounded-xl border border-border bg-[hsl(var(--surface-2))] px-3 py-2.5 text-sm text-foreground outline-none transition placeholder:text-muted-foreground/60 focus:border-primary/60 focus:ring-2 focus:ring-primary/10" />
            {createError ? <p className="mt-2 text-[11px] text-rose-400">{createError}</p> : null}
            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row">
              <button type="button" onClick={() => setShowCreate(false)} disabled={creating} className="flex-1 rounded-xl border border-border px-4 py-2.5 text-xs font-semibold text-muted-foreground transition hover:bg-accent">Cancelar</button>
              <button type="submit" disabled={!newName.trim() || creating} className="btn-primary flex-1 justify-center px-4 py-2.5 disabled:opacity-50">{creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} {creating ? 'Criando…' : 'Criar instância'}</button>
            </div>
          </form>
        </Modal>
      ) : null}

      {deleteTarget ? (
        <Modal onClose={() => { if (!deleting) setDeleteTarget(null) }}>
          <div className="text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-500/10 text-rose-400"><Trash2 className="h-5 w-5" /></div>
            <h3 className="text-base font-bold text-foreground">Excluir instância?</h3>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">A instância <strong className="text-foreground">{deleteTarget.name}</strong> será desconectada e suas conversas locais serão removidas.</p>
            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row">
              <button type="button" onClick={() => setDeleteTarget(null)} disabled={deleting} className="flex-1 rounded-xl border border-border px-4 py-2.5 text-xs font-semibold text-muted-foreground transition hover:bg-accent">Cancelar</button>
              <button type="button" onClick={() => void confirmDelete()} disabled={deleting} className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-rose-500 px-4 py-2.5 text-xs font-bold text-white transition hover:bg-rose-400 disabled:opacity-50">{deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />} {deleting ? 'Excluindo…' : 'Excluir'}</button>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  )
}

function InstanceCard({ instance, onConnect, onDelete }: { instance: WhatsappInstance; onConnect: () => void; onDelete: () => void }) {
  const info = statusInfo(instance.status)
  const StatusIcon = info.icon
  const connected = instance.status === 'CONNECTED'
  return (
    <article className="app-surface group overflow-hidden p-4 transition hover:border-primary/25 sm:p-5">
      <div className="flex items-start gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-primary/15 bg-gradient-to-br from-primary/20 to-violet-500/10 text-sm font-bold text-primary">
          {instance.name.charAt(0).toUpperCase() || <Phone className="h-4 w-4" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-sm font-bold text-foreground">{instance.name}</h3>
            <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[9px] font-bold', info.className)}><StatusIcon className={cn('h-3 w-3', instance.status === 'CONNECTING' && 'animate-spin')} /> {info.label}</span>
          </div>
          <p className="mt-1 truncate text-xs text-muted-foreground">{formatPhone(instance.number)}</p>
        </div>
      </div>
      <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-border pt-4">
        {connected ? (
          <Link href="/whatsapp" className="inline-flex items-center gap-2 rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-xs font-semibold text-emerald-400 transition hover:bg-emerald-500/15"><MessageSquare className="h-3.5 w-3.5" /> Abrir conversas</Link>
        ) : (
          <button type="button" onClick={onConnect} className="inline-flex items-center gap-2 rounded-xl border border-primary/25 bg-primary/10 px-3 py-2 text-xs font-semibold text-primary transition hover:bg-primary/15"><QrCode className="h-3.5 w-3.5" /> Conectar</button>
        )}
        {connected ? <span className="ml-auto inline-flex items-center gap-1 text-[10px] text-emerald-400"><CheckCircle2 className="h-3.5 w-3.5" /> Pronta para uso</span> : null}
        <button type="button" onClick={onDelete} aria-label={`Excluir instância ${instance.name}`} title="Excluir instância" className={cn('rounded-lg p-2 text-muted-foreground transition hover:bg-rose-500/10 hover:text-rose-400', !connected && 'ml-auto')}><Trash2 className="h-3.5 w-3.5" /></button>
      </div>
    </article>
  )
}

function SummaryCard({ label, value, icon: Icon, tone }: { label: string; value: number; icon: typeof Smartphone; tone: 'primary' | 'emerald' | 'rose' }) {
  const toneClass = tone === 'emerald' ? 'bg-emerald-500/10 text-emerald-400' : tone === 'rose' ? 'bg-rose-500/10 text-rose-400' : 'bg-primary/10 text-primary'
  return (
    <article className="app-surface flex items-center gap-3 p-4">
      <div className={cn('flex h-10 w-10 items-center justify-center rounded-xl', toneClass)}><Icon className="h-4 w-4" /></div>
      <div><p className="text-xl font-bold text-foreground">{value}</p><p className="text-[11px] text-muted-foreground">{label}</p></div>
    </article>
  )
}

function Modal({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/75 p-4 backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div className="app-surface relative w-full max-w-sm p-5 shadow-2xl sm:p-6">
        <button type="button" onClick={onClose} aria-label="Fechar" className="absolute right-3 top-3 rounded-lg p-1.5 text-muted-foreground transition hover:bg-accent hover:text-foreground"><X className="h-4 w-4" /></button>
        {children}
      </div>
    </div>
  )
}
