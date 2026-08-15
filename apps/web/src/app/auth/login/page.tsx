'use client'
import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useAuthStore } from '@/store/auth.store'

export default function LoginPage() {
  const router = useRouter()
  const { login, isLoading } = useAuthStore()
  const [form, setForm] = useState({ email: '', password: '' })
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    try {
      await login(form.email, form.password)
      router.push('/dashboard')
    } catch (err: any) {
      setError(err?.message || 'Email ou senha inválidos')
    }
  }

  return (
    <div className="rounded-2xl p-8 border border-border" style={{ background: 'hsl(var(--surface-1))' }}>
      <h1 className="text-xl font-semibold text-white mb-1">Entrar na sua conta</h1>
      <p className="text-sm text-muted-foreground mb-6">Digite seu email e senha para continuar</p>

      {error && (
        <div className="mb-4 p-3 rounded-xl text-sm border" style={{ background: '#EF444415', borderColor: '#EF444430', color: '#F87171' }}>
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="text-sm font-medium text-muted-foreground block mb-1.5">Email</label>
          <input type="email" required value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
            placeholder="seu@email.com"
            className="w-full px-3 py-2.5 rounded-xl border border-border text-sm text-white outline-none transition focus:border-primary/60"
            style={{ background: 'hsl(var(--surface-sunken))' }} />
        </div>
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-sm font-medium text-muted-foreground">Senha</label>
            <Link href="/auth/forgot-password" className="text-xs font-medium" style={{ color: '#00AEEF' }}>Esqueci a senha</Link>
          </div>
          <input type="password" required value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
            placeholder="••••••••"
            className="w-full px-3 py-2.5 rounded-xl border border-border text-sm text-white outline-none transition focus:border-primary/60"
            style={{ background: 'hsl(var(--surface-sunken))' }} />
        </div>
        <button type="submit" disabled={isLoading}
          className="w-full py-3 rounded-xl text-sm font-semibold text-white transition disabled:opacity-50"
          style={{ background: 'linear-gradient(135deg, #00AEEF, #0A84FF)', boxShadow: isLoading ? 'none' : '0 0 20px #00AEEF35' }}>
          {isLoading ? 'Entrando...' : 'Entrar'}
        </button>
      </form>

      <p className="text-center text-sm text-muted-foreground mt-6">
        O acesso é liberado pelo administrador da plataforma.
      </p>
    </div>
  )
}
