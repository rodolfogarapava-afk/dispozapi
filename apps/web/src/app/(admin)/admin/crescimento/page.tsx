'use client'
import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { formatCurrency } from '@/lib/utils'
import { Loader2 } from 'lucide-react'

interface GrowthPoint { label: string; newOrgs: number; mrr: number }

export default function AdminGrowthPage() {
  const [growth, setGrowth] = useState<GrowthPoint[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.get('/admin/growth')
      .then((r) => setGrowth(r.data))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const maxOrgs = Math.max(1, ...growth.map((g) => g.newOrgs))
  const maxMrr = Math.max(1, ...growth.map((g) => g.mrr))

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-white">Crescimento</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Novos clientes e MRR ao longo do tempo</p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64"><Loader2 className="w-6 h-6 animate-spin" style={{ color: '#00AEEF' }} /></div>
      ) : (
        <>
          <Chart title="Novos clientes por mês" data={growth} max={maxOrgs} pick={(g) => g.newOrgs}
            fmt={(v) => `${v}`} color="#00AEEF" />
          <Chart title="MRR por mês (estimado)" data={growth} max={maxMrr} pick={(g) => g.mrr}
            fmt={(v) => formatCurrency(v)} color="#10B981" />
        </>
      )}
    </div>
  )
}

function Chart({ title, data, max, pick, fmt, color }: {
  title: string; data: GrowthPoint[]; max: number; pick: (g: GrowthPoint) => number; fmt: (v: number) => string; color: string
}) {
  return (
    <div className="rounded-xl p-4 border border-border" style={{ background: 'hsl(220 28% 10%)' }}>
      <h2 className="text-sm font-semibold text-white mb-4">{title}</h2>
      <div className="flex items-end gap-2 h-48">
        {data.map((g, i) => (
          <div key={i} className="flex-1 flex flex-col items-center gap-1" title={fmt(pick(g))}>
            <div className="w-full rounded-t-sm" style={{ height: `${Math.max(2, (pick(g) / max) * 100)}%`, background: color, opacity: 0.85 }} />
            <span className="text-[9px] text-muted-foreground">{g.label}</span>
          </div>
        ))}
        {!data.length && <p className="text-xs text-muted-foreground m-auto">Sem dados</p>}
      </div>
    </div>
  )
}
