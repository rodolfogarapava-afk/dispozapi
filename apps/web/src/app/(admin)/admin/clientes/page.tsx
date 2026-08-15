'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { createPortal } from 'react-dom'
import { api } from '@/lib/api'
import { getAdminBasePath } from '@/lib/admin-route'
import { formatCurrency, formatDate } from '@/lib/utils'
import toast from 'react-hot-toast'
import { Check, ChevronDown, Loader2, Search, ChevronRight, Plus, X } from 'lucide-react'

interface Org {
  id: string; name: string; slug: string; plan: string; status: string
  trialEndsAt: string | null; planExpires: string | null; mrr: number
  createdAt: string; updatedAt: string
  _count: { users: number; contacts: number; whatsappInstances: number; campaigns: number }
}

const STATUS: Record<string, { label: string; color: string }> = {
  TRIAL: { label: 'Teste', color: '#00AEEF' },
  ACTIVE: { label: 'Ativo', color: '#10B981' },
  PAST_DUE: { label: 'Atrasado', color: '#F59E0B' },
  SUSPENDED: { label: 'Suspenso', color: '#EF4444' },
  CANCELED: { label: 'Cancelado', color: '#64748b' },
}
const STATUS_OPTS = ['TRIAL', 'ACTIVE', 'PAST_DUE', 'SUSPENDED', 'CANCELED']
const PLAN_OPTS = ['FREE', 'STARTER', 'PRO', 'ENTERPRISE']
const PLAN_OPTIONS = PLAN_OPTS.map((value) => ({ value, label: value }))
const STATUS_OPTIONS = STATUS_OPTS.map((value) => ({ value, label: STATUS[value].label, color: STATUS[value].color }))

export default function AdminClientesPage() {
  const pathname = usePathname()
  const adminBasePath = getAdminBasePath(pathname)
  const [items, setItems] = useState<Org[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('')
  const [plan, setPlan] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [newModal, setNewModal] = useState(false)

  const load = () => {
    setLoading(true)
    const params: any = {}
    if (q) params.q = q
    if (status) params.status = status
    if (plan) params.plan = plan
    api.get('/admin/organizations', { params })
      .then((r) => { setItems(r.data.items); setTotal(r.data.total) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [status, plan])
  useEffect(() => {
    const t = setTimeout(load, 350)
    return () => clearTimeout(t)
  }, [q])

  const patch = async (id: string, data: any) => {
    setBusyId(id)
    try {
      await api.patch(`/admin/organizations/${id}`, data)
      setItems((prev) => prev.map((o) => (o.id === id ? { ...o, ...data } : o)))
    } catch {}
    finally { setBusyId(null) }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-white">Clientes</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{total} organizações na plataforma</p>
        </div>
        <button onClick={() => setNewModal(true)} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold text-white" style={{ background: 'linear-gradient(135deg, #00AEEF, #0A84FF)' }}>
          <Plus className="w-4 h-4" /> Cadastrar cliente
        </button>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nome..."
            className="w-full pl-9 pr-3 py-2 rounded-lg text-sm bg-card border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-[#00AEEF]" />
        </div>
        <AdminSelect
          value={status}
          onChange={setStatus}
          options={[{ value: '', label: 'Todos os status' }, ...STATUS_OPTIONS]}
          ariaLabel="Filtrar por status"
          className="w-[170px]"
        />
        <AdminSelect
          value={plan}
          onChange={setPlan}
          options={[{ value: '', label: 'Todos os planos' }, ...PLAN_OPTIONS]}
          ariaLabel="Filtrar por plano"
          className="w-[160px]"
        />
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64"><Loader2 className="w-6 h-6 animate-spin" style={{ color: '#00AEEF' }} /></div>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum cliente encontrado.</p>
      ) : (
        <div className="rounded-xl border border-border overflow-hidden" style={{ background: 'hsl(220 28% 10%)' }}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wide text-muted-foreground border-b border-border">
                  <th className="px-4 py-3 font-medium">Cliente</th>
                  <th className="px-4 py-3 font-medium">Plano</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">MRR</th>
                  <th className="px-4 py-3 font-medium hidden md:table-cell">Uso</th>
                  <th className="px-4 py-3 font-medium hidden lg:table-cell">Criado</th>
                  <th className="px-4 py-3 font-medium text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {items.map((o) => {
                  return (
                    <tr key={o.id} className="hover:bg-accent/30">
                      <td className="px-4 py-3">
                        <Link href={`${adminBasePath}/clientes/${o.id}`} className="flex items-center gap-2 group">
                          <div>
                            <p className="font-semibold text-foreground group-hover:text-[#00AEEF]">{o.name}</p>
                            <p className="text-[10px] text-muted-foreground">{o.slug}</p>
                          </div>
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        <AdminSelect
                          value={o.plan}
                          disabled={busyId === o.id}
                          onChange={(value) => patch(o.id, { plan: value })}
                          options={PLAN_OPTIONS}
                          ariaLabel={`Plano de ${o.name}`}
                          compact
                          className="w-[138px]"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <AdminSelect
                          value={o.status}
                          disabled={busyId === o.id}
                          onChange={(value) => patch(o.id, { status: value })}
                          options={STATUS_OPTIONS}
                          ariaLabel={`Status de ${o.name}`}
                          compact
                          className="w-[138px]"
                        />
                        {o.status === 'TRIAL' && o.trialEndsAt && (
                          <p className="text-[10px] text-muted-foreground mt-1">até {formatDate(o.trialEndsAt)}</p>
                        )}
                      </td>
                      <td className="px-4 py-3 font-semibold text-foreground">{formatCurrency(o.mrr || 0)}</td>
                      <td className="px-4 py-3 hidden md:table-cell text-[11px] text-muted-foreground">
                        {o._count.users}u · {o._count.contacts}c · {o._count.whatsappInstances}wpp
                      </td>
                      <td className="px-4 py-3 hidden lg:table-cell text-[11px] text-muted-foreground">{formatDate(o.createdAt)}</td>
                      <td className="px-4 py-3 text-right">
                        <Link href={`${adminBasePath}/clientes/${o.id}`} className="inline-flex items-center gap-1 text-xs text-[#00AEEF] hover:underline">
                          Detalhes <ChevronRight className="w-3 h-3" />
                        </Link>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {newModal && <NewOrgModal onClose={() => setNewModal(false)} onCreated={() => { setNewModal(false); load() }} />}
    </div>
  )
}

function NewOrgModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({ name: '', ownerName: '', ownerEmail: '', ownerPassword: '', plan: 'FREE', status: 'TRIAL' })
  const [saving, setSaving] = useState(false)
  const cls = 'w-full px-2 py-1.5 rounded-lg text-xs bg-card border border-border text-foreground focus:outline-none focus:border-[#00AEEF]'

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      await api.post('/admin/organizations', form)
      toast.success('Cliente cadastrado')
      onCreated()
    } catch (e: any) { toast.error(e?.message || 'Erro ao criar'); setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)' }} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="rounded-2xl p-6 w-full max-w-md border border-border" style={{ background: 'hsl(var(--surface-1))' }}>
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold text-white">Cadastrar cliente</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-accent"><X className="w-4 h-4" /></button>
        </div>
        <form onSubmit={submit} className="space-y-3">
          <div><label className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1 block">Nome da empresa</label><input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={cls} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1 block">Plano</label>
              <AdminSelect value={form.plan} onChange={(value) => setForm({ ...form, plan: value })} options={PLAN_OPTIONS} ariaLabel="Plano do cliente" className="w-full" /></div>
            <div><label className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1 block">Status</label>
              <AdminSelect value={form.status} onChange={(value) => setForm({ ...form, status: value })} options={STATUS_OPTIONS} ariaLabel="Status do cliente" className="w-full" /></div>
          </div>
          <div className="pt-1 border-t border-border" />
          <p className="text-[11px] text-muted-foreground">Dono da conta (faz login no app):</p>
          <div><label className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1 block">Nome do dono</label><input value={form.ownerName} onChange={(e) => setForm({ ...form, ownerName: e.target.value })} className={cls} /></div>
          <div><label className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1 block">Email do dono</label><input type="email" required value={form.ownerEmail} onChange={(e) => setForm({ ...form, ownerEmail: e.target.value })} className={cls} /></div>
          <div><label className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1 block">Senha inicial do cliente</label><input type="password" required autoComplete="new-password" value={form.ownerPassword} onChange={(e) => setForm({ ...form, ownerPassword: e.target.value })} className={cls} /></div>
          <div className="flex gap-2 pt-2">
            <button type="button" onClick={onClose} className="flex-1 py-2.5 rounded-lg border border-border text-sm text-muted-foreground hover:bg-accent">Cancelar</button>
            <button type="submit" disabled={saving} className="flex-1 py-2.5 rounded-lg text-sm font-semibold text-white disabled:opacity-50" style={{ background: '#00AEEF' }}>{saving ? 'Cadastrando...' : 'Cadastrar'}</button>
          </div>
        </form>
      </div>
    </div>
  )
}

interface AdminSelectOption {
  value: string
  label: string
  color?: string
}

function AdminSelect({ value, onChange, options, ariaLabel, className = '', compact = false, disabled = false }: {
  value: string
  onChange: (value: string) => void
  options: AdminSelectOption[]
  ariaLabel: string
  className?: string
  compact?: boolean
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState({ top: 0, left: 0, width: 180, maxHeight: 260 })
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const selected = options.find((option) => option.value === value) || options[0]

  const updatePosition = useCallback(() => {
    const button = buttonRef.current
    if (!button) return
    const rect = button.getBoundingClientRect()
    const width = Math.max(rect.width, 180)
    const desiredHeight = Math.min(260, options.length * 42 + 12)
    const roomBelow = window.innerHeight - rect.bottom - 12
    const opensAbove = roomBelow < Math.min(desiredHeight, 180) && rect.top > roomBelow
    const top = opensAbove ? Math.max(12, rect.top - desiredHeight - 6) : rect.bottom + 6
    const left = Math.max(12, Math.min(rect.left, window.innerWidth - width - 12))
    setPosition({ top, left, width, maxHeight: Math.min(desiredHeight, opensAbove ? rect.top - 18 : roomBelow) })
  }, [options.length])

  useEffect(() => {
    if (!open) return
    updatePosition()
    const closeOnOutsideClick = (event: PointerEvent) => {
      const target = event.target as Node
      if (!buttonRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    document.addEventListener('pointerdown', closeOnOutsideClick)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
      document.removeEventListener('pointerdown', closeOnOutsideClick)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open, updatePosition])

  return (
    <div className={`relative ${className}`}>
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => !disabled && setOpen((current) => !current)}
        className={`flex w-full items-center justify-between gap-2 rounded-xl border text-left font-medium outline-none transition
          ${compact ? 'min-h-8 px-2.5 py-1.5 text-xs' : 'min-h-10 px-3 py-2 text-sm'}
          ${open ? 'border-[#00AEEF]/70 ring-2 ring-[#00AEEF]/10' : 'border-border hover:border-[#00AEEF]/35'}
          disabled:cursor-wait disabled:opacity-50`}
        style={selected?.color
          ? { background: `${selected.color}14`, color: selected.color, borderColor: `${selected.color}45` }
          : { background: 'hsl(var(--surface-sunken))', color: 'hsl(var(--foreground))' }}
      >
        <span className="flex min-w-0 items-center gap-2 truncate">
          {selected?.color && <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: selected.color, boxShadow: `0 0 8px ${selected.color}80` }} />}
          <span className="truncate">{selected?.label}</span>
        </span>
        <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && createPortal(
        <div
          ref={menuRef}
          role="listbox"
          aria-label={ariaLabel}
          className="admin-select-menu fixed z-[200] overflow-y-auto rounded-xl border border-border p-1.5 shadow-2xl shadow-black/60"
          style={{
            top: position.top,
            left: position.left,
            width: position.width,
            maxHeight: Math.max(96, position.maxHeight),
            background: 'hsl(var(--surface-2))',
            scrollbarWidth: 'thin',
            scrollbarColor: '#334155 transparent',
          }}
        >
          {options.map((option) => {
            const active = option.value === value
            return (
              <button
                key={option.value || 'all'}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => { onChange(option.value); setOpen(false) }}
                className={`flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-xs font-medium transition
                  ${active ? 'bg-[#00AEEF]/12 text-white' : 'text-muted-foreground hover:bg-white/[0.05] hover:text-white'}`}
              >
                {option.color ? (
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: option.color }} />
                ) : (
                  <span className="h-2 w-2 shrink-0 rounded-full border border-border" />
                )}
                <span className="flex-1 truncate">{option.label}</span>
                {active && <Check className="h-3.5 w-3.5 shrink-0 text-[#00AEEF]" />}
              </button>
            )
          })}
        </div>,
        document.body,
      )}
    </div>
  )
}
