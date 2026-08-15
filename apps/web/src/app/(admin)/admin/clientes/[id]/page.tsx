'use client'
import { useEffect, useState, useCallback } from 'react'
import { useParams, usePathname, useRouter } from 'next/navigation'
import Link from 'next/link'
import toast from 'react-hot-toast'
import { api } from '@/lib/api'
import { confirmToast } from '@/lib/confirm'
import { formatCurrency, formatDate } from '@/lib/utils'
import { getAdminBasePath } from '@/lib/admin-route'
import { Loader2, ArrowLeft, Save, Trash2, Pencil, UserPlus, KeyRound, Star, Power, X } from 'lucide-react'
import { PLANS, getPlan } from '@/lib/plans'

interface UserRow { id: string; name: string; email: string; role: string; active: boolean; isSuperAdmin: boolean; createdAt: string }
interface Detail {
  id: string; name: string; slug: string; plan: string; status: string
  trialEndsAt: string | null; planExpires: string | null; mrr: number; createdAt: string
  users: UserRow[]
  whatsappInstances: { id: string; name: string; number: string | null; status: string; createdAt: string }[]
  _count: { contacts: number; campaigns: number; chatbots: number; invoices: number; pipelines: number }
  invoices: { id: string; plan: string; amount: number; status: string; dueAt: string; paidAt: string | null }[]
}

const STATUS: Record<string, { label: string; color: string }> = {
  TRIAL: { label: 'Teste', color: '#00AEEF' }, ACTIVE: { label: 'Ativo', color: '#10B981' },
  PAST_DUE: { label: 'Atrasado', color: '#F59E0B' }, SUSPENDED: { label: 'Suspenso', color: '#EF4444' },
  CANCELED: { label: 'Cancelado', color: '#64748b' },
}
const STATUS_OPTS = ['TRIAL', 'ACTIVE', 'PAST_DUE', 'SUSPENDED', 'CANCELED']
const PLAN_OPTS = ['FREE', 'STARTER', 'PRO', 'ENTERPRISE']
const ROLE_OPTS = ['OWNER', 'ADMIN', 'MANAGER', 'MEMBER']
const inputCls = 'w-full px-2 py-1.5 rounded-lg text-xs bg-card border border-border text-foreground focus:outline-none focus:border-[#00AEEF]'

export default function AdminClienteDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const pathname = usePathname()
  const adminBasePath = getAdminBasePath(pathname)
  const [d, setD] = useState<Detail | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ status: '', plan: '', mrr: 0, trialEndsAt: '', planExpires: '' })
  const [editingName, setEditingName] = useState(false)
  const [nameDraft, setNameDraft] = useState('')
  const [userModal, setUserModal] = useState<UserRow | 'new' | null>(null)
  const [dataTab, setDataTab] = useState<'contacts' | 'campaigns' | 'instances' | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    api.get(`/admin/organizations/${id}`)
      .then((r) => {
        setD(r.data)
        setNameDraft(r.data.name)
        setForm({
          status: r.data.status, plan: r.data.plan, mrr: r.data.mrr || 0,
          trialEndsAt: r.data.trialEndsAt ? r.data.trialEndsAt.slice(0, 10) : '',
          planExpires: r.data.planExpires ? r.data.planExpires.slice(0, 10) : '',
        })
      })
      .catch(() => toast.error('Erro ao carregar'))
      .finally(() => setLoading(false))
  }, [id])
  useEffect(() => { load() }, [load])

  const saveSub = async () => {
    setSaving(true)
    try {
      const r = await api.patch(`/admin/organizations/${id}`, {
        status: form.status, plan: form.plan, mrr: Number(form.mrr),
        trialEndsAt: form.trialEndsAt || null, planExpires: form.planExpires || null,
      })
      setD((prev) => (prev ? { ...prev, ...r.data } : prev))
      toast.success('Assinatura atualizada')
    } catch (e: any) { toast.error(e?.message || 'Erro ao salvar') }
    finally { setSaving(false) }
  }

  const saveName = async () => {
    if (!nameDraft.trim()) return
    try {
      await api.patch(`/admin/organizations/${id}/rename`, { name: nameDraft.trim() })
      setD((prev) => (prev ? { ...prev, name: nameDraft.trim() } : prev))
      setEditingName(false)
      toast.success('Nome atualizado')
    } catch (e: any) { toast.error(e?.message || 'Erro ao renomear') }
  }

  const deleteOrg = async () => {
    if (!d) return
    const ok = await confirmToast(`EXCLUIR a org "${d.name}" e TODOS os dados (usuários, contatos, campanhas, instâncias)? Irreversível.`, { confirmLabel: 'Excluir tudo', danger: true })
    if (!ok) return
    try {
      await api.delete(`/admin/organizations/${id}`)
      toast.success('Organização excluída')
      router.push(`${adminBasePath}/clientes`)
    } catch (e: any) { toast.error(e?.message || 'Erro ao excluir') }
  }

  const userAction = async (u: UserRow, patch: any, label: string) => {
    try {
      await api.patch(`/admin/users/${u.id}`, patch)
      toast.success(label)
      load()
    } catch (e: any) { toast.error(e?.message || 'Erro') }
  }
  const deleteUser = async (u: UserRow) => {
    const ok = await confirmToast(`Excluir o usuário ${u.email}?`, { confirmLabel: 'Excluir', danger: true })
    if (!ok) return
    try { await api.delete(`/admin/users/${u.id}`); toast.success('Usuário excluído'); load() }
    catch (e: any) { toast.error(e?.message || 'Erro ao excluir') }
  }

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-6 h-6 animate-spin" style={{ color: '#00AEEF' }} /></div>
  if (!d) return <p className="text-sm text-muted-foreground">Cliente não encontrado. <Link href={`${adminBasePath}/clientes`} className="text-[#00AEEF]">Voltar</Link></p>

  const st = STATUS[d.status] || STATUS.TRIAL

  return (
    <div className="space-y-5">
      <Link href={`${adminBasePath}/clientes`} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft className="w-3 h-3" /> Voltar para clientes
      </Link>

      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="min-w-0">
          {editingName ? (
            <div className="flex items-center gap-2">
              <input autoFocus value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} className="px-2 py-1 rounded-lg text-lg font-bold bg-card border border-border text-foreground focus:outline-none focus:border-[#00AEEF]" />
              <button onClick={saveName} className="p-1.5 rounded-lg" style={{ background: '#00AEEF', color: '#fff' }}><Save className="w-4 h-4" /></button>
              <button onClick={() => { setEditingName(false); setNameDraft(d.name) }} className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground"><X className="w-4 h-4" /></button>
            </div>
          ) : (
            <h1 className="text-xl font-bold text-white flex items-center gap-2">
              {d.name}
              <button onClick={() => setEditingName(true)} title="Renomear" className="p-1 rounded hover:bg-accent text-muted-foreground"><Pencil className="w-3.5 h-3.5" /></button>
            </h1>
          )}
          <p className="text-sm text-muted-foreground mt-0.5">{d.slug} · criado em {formatDate(d.createdAt)}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold px-2 py-1 rounded" style={{ background: st.color + '25', color: st.color }}>{st.label}</span>
          <button onClick={deleteOrg} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold" style={{ background: '#EF444418', color: '#EF4444', border: '1px solid #EF444435' }}>
            <Trash2 className="w-3.5 h-3.5" /> Excluir org
          </button>
        </div>
      </div>

      {/* Métricas (clicáveis abrem dados) */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <Mini label="MRR" value={formatCurrency(d.mrr || 0)} />
        <Mini label="Usuários" value={String(d.users.length)} />
        <Mini label="Contatos" value={String(d._count.contacts)} onClick={() => setDataTab('contacts')} />
        <Mini label="Campanhas" value={String(d._count.campaigns)} onClick={() => setDataTab('campaigns')} />
        <Mini label="Fluxos" value={String(d._count.chatbots)} />
        <Mini label="WhatsApp" value={String(d.whatsappInstances.length)} onClick={() => setDataTab('instances')} />
      </div>

      {/* Gestão da assinatura */}
      <div className="rounded-xl p-4 border border-border space-y-3" style={{ background: 'hsl(var(--surface-1))' }}>
        <h2 className="text-sm font-semibold text-white">Gestão da assinatura</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <Field label="Status">
            <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className={inputCls}>
              {STATUS_OPTS.map((s) => <option key={s} value={s}>{STATUS[s].label}</option>)}
            </select>
          </Field>
          <Field label="Plano">
            <select value={form.plan} onChange={(e) => { const plan = getPlan(e.target.value); setForm({ ...form, plan: plan.code, mrr: plan.price }) }} className={inputCls}>
              {PLAN_OPTS.map((p) => <option key={p} value={p}>{PLANS[p as keyof typeof PLANS].name}</option>)}
            </select>
          </Field>
          <Field label="MRR (R$)">
            <input type="number" value={form.mrr} onChange={(e) => setForm({ ...form, mrr: Number(e.target.value) })} className={inputCls} />
          </Field>
          <Field label="Fim do teste">
            <input type="date" value={form.trialEndsAt} onChange={(e) => setForm({ ...form, trialEndsAt: e.target.value })} className={inputCls} />
          </Field>
          <Field label="Expira em">
            <input type="date" value={form.planExpires} onChange={(e) => setForm({ ...form, planExpires: e.target.value })} className={inputCls} />
          </Field>
        </div>
        <button onClick={saveSub} disabled={saving}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-50"
          style={{ background: '#00AEEF' }}>
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Salvar
        </button>
      </div>

      {/* Usuários */}
      <div className="rounded-xl border border-border overflow-hidden" style={{ background: 'hsl(var(--surface-1))' }}>
        <div className="flex items-center justify-between p-4 pb-3">
          <h2 className="text-sm font-semibold text-white">Usuários ({d.users.length})</h2>
          <button onClick={() => setUserModal('new')} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold" style={{ background: '#00AEEF18', color: '#00AEEF', border: '1px solid #00AEEF35' }}>
            <UserPlus className="w-3.5 h-3.5" /> Novo usuário
          </button>
        </div>
        <div className="divide-y divide-border">
          {d.users.map((u) => (
            <div key={u.id} className="flex items-center justify-between px-4 py-3 gap-2">
              <div className="min-w-0">
                <p className="text-xs font-semibold text-foreground truncate">{u.name} {u.isSuperAdmin && <span className="text-[#00AEEF]" title="Super-admin">★</span>}</p>
                <p className="text-[10px] text-muted-foreground truncate">{u.email}</p>
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-accent text-muted-foreground hidden sm:inline">{u.role}</span>
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: (u.active ? '#10B981' : '#EF4444') + '25', color: u.active ? '#10B981' : '#EF4444' }}>
                  {u.active ? 'Ativo' : 'Inativo'}
                </span>
                <button onClick={() => setUserModal(u)} title="Editar" className="p-1.5 rounded hover:bg-accent text-muted-foreground"><Pencil className="w-3.5 h-3.5" /></button>
                <button onClick={() => userAction(u, { active: !u.active }, u.active ? 'Desativado' : 'Ativado')} title={u.active ? 'Desativar' : 'Ativar'} className="p-1.5 rounded hover:bg-accent text-muted-foreground"><Power className="w-3.5 h-3.5" /></button>
                <button onClick={() => userAction(u, { isSuperAdmin: !u.isSuperAdmin }, u.isSuperAdmin ? 'Super-admin removido' : 'Promovido a super-admin')} title="Alternar super-admin" className="p-1.5 rounded hover:bg-accent" style={{ color: u.isSuperAdmin ? '#00AEEF' : '#64748b' }}><Star className="w-3.5 h-3.5" /></button>
                <button onClick={() => deleteUser(u)} title="Excluir" className="p-1.5 rounded hover:bg-accent" style={{ color: '#EF4444' }}><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* WhatsApp */}
      <div className="rounded-xl border border-border overflow-hidden" style={{ background: 'hsl(var(--surface-1))' }}>
        <h2 className="text-sm font-semibold text-white p-4 pb-3">Instâncias WhatsApp ({d.whatsappInstances.length})</h2>
        {d.whatsappInstances.length === 0 ? (
          <p className="text-xs text-muted-foreground px-4 pb-6">Nenhuma instância.</p>
        ) : (
          <div className="divide-y divide-border">
            {d.whatsappInstances.map((w) => (
              <div key={w.id} className="flex items-center justify-between px-4 py-3">
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-foreground truncate">{w.name}</p>
                  <p className="text-[10px] text-muted-foreground">{w.number || 'sem número'}</p>
                </div>
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: (w.status === 'CONNECTED' ? '#10B981' : '#64748b') + '25', color: w.status === 'CONNECTED' ? '#10B981' : '#64748b' }}>
                  {w.status}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Faturas */}
      <div className="rounded-xl border border-border overflow-hidden" style={{ background: 'hsl(var(--surface-1))' }}>
        <h2 className="text-sm font-semibold text-white p-4 pb-3">Faturas recentes</h2>
        {d.invoices.length === 0 ? (
          <p className="text-xs text-muted-foreground px-4 pb-6">Nenhuma fatura.</p>
        ) : (
          <div className="divide-y divide-border">
            {d.invoices.map((inv) => (
              <div key={inv.id} className="flex items-center justify-between px-4 py-3">
                <div>
                  <p className="text-xs font-semibold text-foreground">{inv.plan}</p>
                  <p className="text-[10px] text-muted-foreground">Venc. {formatDate(inv.dueAt)}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-accent text-muted-foreground">{inv.status}</span>
                  <span className="text-xs font-bold text-foreground w-24 text-right">{formatCurrency(inv.amount)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {userModal && <UserModal orgId={id} target={userModal} onClose={() => setUserModal(null)} onSaved={() => { setUserModal(null); load() }} />}
      {dataTab && <DataModal orgId={id} kind={dataTab} onClose={() => setDataTab(null)} />}
    </div>
  )
}

// ─── Modal de usuário (criar/editar) ───────────────────────
function UserModal({ orgId, target, onClose, onSaved }: { orgId: string; target: UserRow | 'new'; onClose: () => void; onSaved: () => void }) {
  const isNew = target === 'new'
  const u = isNew ? null : (target as UserRow)
  const [form, setForm] = useState({ name: u?.name || '', email: u?.email || '', password: '', role: u?.role || 'MEMBER', isSuperAdmin: u?.isSuperAdmin || false })
  const [saving, setSaving] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      if (isNew) {
        await api.post('/admin/users', { ...form, organizationId: orgId })
        toast.success('Usuário criado')
      } else {
        const patch: any = { name: form.name, email: form.email, role: form.role, isSuperAdmin: form.isSuperAdmin }
        if (form.password) patch.password = form.password
        await api.patch(`/admin/users/${u!.id}`, patch)
        toast.success('Usuário atualizado')
      }
      onSaved()
    } catch (e: any) { toast.error(e?.message || 'Erro ao salvar'); setSaving(false) }
  }

  return (
    <Modal title={isNew ? 'Novo usuário' : 'Editar usuário'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <ModalField label="Nome"><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputCls} /></ModalField>
        <ModalField label="Email"><input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className={inputCls} /></ModalField>
        <ModalField label={isNew ? 'Senha' : 'Nova senha (deixe vazio p/ manter)'}>
          <input type="text" required={isNew} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className={inputCls} placeholder={isNew ? '' : '••••••'} />
        </ModalField>
        <div className="grid grid-cols-2 gap-3">
          <ModalField label="Papel">
            <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} className={inputCls}>
              {ROLE_OPTS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </ModalField>
          <label className="flex items-end gap-2 pb-1.5 cursor-pointer">
            <input type="checkbox" checked={form.isSuperAdmin} onChange={(e) => setForm({ ...form, isSuperAdmin: e.target.checked })} />
            <span className="text-xs text-foreground">Super-admin</span>
          </label>
        </div>
        <div className="flex gap-2 pt-2">
          <button type="button" onClick={onClose} className="flex-1 py-2.5 rounded-lg border border-border text-sm text-muted-foreground hover:bg-accent">Cancelar</button>
          <button type="submit" disabled={saving} className="flex-1 py-2.5 rounded-lg text-sm font-semibold text-white disabled:opacity-50" style={{ background: '#00AEEF' }}>{saving ? 'Salvando...' : 'Salvar'}</button>
        </div>
      </form>
    </Modal>
  )
}

// ─── Modal de dados (contatos/campanhas/instâncias) ────────
function DataModal({ orgId, kind, onClose }: { orgId: string; kind: 'contacts' | 'campaigns' | 'instances'; onClose: () => void }) {
  const [items, setItems] = useState<any[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const titles = { contacts: 'Contatos', campaigns: 'Campanhas', instances: 'Instâncias WhatsApp' }

  const load = useCallback(() => {
    setLoading(true)
    api.get(`/admin/organizations/${orgId}/data/${kind}`, { params: { pageSize: 50 } })
      .then((r) => { setItems(r.data.items); setTotal(r.data.total) })
      .catch(() => toast.error('Erro ao carregar'))
      .finally(() => setLoading(false))
  }, [orgId, kind])
  useEffect(() => { load() }, [load])

  const del = async (it: any) => {
    const ok = await confirmToast(`Excluir "${it.name}"?`, { confirmLabel: 'Excluir', danger: true })
    if (!ok) return
    try { await api.delete(`/admin/data/${kind}/${it.id}`); toast.success('Excluído'); load() }
    catch (e: any) { toast.error(e?.message || 'Erro ao excluir') }
  }

  return (
    <Modal title={`${titles[kind]} (${total})`} onClose={onClose} wide>
      {loading ? (
        <div className="flex items-center justify-center h-40"><Loader2 className="w-6 h-6 animate-spin" style={{ color: '#00AEEF' }} /></div>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground py-6 text-center">Nenhum registro.</p>
      ) : (
        <div className="max-h-[60vh] overflow-y-auto divide-y divide-border">
          {items.map((it) => (
            <div key={it.id} className="flex items-center justify-between px-1 py-2.5 gap-2">
              <div className="min-w-0">
                <p className="text-xs font-semibold text-foreground truncate">{it.name}</p>
                <p className="text-[10px] text-muted-foreground truncate">
                  {kind === 'contacts' && (it.phone || it.email || '')}
                  {kind === 'campaigns' && `${it.status} · ${it.totalSent} enviadas · ${it._count?.contacts ?? 0} contatos`}
                  {kind === 'instances' && `${it.number || 'sem número'} · ${it.status}`}
                </p>
              </div>
              <button onClick={() => del(it)} title="Excluir" className="p-1.5 rounded hover:bg-accent flex-shrink-0" style={{ color: '#EF4444' }}><Trash2 className="w-3.5 h-3.5" /></button>
            </div>
          ))}
        </div>
      )}
    </Modal>
  )
}

// ─── Helpers de UI ─────────────────────────────────────────
function Modal({ title, children, onClose, wide }: { title: string; children: React.ReactNode; onClose: () => void; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)' }} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`rounded-2xl p-6 w-full border border-border ${wide ? 'max-w-xl' : 'max-w-md'}`} style={{ background: 'hsl(var(--surface-1))' }}>
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold text-white">{title}</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-accent transition"><X className="w-4 h-4" /></button>
        </div>
        {children}
      </div>
    </div>
  )
}
function ModalField({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1 block">{label}</label>{children}</div>
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1 block">{label}</label>{children}</div>
}
function Mini({ label, value, onClick }: { label: string; value: string; onClick?: () => void }) {
  return (
    <div onClick={onClick} className={`rounded-lg p-3 border border-border ${onClick ? 'cursor-pointer hover:border-[#00AEEF]/50 transition' : ''}`} style={{ background: 'hsl(var(--surface-1))' }}>
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-lg font-bold text-foreground mt-0.5">{value}</p>
    </div>
  )
}
