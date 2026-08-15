'use client'
import { useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'
import { Loader2, ShieldCheck, LayoutDashboard, Building2, TrendingUp, ArrowLeft, LogOut } from 'lucide-react'
import { useAuthStore } from '@/store/auth.store'
import { cn } from '@/lib/utils'
import { getAdminBasePath } from '@/lib/admin-route'

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const { token, user, hydrated, fetchMe } = useAuthStore()
  const basePath = getAdminBasePath(pathname)
  const loginPath = `${basePath}/login`
  const adminNav = [
    { href: basePath, label: 'Visão Geral', icon: LayoutDashboard },
    { href: `${basePath}/clientes`, label: 'Clientes', icon: Building2 },
    { href: `${basePath}/crescimento`, label: 'Crescimento', icon: TrendingUp },
  ]

  // A própria tela de login não passa pelo gate — senão ninguém conseguiria entrar.
  const isLoginPage = pathname === loginPath

  useEffect(() => {
    if (isLoginPage || !hydrated) return
    if (!token) { router.push(loginPath); return }
    if (!user) { fetchMe(); return }
    if (user && !user.isSuperAdmin) router.push(loginPath)
  }, [isLoginPage, hydrated, token, user, loginPath, fetchMe, router])

  if (isLoginPage) return <>{children}</>

  if (!hydrated || !token || !user || !user.isSuperAdmin) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <Loader2 className="w-6 h-6 animate-spin" style={{ color: '#00AEEF' }} />
      </div>
    )
  }

  const logoutAdmin = () => {
    localStorage.removeItem('crm_token')
    useAuthStore.setState({ user: null, token: null })
    router.push(loginPath)
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <aside className="hidden lg:flex flex-col w-56 min-h-screen border-r border-border flex-shrink-0" style={{ background: 'hsl(var(--surface-2))' }}>
        <div className="flex items-center gap-2.5 px-5 py-5 border-b border-border">
          <ShieldCheck className="w-7 h-7 flex-shrink-0" style={{ color: '#00AEEF' }} />
          <div>
            <p className="text-sm font-bold text-foreground tracking-tight">Plataforma</p>
            <p className="text-[9px] font-medium tracking-widest" style={{ color: '#00AEEF' }}>ADMIN</p>
          </div>
        </div>
        <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
          {adminNav.map(({ href, label, icon: Icon }) => {
            const active = href === basePath ? pathname === basePath : pathname.startsWith(href)
            return (
              <Link key={href} href={href}
                className={cn('flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-150',
                  active ? 'text-white' : 'text-muted-foreground hover:text-foreground hover:bg-accent')}
                style={active ? { background: '#00AEEF18', color: '#00AEEF', boxShadow: 'inset 0 0 0 1px #00AEEF25' } : {}}
              >
                <Icon className="w-4 h-4 flex-shrink-0" />
                <span>{label}</span>
              </Link>
            )
          })}
        </nav>
        <div className="px-3 py-4 border-t border-border space-y-1">
          <div className="flex items-center gap-2.5 px-3 py-2 rounded-lg mb-1" style={{ background: '#00AEEF08', border: '1px solid #00AEEF15' }}>
            <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0" style={{ background: 'linear-gradient(135deg, #00AEEF, #0A84FF)' }}>
              {user?.name?.[0]?.toUpperCase() || 'A'}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-foreground truncate">{user?.name || 'Admin'}</p>
              <p className="text-[10px] truncate" style={{ color: '#00AEEF' }}>Super-admin</p>
            </div>
          </div>
          <Link href="/dashboard" className="flex items-center gap-2.5 px-3 py-2 w-full rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-all">
            <ArrowLeft className="w-4 h-4" />
            Ir para o app
          </Link>
          <button onClick={logoutAdmin} className="flex items-center gap-2.5 px-3 py-2 w-full rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-all">
            <LogOut className="w-4 h-4" />
            Sair do painel
          </button>
        </div>
      </aside>
      <div className="flex flex-col flex-1 overflow-hidden min-w-0">
        <main className="flex-1 overflow-auto p-3 sm:p-5">{children}</main>
      </div>
    </div>
  )
}
