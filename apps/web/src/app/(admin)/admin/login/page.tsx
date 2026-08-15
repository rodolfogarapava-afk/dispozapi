'use client'
import { useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { ShieldCheck, Loader2 } from 'lucide-react'
import { useAuthStore } from '@/store/auth.store'
import { api } from '@/lib/api'
import { getAdminBasePath } from '@/lib/admin-route'

// Login isolado da plataforma. Só super-admin entra; usuário comum é barrado
// aqui mesmo (sem cair no app do cliente).
export default function AdminLoginPage() {
  const router = useRouter()
  const pathname = usePathname()
  const { login } = useAuthStore()
  const [form, setForm] = useState({ email: '', password: '' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await login(form.email, form.password)
      // Confirma super-admin pelo /me (fonte da verdade no servidor).
      const { data } = await api.get('/auth/me')
      if (!data?.isSuperAdmin) {
        setError('Esta conta não tem acesso ao painel de administração.')
        setLoading(false)
        return
      }
      router.push(getAdminBasePath(pathname))
    } catch (err: any) {
      setError(err?.message || 'Email ou senha inválidos')
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: 'hsl(var(--surface-0))' }}>
      <div className="w-full max-w-md">
        <div className="flex items-center justify-center gap-3 mb-8">
          <ShieldCheck className="w-12 h-12" style={{ color: '#00AEEF', filter: 'drop-shadow(0 0 20px #00AEEF50)' }} />
          <div>
            <span className="text-2xl font-bold text-white tracking-tight">Plataforma</span>
            <p className="text-[10px] font-medium tracking-widest" style={{ color: '#00AEEF' }}>PAINEL ADMIN</p>
          </div>
        </div>

        <div className="rounded-2xl p-8 border border-border" style={{ background: 'hsl(var(--surface-1))' }}>
          <h1 className="text-xl font-semibold text-white mb-1">Acesso restrito</h1>
          <p className="text-sm text-muted-foreground mb-6">Entre com sua conta de administrador da plataforma</p>

          {error && (
            <div className="mb-4 p-3 rounded-xl text-sm border" style={{ background: '#EF444415', borderColor: '#EF444430', color: '#F87171' }}>
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="text-sm font-medium text-muted-foreground block mb-1.5">Email</label>
              <input type="email" required value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                placeholder="admin@email.com"
                className="w-full px-3 py-2.5 rounded-xl border border-border text-sm text-white outline-none transition focus:border-primary/60"
                style={{ background: 'hsl(var(--surface-sunken))' }} />
            </div>
            <div>
              <label className="text-sm font-medium text-muted-foreground block mb-1.5">Senha</label>
              <input type="password" required value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                placeholder="••••••••"
                className="w-full px-3 py-2.5 rounded-xl border border-border text-sm text-white outline-none transition focus:border-primary/60"
                style={{ background: 'hsl(var(--surface-sunken))' }} />
            </div>
            <button type="submit" disabled={loading}
              className="w-full py-3 rounded-xl text-sm font-semibold text-white transition disabled:opacity-50 flex items-center justify-center gap-2"
              style={{ background: 'linear-gradient(135deg, #00AEEF, #0A84FF)', boxShadow: loading ? 'none' : '0 0 20px #00AEEF35' }}>
              {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Entrando...</> : 'Entrar no painel'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
