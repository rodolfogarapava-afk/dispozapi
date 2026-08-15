'use client'

import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  Bot, ChevronLeft, LayoutDashboard, LogOut, Megaphone, MessageSquare,
  Search, Settings, Smartphone, Sparkles, Users, Users2, X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/store/auth.store'
import { useUiStore } from '@/store/ui.store'

const navSections = [
  {
    label: 'Principal',
    items: [
      { href: '/dashboard', label: 'Painel', icon: LayoutDashboard },
      { href: '/instances', label: 'Instâncias', icon: Smartphone },
      { href: '/whatsapp', label: 'Conversas', icon: MessageSquare },
      { href: '/contacts', label: 'Contatos', icon: Users },
      { href: '/campaigns', label: 'Campanhas', icon: Megaphone },
      { href: '/groups', label: 'Grupos', icon: Search },
    ],
  },
  {
    label: 'Automação',
    items: [{ href: '/chatbot', label: 'Fluxos', icon: Bot }],
  },
  {
    label: 'Gestão',
    items: [
      { href: '/team', label: 'Atendentes', icon: Users2 },
      { href: '/settings', label: 'Configurações', icon: Settings },
    ],
  },
]

const PLAN_LABELS: Record<string, string> = {
  FREE: 'Gratuito',
  BASIC: 'Básico',
  PRO: 'Pro',
  ENTERPRISE: 'Enterprise',
}

export function Sidebar() {
  const pathname = usePathname()
  const { user, logout } = useAuthStore()
  const { sidebarOpen, sidebarCollapsed, setSidebarOpen, toggleSidebarCollapsed } = useUiStore()
  const plan = user?.organization?.plan || 'PRO'

  const renderContent = (collapsed: boolean, mobile = false) => (
    <>
      <div className={cn('relative flex h-[76px] items-center border-b border-border transition-all', collapsed ? 'justify-center px-2' : 'gap-2.5 px-5')}>
        <Image src="/logo.png" alt="ZapShark" width={38} height={38} priority className="h-9 w-9 shrink-0 object-contain" />
        {!collapsed ? (
          <div className="min-w-0">
            <p className="truncate text-sm font-bold tracking-tight text-foreground">ZapShark</p>
            <p className="truncate text-[9px] font-semibold tracking-[0.12em] text-primary">MULTI-ATENDIMENTO</p>
          </div>
        ) : null}

        {mobile ? (
          <button type="button" onClick={() => setSidebarOpen(false)} className="ml-auto rounded-lg p-1.5 text-muted-foreground transition hover:bg-accent hover:text-foreground" aria-label="Fechar menu">
            <X className="h-4 w-4" />
          </button>
        ) : (
          <button
            type="button"
            onClick={toggleSidebarCollapsed}
            className="absolute -right-3 top-6 z-10 flex h-6 w-6 items-center justify-center rounded-full border border-border bg-[hsl(var(--surface-1))] text-muted-foreground shadow-md transition hover:border-primary/40 hover:text-primary"
            aria-label={collapsed ? 'Expandir menu' : 'Recolher menu'}
            title={collapsed ? 'Expandir menu' : 'Recolher menu'}
          >
            <ChevronLeft className={cn('h-3.5 w-3.5 transition-transform', collapsed && 'rotate-180')} />
          </button>
        )}
      </div>

      <nav className={cn('flex-1 overflow-y-auto py-4', collapsed ? 'px-2' : 'px-3')} aria-label="Navegação principal">
        {navSections.map((section, sectionIndex) => (
          <div key={section.label} className={cn(sectionIndex > 0 && (collapsed ? 'mt-3 border-t border-border pt-3' : 'mt-5'))}>
            {!collapsed ? <p className="mb-1.5 px-3 text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground/65">{section.label}</p> : null}
            <div className="space-y-1">
              {section.items.map(({ href, label, icon: Icon }) => {
                const active = pathname === href || pathname.startsWith(`${href}/`)
                return (
                  <Link
                    key={href}
                    href={href}
                    onClick={() => setSidebarOpen(false)}
                    aria-current={active ? 'page' : undefined}
                    title={collapsed ? label : undefined}
                    className={cn(
                      'group relative flex min-h-10 items-center rounded-xl border text-sm font-medium transition-all duration-150',
                      collapsed ? 'justify-center px-2' : 'gap-3 px-3',
                      active
                        ? 'border-primary/30 bg-gradient-to-r from-primary/20 via-primary/10 to-violet-500/10 text-primary shadow-[inset_3px_0_0_hsl(var(--primary))]'
                        : 'border-transparent text-muted-foreground hover:border-border/70 hover:bg-accent/70 hover:text-foreground',
                    )}
                  >
                    <Icon className={cn('h-4 w-4 shrink-0 transition-transform group-hover:scale-105', active && 'drop-shadow-[0_0_6px_hsl(var(--primary))]')} />
                    {!collapsed ? <span className="truncate">{label}</span> : null}
                  </Link>
                )
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className={cn('border-t border-border py-3', collapsed ? 'px-2' : 'px-3')}>
        {!collapsed ? (
          <div className="mb-2 overflow-hidden rounded-xl border border-violet-500/20 bg-gradient-to-br from-violet-500/15 via-primary/10 to-transparent p-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-violet-300">Plano {PLAN_LABELS[plan] || plan}</p>
                <p className="mt-1 text-[11px] text-muted-foreground">Recursos da conta ativos</p>
              </div>
              <Sparkles className="h-4 w-4 text-violet-300" />
            </div>
          </div>
        ) : null}

        <div className={cn('flex items-center rounded-xl border border-primary/15 bg-primary/[0.04] py-2', collapsed ? 'justify-center px-1' : 'gap-2.5 px-3')} title={collapsed ? user?.name || 'Usuário' : undefined}>
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary to-blue-500 text-xs font-bold text-white">
            {user?.name?.[0]?.toUpperCase() || 'U'}
          </div>
          {!collapsed ? (
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-semibold text-foreground">{user?.name || 'Usuário'}</p>
              <p className="truncate text-[10px] text-primary">{user?.organization?.name || 'Conta ativa'}</p>
            </div>
          ) : null}
        </div>
        <button type="button" onClick={logout} className={cn('mt-1 flex min-h-9 w-full items-center rounded-lg text-sm text-muted-foreground transition hover:bg-accent hover:text-foreground', collapsed ? 'justify-center px-2' : 'gap-2.5 px-3')} aria-label="Sair" title={collapsed ? 'Sair' : undefined}>
          <LogOut className="h-4 w-4" />
          {!collapsed ? 'Sair' : null}
        </button>
      </div>
    </>
  )

  return (
    <>
      <aside className={cn('hidden min-h-screen shrink-0 flex-col border-r border-border bg-[hsl(var(--surface-2))] shadow-[14px_0_40px_-36px_rgba(0,0,0,.95)] transition-[width] duration-200 lg:flex', sidebarCollapsed ? 'w-[76px]' : 'w-60')}>
        {renderContent(sidebarCollapsed)}
      </aside>

      <div className={cn('fixed inset-0 z-40 bg-black/50 transition-opacity lg:hidden', sidebarOpen ? 'opacity-100' : 'pointer-events-none opacity-0')} onClick={() => setSidebarOpen(false)} />
      <aside className={cn('fixed left-0 top-0 z-50 flex h-full w-64 flex-col border-r border-border bg-[hsl(var(--surface-2))] transition-transform duration-200 lg:hidden', sidebarOpen ? 'translate-x-0' : '-translate-x-full')}>
        {renderContent(false, true)}
      </aside>
    </>
  )
}
