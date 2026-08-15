'use client'
import { useTheme } from 'next-themes'
import { useEffect, useState } from 'react'
import { Moon, Sun } from 'lucide-react'

export function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  // next-themes só resolve o tema no client; evita mismatch de hidratação.
  useEffect(() => setMounted(true), [])

  const isDark = !mounted || theme !== 'light'

  return (
    <button
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      className="p-2 rounded-lg hover:bg-accent transition text-muted-foreground hover:text-foreground"
      title={isDark ? 'Modo claro' : 'Modo escuro'}
      aria-label="Alternar tema"
    >
      {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
    </button>
  )
}
