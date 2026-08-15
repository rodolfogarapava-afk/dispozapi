'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { api } from '@/lib/api'
import { formatCurrency, formatDate } from '@/lib/utils'
import toast from 'react-hot-toast'
import { Loader2, Search, ChevronRight, Plus, X } from 'lucide-react'

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

export default function AdminClientesPage() {
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
          <Plus className="w-4 h-4" /> Nova organização
        </button>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nome..."
            className="w-full pl-9 pr-3 py-2 rounded-lg text-sm bg-card border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-[#00AEEF]" />
        </div>
        <select value={status} onChange={(e) => setStatus(e.target.value)}
          className="px-3 py-2 rounded-lg text-sm bg-card border border-border text-foreground focus:outline-none focus:border-[#00AEEF]">
          <option value="">Todos status</option>
          {STATUS_OPTS.map((s) => <option key={s} value={s}>{STATUS[s].label}</option>)}
        </select>
        <select value={plan} onChange={(e) => setPlan(e.target.value)}
          className="px-3 py-2 rounded-lg text-sm bg-card border border-border text-foreground focus:outline-none focus:border-[#00AEEF]">
          <option value="">Todos planos</option>
          {PLAN_OPTS.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
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
                  const st = STATUS[o.status] || STATUS.TRIAL
                  return (
                    <tr key={o.id} className="hover:bg-accent/30">
                      <td className="px-4 py-3">
                        <Link href={`/admin/clientes/${o.id}`} className="flex items-center gap-2 group">
                          <div>
                            <p className="font-semibold text-foreground group-hover:text-[#00AEEF]">{o.name}</p>
                            <p className="text-[10px] text-muted-foreground">{o.slug}</p>
                          </div>
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        <select value={o.plan} disabled={busyId === o.id} onChange={(e) => patch(o.id, { plan: e.target.value })}
                          className="bg-transparent border border-border rounded px-1.5 py-1 text-xs text-foreground focus:outline-none focus:border-[#00AEEF]">
                          {PLAN_OPTS.map((p) => <option key={p} value={p}>{p}</option>)}
                        </select>
                      </td>
                      <td className="px-4 py-3">
                        <select value={o.status} disabled={busyId === o.id} onChange={(e) => patch(o.id, { status: e.target.value })}
                          className="border rounded px-1.5 py-1 text-xs font-bold focus:outline-none"
                          style={{ background: st.color + '20', color: st.color, borderColor: st.color + '40' }}>
                          {STATUS_OPTS.map((s) => <option key={s} value={s} style={{ background: '#1a2030', color: '#fff' }}>{STATUS[s].label}</option>)}
                        </select>
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
                        <Link href={`/admin/clientes/${o.id}`} className="inline-flex items-center gap-1 text-xs text-[#00AEEF] hover:underline">
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
      toast.success('Organização criada')
      onCreated()
    } catch (e: any) { toast.error(e?.message || 'Erro ao criar'); setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)' }} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="rounded-2xl p-6 w-full max-w-md border border-border" style={{ background: 'hsl(var(--surface-1))' }}>
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold text-white">Nova organização</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-accent"><X className="w-4 h-4" /></button>
        </div>
        <form onSubmit={submit} className="space-y-3">
          <div><label className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1 block">Nome da empresa</label><input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={cls} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1 block">Plano</label>
              <select value={form.plan} onChange={(e) => setForm({ ...form, plan: e.target.value })} className={cls}>{PLAN_OPTS.map((p) => <option key={p} value={p}>{p}</option>)}</select></div>
            <div><label className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1 block">Status</label>
              <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className={cls}>{STATUS_OPTS.map((s) => <option key={s} value={s}>{STATUS[s].label}</option>)}</select></div>
          </div>
          <div className="pt-1 border-t border-border" />
          <p className="text-[11px] text-muted-foreground">Dono da conta (faz login no app):</p>
          <div><label className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1 block">Nome do dono</label><input value={form.ownerName} onChange={(e) => setForm({ ...form, ownerName: e.target.value })} className={cls} /></div>
          <div><label className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1 block">Email do dono</label><input type="email" required value={form.ownerEmail} onChange={(e) => setForm({ ...form, ownerEmail: e.target.value })} className={cls} /></div>
          <div><label className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1 block">Senha do dono</label><input type="text" required value={form.ownerPassword} onChange={(e) => setForm({ ...form, ownerPassword: e.target.value })} className={cls} /></div>
          <div className="flex gap-2 pt-2">
            <button type="button" onClick={onClose} className="flex-1 py-2.5 rounded-lg border border-border text-sm text-muted-foreground hover:bg-accent">Cancelar</button>
            <button type="submit" disabled={saving} className="flex-1 py-2.5 rounded-lg text-sm font-semibold text-white disabled:opacity-50" style={{ background: '#00AEEF' }}>{saving ? 'Criando...' : 'Criar'}</button>
          </div>
        </form>
      </div>
    </div>
  )
}
