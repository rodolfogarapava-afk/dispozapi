'use client'

import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface DarkSelectOption {
  value: string
  label: string
  description?: string
  disabled?: boolean
}

export function DarkSelect({
  id,
  ariaLabel,
  value,
  options,
  onChange,
  placeholder = 'Selecione uma opção',
  disabled = false,
  className,
}: {
  id?: string
  ariaLabel: string
  value: string
  options: DarkSelectOption[]
  onChange: (value: string) => void
  placeholder?: string
  disabled?: boolean
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const selected = options.find((option) => option.value === value)

  useEffect(() => {
    if (!open) return
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', closeOnOutsideClick)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <button
        id={id}
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled || !options.length}
        onClick={() => setOpen((current) => !current)}
        className="flex w-full items-center gap-2.5 rounded-xl border border-border bg-[hsl(var(--surface-2))] px-3 py-2.5 text-left transition hover:border-primary/30 focus:outline-none focus:ring-2 focus:ring-primary/10 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span className="min-w-0 flex-1">
          <span className={cn('block truncate text-sm font-semibold', selected ? 'text-foreground' : 'text-muted-foreground')}>{selected?.label || placeholder}</span>
          {selected?.description ? <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">{selected.description}</span> : null}
        </span>
        <ChevronDown className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')} />
      </button>

      {open ? (
        <div role="listbox" aria-label={`${ariaLabel}: opções`} className="absolute left-0 right-0 top-full z-[70] mt-2 max-h-60 overflow-y-auto rounded-xl border border-border bg-[hsl(var(--surface-1))] p-1.5 shadow-[0_20px_50px_-16px_rgba(0,0,0,.95)]">
          {options.map((option) => {
            const active = option.value === value
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={active}
                disabled={option.disabled}
                onClick={() => {
                  onChange(option.value)
                  setOpen(false)
                }}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left transition',
                  active ? 'border-primary/25 bg-primary/10' : 'border-transparent hover:bg-accent/70',
                  option.disabled && 'cursor-not-allowed opacity-45',
                )}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-semibold text-foreground">{option.label}</span>
                  {option.description ? <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">{option.description}</span> : null}
                </span>
                {active ? <Check className="h-4 w-4 shrink-0 text-primary" /> : null}
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
