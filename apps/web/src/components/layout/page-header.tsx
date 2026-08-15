import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface PageHeaderProps {
  eyebrow: string
  title: string
  description: string
  icon?: LucideIcon
  actions?: ReactNode
  className?: string
  tone?: 'primary' | 'emerald' | 'violet'
}

const toneClasses = {
  primary: 'text-primary',
  emerald: 'text-emerald-400',
  violet: 'text-violet-400',
}

export function PageHeader({
  eyebrow,
  title,
  description,
  icon: Icon,
  actions,
  className,
  tone = 'primary',
}: PageHeaderProps) {
  return (
    <header className={cn('app-page-header', className)}>
      <div className="min-w-0">
        <div className={cn('app-page-eyebrow', toneClasses[tone])}>
          {Icon ? <Icon className="h-3.5 w-3.5" /> : null}
          {eyebrow}
        </div>
        <h1 className="app-page-title">{title}</h1>
        <p className="app-page-description">{description}</p>
      </div>
      {actions ? <div className="app-page-actions">{actions}</div> : null}
    </header>
  )
}
