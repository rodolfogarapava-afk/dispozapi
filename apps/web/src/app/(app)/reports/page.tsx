'use client'
import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { formatCurrency } from '@/lib/utils'
import { TrendingUp, Target, Award, Loader2 } from 'lucide-react'

interface Sales { count: number; total: number; avg: number; series: { date: string; value: number }[] }
interface FunnelRow { stage: string; color: string; count: number }
interface Agent { name: string; avatar: string | null; count: number; total: number }

const PERIODS = [
  { label: '7 dias', days: 7 },
  { label: '30 dias', days: 30 },
  { label: '90 dias', days: 90 },
]

export default function ReportsPage() {
  const [days, setDays] = useState(30)
  const [sales, setSales] = useState<Sales | null>(null)
  const [funnel, setFunnel] = useState<FunnelRow[]>([])
  const [agents, setAgents] = useState<Agent[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    const to = new Date()
    const from = new Date(to.getTime() - days * 86400000)
    const params = { from: from.toISOString(), to: to.toISOString() }
    Promise.all([
      api.get('/reports/sales', { params }),
      api.get('/reports/funnel'),
      api.get('/reports/agents', { params }),
    ])
      .then(([s, f, a]) => { setSales(s.data); setFunnel(f.data); setAgents(a.data) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [days])

  const maxBar = Math.max(1, ...(sales?.series.map((s) => s.value) || [1]))
  const maxFunnel = Math.max(1, ...funnel.map((f) => f.count))

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-foreground">Relatórios</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Desempenho de vendas e atendimento</p>
        </div>
        <div className="flex gap-2">
          {PERIODS.map((p) => (
            <button
              key={p.days}
              onClick={() => setDays(p.days)}
              className="px-3 py-1.5 text-xs rounded-lg border transition"
              style={days === p.days
                ? { background: '#00AEEF18', border: '1px solid #00AEEF35', color: '#00AEEF' }
                : { borderColor: 'hsl(var(--border))', color: 'hsl(var(--muted-foreground))' }}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64"><Loader2 className="w-6 h-6 animate-spin" style={{ color: '#00AEEF' }} /></div>
      ) : (
        <>
          {/* Cards de vendas */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Card icon={Award} color="#10B981" label="Vendas no período" value={String(sales?.count || 0)} />
            <Card icon={TrendingUp} color="#00AEEF" label="Receita" value={formatCurrency(sales?.total || 0)} />
            <Card icon={Target} color="#8B5CF6" label="Ticket médio" value={formatCurrency(sales?.avg || 0)} />
          </div>

          {/* Série de vendas */}
          <div className="rounded-xl p-4 border border-border" style={{ background: 'hsl(var(--surface-1))' }}>
            <h2 className="text-sm font-semibold text-foreground mb-4">Vendas por dia</h2>
            <div className="flex items-end gap-1 h-40">
              {(sales?.series || []).map((s, i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-1 min-w-0" title={`${s.date}: ${formatCurrency(s.value)}`}>
                  <div className="w-full rounded-t-sm" style={{ height: `${Math.max(2, (s.value / maxBar) * 100)}%`, background: 'linear-gradient(0deg, #10B981, #34D399)', opacity: 0.85 }} />
                </div>
              ))}
              {!sales?.series.length && <p className="text-xs text-muted-foreground m-auto">Sem vendas no período</p>}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Funil */}
            <div className="rounded-xl p-4 border border-border" style={{ background: 'hsl(var(--surface-1))' }}>
              <h2 className="text-sm font-semibold text-foreground mb-4">Funil de conversão</h2>
              <div className="space-y-2.5">
                {funnel.map((f) => (
                  <div key={f.stage}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs text-foreground">{f.stage}</span>
                      <span className="text-xs font-bold" style={{ color: f.color }}>{f.count}</span>
                    </div>
                    <div className="h-2 rounded-full overflow-hidden" style={{ background: '#1E2D3D' }}>
                      <div className="h-full rounded-full" style={{ width: `${(f.count / maxFunnel) * 100}%`, background: f.color }} />
                    </div>
                  </div>
                ))}
                {!funnel.length && <p className="text-xs text-muted-foreground">Sem pipeline configurada</p>}
              </div>
            </div>

            {/* Ranking de atendentes */}
            <div className="rounded-xl p-4 border border-border" style={{ background: 'hsl(var(--surface-1))' }}>
              <h2 className="text-sm font-semibold text-foreground mb-4">Ranking de atendentes</h2>
              <div className="space-y-3">
                {agents.map((a, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <div className="w-6 text-center text-xs font-bold text-muted-foreground">{i + 1}º</div>
                    <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0" style={{ background: 'linear-gradient(135deg, #00AEEF, #0A84FF)' }}>
                      {a.name?.[0]?.toUpperCase() || '?'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-foreground truncate">{a.name}</p>
                      <p className="text-[10px] text-muted-foreground">{a.count} {a.count === 1 ? 'venda' : 'vendas'}</p>
                    </div>
                    <span className="text-xs font-bold" style={{ color: '#10B981' }}>{formatCurrency(a.total)}</span>
                  </div>
                ))}
                {!agents.length && <p className="text-xs text-muted-foreground">Nenhuma venda atribuída no período</p>}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function Card({ icon: Icon, color, label, value }: { icon: any; color: string; label: string; value: string }) {
  return (
    <div className="relative overflow-hidden rounded-xl p-4 border border-border" style={{ background: 'hsl(var(--surface-1))' }}>
      <div className="absolute top-0 left-0 right-0 h-0.5" style={{ background: `linear-gradient(90deg, ${color}, transparent)` }} />
      <div className="flex items-start justify-between mb-3">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</span>
        <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: color + '18' }}>
          <Icon className="w-4 h-4" style={{ color }} />
        </div>
      </div>
      <p className="text-2xl font-bold text-foreground">{value}</p>
    </div>
  )
}
