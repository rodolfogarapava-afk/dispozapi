'use client'
import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { api } from '@/lib/api'
import { confirmToast } from '@/lib/confirm'
import { Plus, X, Pencil, UserX, Shield, Loader2, UsersRound } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { DarkSelect } from '@/components/ui/dark-select'

interface Member {
  id: string; name: string; email: string; role: string; avatar: string | null; active: boolean; dealsCount: number
}

const ROLES = [
  { value: 'ADMIN', label: 'Administrador' },
  { value: 'MANAGER', label: 'Gerente' },
  { value: 'MEMBER', label: 'Atendente' },
]
const ROLE_LABEL: Record<string, string> = { OWNER: 'Dono', ADMIN: 'Administrador', MANAGER: 'Gerente', MEMBER: 'Atendente' }
const inputCls = 'app-input py-2'

export default function TeamPage() {
  const [members, setMembers] = useState<Member[]>([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState<{ mode: 'create' | 'edit'; member?: Member } | null>(null)
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'MEMBER', active: true })
  const [saving, setSaving] = useState(false)

  const load = () => {
    setLoading(true)
    api.get('/team').then((r) => setMembers(r.data)).catch(() => toast.error('Erro ao carregar equipe')).finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])

  const openCreate = () => { setForm({ name: '', email: '', password: '', role: 'MEMBER', active: true }); setModal({ mode: 'create' }) }
  const openEdit = (m: Member) => { setForm({ name: m.name, email: m.email, password: '', role: m.role, active: m.active }); setModal({ mode: 'edit', member: m }) }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (saving) return
    setSaving(true)
    try {
      if (modal?.mode === 'edit' && modal.member) {
        await api.patch(`/team/${modal.member.id}`, { name: form.name, role: form.role, active: form.active })
        toast.success('Atendente atualizado')
      } else {
        await api.post('/team', { name: form.name, email: form.email, password: form.password, role: form.role })
        toast.success('Atendente criado')
      }
      setModal(null); load()
    } catch (e: any) {
      toast.error(e?.response?.data?.message || e?.message || 'Erro ao salvar')
    }
    setSaving(false)
  }

  const remove = async (m: Member) => {
    const ok = await confirmToast(`Desativar "${m.name}"?`, { confirmLabel: 'Desativar', danger: true })
    if (!ok) return
    try { await api.delete(`/team/${m.id}`); toast.success('Atendente desativado'); load() }
    catch (e: any) { toast.error(e?.response?.data?.message || 'Erro ao desativar') }
  }

  return (
    <div className="app-page space-y-5">
      <PageHeader
        eyebrow="Gestão da equipe"
        title="Atendentes"
        description="Gerencie quem pode acessar e atender pela conta."
        icon={UsersRound}
        actions={<button onClick={openCreate} className="btn-primary"><Plus className="w-4 h-4" /> Novo atendente</button>}
      />

      {loading ? (
        <div className="flex items-center justify-center h-64"><Loader2 className="w-6 h-6 animate-spin" style={{ color: '#00AEEF' }} /></div>
      ) : (
        <div className="app-surface overflow-hidden">
          <div className="divide-y divide-border">
            {members.map((m) => (
              <div key={m.id} className="flex items-center gap-3 px-4 py-3" style={{ opacity: m.active ? 1 : 0.5 }}>
                <div className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold text-white flex-shrink-0" style={{ background: 'linear-gradient(135deg, #00AEEF, #0A84FF)' }}>
                  {m.name?.[0]?.toUpperCase() || '?'}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-foreground truncate">{m.name}</p>
                    {m.role === 'OWNER' && <Shield className="w-3 h-3" style={{ color: '#F59E0B' }} />}
                    {!m.active && <span className="text-[9px] px-1.5 py-0.5 rounded bg-red-500/15 text-red-400">inativo</span>}
                  </div>
                  <p className="text-[11px] text-muted-foreground truncate">{m.email}</p>
                </div>
                <div className="hidden sm:block text-right mr-2">
                  <p className="text-[10px] text-muted-foreground">{ROLE_LABEL[m.role] || m.role}</p>
                </div>
                {m.role !== 'OWNER' && (
                  <div className="flex items-center gap-1">
                    <button onClick={() => openEdit(m)} className="p-1.5 rounded hover:bg-accent transition" title="Editar"><Pencil className="w-3.5 h-3.5 text-muted-foreground" /></button>
                    {m.active && <button onClick={() => remove(m)} className="p-1.5 rounded hover:bg-accent transition" title="Desativar"><UserX className="w-3.5 h-3.5" style={{ color: '#EF4444' }} /></button>}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {modal && (
        <Modal onClose={() => !saving && setModal(null)} title={modal.mode === 'edit' ? 'Editar atendente' : 'Novo atendente'}>
          <form onSubmit={submit} className="space-y-3">
            <Field label="Nome *">
              <input autoFocus value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required disabled={saving} className={inputCls} style={{ background: 'hsl(var(--surface-sunken))' }} />
            </Field>
            <Field label="Email *">
              <input type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} required disabled={saving || modal.mode === 'edit'} className={inputCls} style={{ background: 'hsl(var(--surface-sunken))' }} />
            </Field>
            {modal.mode === 'create' && (
              <Field label="Senha *">
                <input type="password" value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} required minLength={6} placeholder="mín. 6 caracteres" disabled={saving} className={inputCls} style={{ background: 'hsl(var(--surface-sunken))' }} />
              </Field>
            )}
            <Field label="Função">
              <DarkSelect
                ariaLabel="Função do atendente"
                value={form.role}
                options={ROLES}
                onChange={(role) => setForm((current) => ({ ...current, role }))}
                disabled={saving}
              />
            </Field>
            {modal.mode === 'edit' && (
              <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                <input type="checkbox" checked={form.active} onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))} disabled={saving} />
                Conta ativa
              </label>
            )}
            <FormActions saving={saving} onCancel={() => setModal(null)} label={modal.mode === 'edit' ? 'Salvar' : 'Criar'} />
          </form>
        </Modal>
      )}
    </div>
  )
}

function Modal({ children, onClose, title }: { children: React.ReactNode; onClose: () => void; title: string }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)' }} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="app-surface w-full max-w-md p-6">
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
  return <div><label className="text-xs font-medium text-muted-foreground block mb-1">{label}</label>{children}</div>
}
function FormActions({ saving, onCancel, label }: { saving: boolean; onCancel: () => void; label: string }) {
  return (
    <div className="flex gap-2 pt-2">
      <button type="button" onClick={onCancel} disabled={saving} className="flex-1 py-2.5 rounded-lg border border-border text-sm text-muted-foreground hover:bg-accent transition disabled:opacity-50">Cancelar</button>
      <button type="submit" disabled={saving} className="btn-primary flex-1 justify-center disabled:opacity-50">{saving ? 'Salvando...' : label}</button>
    </div>
  )
}
