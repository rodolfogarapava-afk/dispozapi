'use client'
import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useAuthStore } from '@/store/auth.store'

export default function RegisterPage() {
  const router = useRouter()
  const { register, isLoading } = useAuthStore()
  const [form, setForm] = useState({ name: '', email: '', password: '', orgName: '' })
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    try {
      await register(form)
      router.push('/auth/login?registered=true')
    } catch (err: any) {
      setError(err?.message || 'Erro ao criar conta')
    }
  }

  return (
    <div className="rounded-2xl p-8 border border-border" style={{ background: 'hsl(var(--surface-1))' }}>
      <h1 className="text-xl font-semibold text-white mb-1">Criar conta grátis</h1>
      <p className="text-sm text-muted-foreground mb-6">14 dias grátis, sem cartão de crédito</p>

      {error && (
        <div className="mb-4 p-3 rounded-xl text-sm border" style={{ background: '#EF444415', borderColor: '#EF444430', color: '#F87171' }}>{error}</div>
      )}

      <form onSubmit={handleSubmit} className="space-y-3">
        {[
          { k: 'orgName', l: 'Nome da empresa', p: 'Minha Empresa Ltda' },
          { k: 'name', l: 'Seu nome', p: 'João Silva' },
          { k: 'email', l: 'Email', p: 'seu@email.com', t: 'email' },
          { k: 'password', l: 'Senha', p: '••••••••', t: 'password' },
        ].map(({ k, l, p, t = 'text' }) => (
          <div key={k}>
            <label className="text-sm font-medium text-muted-foreground block mb-1.5">{l}</label>
            <input type={t} required value={(form as any)[k]} onChange={e => setForm(f => ({ ...f, [k]: e.target.value }))}
              placeholder={p}
              className="w-full px-3 py-2.5 rounded-xl border border-border text-sm text-white outline-none transition focus:border-primary/60"
              style={{ background: 'hsl(var(--surface-sunken))' }} />
          </div>
        ))}
        <button type="submit" disabled={isLoading}
          className="w-full py-3 rounded-xl text-sm font-semibold text-white transition disabled:opacity-50 mt-2"
          style={{ background: 'linear-gradient(135deg, #00AEEF, #0A84FF)', boxShadow: '0 0 20px #00AEEF35' }}>
          {isLoading ? 'Criando conta...' : 'Criar conta grátis'}
        </button>
      </form>

      <p className="text-center text-sm text-muted-foreground mt-6">
        Já tem conta?{' '}
        <Link href="/auth/login" className="font-medium" style={{ color: '#00AEEF' }}>Entrar</Link>
      </p>
    </div>
  )
}
