'use client'
import { useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { Search, Bell, ArrowLeft, Menu } from 'lucide-react'
import { useAuthStore } from '@/store/auth.store'
import { useUiStore } from '@/store/ui.store'
import { ThemeToggle } from './theme-toggle'

const PAGE_TITLES: Record<string, string> = {
  '/dashboard': 'Painel',
  '/instances': 'Instâncias',
  '/whatsapp': 'Conversas',
  '/contacts': 'Contatos',
  '/campaigns': 'Campanhas',
  '/groups': 'Grupos',
  '/chatbot': 'Fluxos',
  '/team': 'Atendentes',
  '/settings': 'Configurações',
}

export function Header() {
  const { user } = useAuthStore()
  const { toggleSidebar } = useUiStore()
  const pathname = usePathname()
  const router = useRouter()
  const [search, setSearch] = useState('')

  const isDashboard = pathname === '/dashboard' || pathname === '/'
  const currentTitle = PAGE_TITLES[pathname] || Object.entries(PAGE_TITLES).find(([k]) => pathname.startsWith(k + '/'))?.[1]

  return (
    <header className="h-14 flex items-center justify-between px-3 sm:px-6 border-b border-border/90 flex-shrink-0 shadow-[0_10px_30px_-26px_rgba(0,0,0,.9)]" style={{ background: 'hsl(var(--surface-1) / .92)', backdropFilter: 'blur(16px)' }}>
      <div className="flex items-center gap-2 sm:gap-3 min-w-0">
        {/* Hamburguer (mobile) */}
        <button
          onClick={toggleSidebar}
          className="p-1.5 rounded-lg hover:bg-accent transition text-muted-foreground hover:text-foreground lg:hidden"
          aria-label="Abrir menu"
        >
          <Menu className="w-5 h-5" />
        </button>
        {!isDashboard && (
          <button
            onClick={() => router.push('/dashboard')}
            className="p-1.5 rounded-lg hover:bg-accent transition flex items-center gap-1.5 text-muted-foreground hover:text-foreground"
            title="Voltar ao painel"
          >
            <ArrowLeft className="w-4 h-4" />
            <span className="text-xs font-medium hidden sm:inline">Painel</span>
          </button>
        )}
        {currentTitle && !isDashboard && (
          <>
            <span className="text-muted-foreground/40 text-xs">/</span>
            <span className="text-sm font-semibold text-foreground">{currentTitle}</span>
          </>
        )}
        <div className="hidden md:flex items-center gap-2 rounded-xl px-3 py-2 w-64 border border-border ml-2 transition focus-within:border-primary/40 focus-within:ring-2 focus-within:ring-primary/10" style={{ background: 'hsl(var(--surface-sunken))' }}>
          <Search className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar conversas, contatos..." className="bg-transparent text-sm outline-none flex-1 text-foreground placeholder:text-muted-foreground" />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <ThemeToggle />
        <button className="relative p-2 rounded-lg hover:bg-accent transition">
          <Bell className="w-4 h-4 text-muted-foreground" />
          <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full" style={{ background: '#00AEEF', boxShadow: '0 0 6px #00AEEF' }} />
        </button>
        <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white ml-1" style={{ background: 'linear-gradient(135deg, #00AEEF, #0A84FF)', boxShadow: '0 0 10px #00AEEF35' }}>
          {user?.name?.[0]?.toUpperCase() || 'U'}
        </div>
      </div>
    </header>
  )
}
