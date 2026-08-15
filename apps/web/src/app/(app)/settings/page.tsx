'use client'
import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { api } from '@/lib/api'
import { useAuthStore } from '@/store/auth.store'
import { User, Lock, Building2, Settings2 } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'

const inputCls = 'app-input py-2'

export default function SettingsPage() {
  const { user, fetchMe } = useAuthStore()

  const [profile, setProfile] = useState({ name: '', email: '' })
  const [pwd, setPwd] = useState({ currentPassword: '', newPassword: '', confirm: '' })
  const [org, setOrg] = useState({ name: '' })
  const [saving, setSaving] = useState<string | null>(null)

  useEffect(() => {
    if (user) {
      setProfile({ name: user.name || '', email: user.email || '' })
      setOrg({ name: user.organization?.name || '' })
    }
  }, [user])

  const saveProfile = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving('profile')
    try { await api.patch('/auth/profile', profile); await fetchMe(); toast.success('Perfil atualizado') }
    catch (e: any) { toast.error(e?.response?.data?.message || 'Erro ao salvar perfil') }
    setSaving(null)
  }

  const savePassword = async (e: React.FormEvent) => {
    e.preventDefault()
    if (pwd.newPassword !== pwd.confirm) { toast.error('As senhas não coincidem'); return }
    setSaving('password')
    try {
      await api.patch('/auth/password', { currentPassword: pwd.currentPassword, newPassword: pwd.newPassword })
      toast.success('Senha alterada'); setPwd({ currentPassword: '', newPassword: '', confirm: '' })
    } catch (e: any) { toast.error(e?.response?.data?.message || 'Erro ao trocar senha') }
    setSaving(null)
  }

  const saveOrg = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving('org')
    try { await api.patch('/auth/organization', org); await fetchMe(); toast.success('Organização atualizada') }
    catch (e: any) { toast.error(e?.response?.data?.message || 'Erro ao salvar') }
    setSaving(null)
  }

  const canEditOrg = user && ['OWNER', 'ADMIN', 'MANAGER'].includes(user.role)

  return (
    <div className="app-page max-w-5xl space-y-5">
      <PageHeader
        eyebrow="Gestão da conta"
        title="Configurações"
        description="Atualize seu perfil, a segurança e os dados da organização."
        icon={Settings2}
      />

      <div className="grid gap-4 lg:grid-cols-2">

      {/* Perfil */}
      <Section icon={User} title="Perfil">
        <form onSubmit={saveProfile} className="space-y-3">
          <Field label="Nome">
            <input value={profile.name} onChange={(e) => setProfile((p) => ({ ...p, name: e.target.value }))} className={inputCls} style={{ background: 'hsl(var(--surface-sunken))' }} />
          </Field>
          <Field label="Email">
            <input type="email" value={profile.email} onChange={(e) => setProfile((p) => ({ ...p, email: e.target.value }))} className={inputCls} style={{ background: 'hsl(var(--surface-sunken))' }} />
          </Field>
          <SaveBtn loading={saving === 'profile'} />
        </form>
      </Section>

      {/* Senha */}
      <Section icon={Lock} title="Senha">
        <form onSubmit={savePassword} className="space-y-3">
          <Field label="Senha atual">
            <input type="password" value={pwd.currentPassword} onChange={(e) => setPwd((p) => ({ ...p, currentPassword: e.target.value }))} required className={inputCls} style={{ background: 'hsl(var(--surface-sunken))' }} />
          </Field>
          <Field label="Nova senha">
            <input type="password" value={pwd.newPassword} onChange={(e) => setPwd((p) => ({ ...p, newPassword: e.target.value }))} required minLength={6} className={inputCls} style={{ background: 'hsl(var(--surface-sunken))' }} />
          </Field>
          <Field label="Confirmar nova senha">
            <input type="password" value={pwd.confirm} onChange={(e) => setPwd((p) => ({ ...p, confirm: e.target.value }))} required className={inputCls} style={{ background: 'hsl(var(--surface-sunken))' }} />
          </Field>
          <SaveBtn loading={saving === 'password'} label="Trocar senha" />
        </form>
      </Section>
      </div>

      {/* Organização */}
      <Section icon={Building2} title="Organização">
        <form onSubmit={saveOrg} className="space-y-3">
          <Field label="Nome da organização">
            <input value={org.name} onChange={(e) => setOrg({ name: e.target.value })} disabled={!canEditOrg} className={inputCls} style={{ background: 'hsl(var(--surface-sunken))' }} />
          </Field>
          {canEditOrg
            ? <SaveBtn loading={saving === 'org'} />
            : <p className="text-[11px] text-muted-foreground">Apenas administradores podem renomear a organização.</p>}
        </form>
      </Section>
    </div>
  )
}

function Section({ icon: Icon, title, children }: { icon: any; title: string; children: React.ReactNode }) {
  return (
    <div className="app-surface p-5">
      <div className="flex items-center gap-2 mb-4">
        <Icon className="w-4 h-4" style={{ color: '#00AEEF' }} />
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      </div>
      {children}
    </div>
  )
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="text-xs font-medium text-muted-foreground block mb-1">{label}</label>{children}</div>
}
function SaveBtn({ loading, label = 'Salvar' }: { loading: boolean; label?: string }) {
  return <button type="submit" disabled={loading} className="btn-primary justify-center disabled:opacity-50">{loading ? 'Salvando...' : label}</button>
}
