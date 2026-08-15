'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { useAuthStore } from '@/store/auth.store'
import { Sidebar } from '@/components/layout/sidebar'
import { Header } from '@/components/layout/header'
import { wsClient } from '@/lib/ws'

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const { token, hydrated, fetchMe } = useAuthStore()

  // Só decide a rota DEPOIS que o persist reidratou do localStorage.
  useEffect(() => {
    if (!hydrated) return
    if (!token) { router.push('/auth/login'); return }
    fetchMe()
  }, [hydrated, token])

  useEffect(() => {
    if (!hydrated || !token) return
    const base = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'
    const wsUrl = base.replace(/^http/, 'ws') + `/ws?token=${token}`
    wsClient.connect(wsUrl)
    return () => wsClient.disconnect()
  }, [hydrated, token])

  // Enquanto não hidratou (ou está redirecionando), mostra um loader — nunca
  // redireciona antes de saber se há token salvo.
  if (!hydrated || !token) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    )
  }

  return (
    <div className="app-shell flex h-screen overflow-hidden bg-background">
      <Sidebar />
      <div className="flex flex-col flex-1 overflow-hidden min-w-0">
        <Header />
        <main className="app-main flex-1 overflow-auto p-3 sm:p-5">
          {children}
        </main>
      </div>
    </div>
  )
}
