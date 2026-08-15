'use client'
import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { formatCurrency, formatDate } from '@/lib/utils'
import { DollarSign, CheckCircle, Clock, Loader2 } from 'lucide-react'

interface Summary {
  salesRevenue: number
  salesCount: number
  invoicesPaid: { amount: number; count: number }
  invoicesPending: { amount: number; count: number }
}
interface Invoice { id: string; plan: string; amount: number; status: string; dueAt: string; paidAt: string | null; createdAt: string }
interface RevenuePoint { label: string; value: number }

const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  PAID: { label: 'Pago', color: '#10B981' },
  PENDING: { label: 'Pendente', color: '#F59E0B' },
  FAILED: { label: 'Falhou', color: '#EF4444' },
  CANCELLED: { label: 'Cancelado', color: '#64748b' },
}

export default function FinancialPage() {
  const [summary, setSummary] = useState<Summary | null>(null)
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [revenue, setRevenue] = useState<RevenuePoint[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      api.get('/financial/summary'),
      api.get('/financial/invoices'),
      api.get('/financial/revenue'),
    ])
      .then(([s, inv, rev]) => { setSummary(s.data); setInvoices(inv.data); setRevenue(rev.data) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const maxBar = Math.max(1, ...revenue.map((r) => r.value))

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-foreground">Financeiro</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Receita das vendas e faturas</p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64"><Loader2 className="w-6 h-6 animate-spin" style={{ color: '#00AEEF' }} /></div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Card icon={DollarSign} color="#10B981" label="Receita de vendas"
              value={formatCurrency(summary?.salesRevenue || 0)} sub={`${summary?.salesCount || 0} vendas ganhas`} />
            <Card icon={CheckCircle} color="#00AEEF" label="Faturas pagas"
              value={formatCurrency(summary?.invoicesPaid.amount || 0)} sub={`${summary?.invoicesPaid.count || 0} faturas`} />
            <Card icon={Clock} color="#F59E0B" label="Faturas pendentes"
              value={formatCurrency(summary?.invoicesPending.amount || 0)} sub={`${summary?.invoicesPending.count || 0} faturas`} />
          </div>

          {/* Receita por mês */}
          <div className="rounded-xl p-4 border border-border" style={{ background: 'hsl(var(--surface-1))' }}>
            <h2 className="text-sm font-semibold text-foreground mb-4">Entradas por mês</h2>
            <div className="flex items-end gap-2 h-40">
              {revenue.map((r, i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-1" title={formatCurrency(r.value)}>
                  <div className="w-full rounded-t-sm" style={{ height: `${Math.max(2, (r.value / maxBar) * 100)}%`, background: 'linear-gradient(0deg, #10B981, #34D399)', opacity: 0.85 }} />
                  <span className="text-[9px] text-muted-foreground">{r.label}</span>
                </div>
              ))}
              {!revenue.length && <p className="text-xs text-muted-foreground m-auto">Sem dados</p>}
            </div>
          </div>

          {/* Faturas */}
          <div className="rounded-xl border border-border overflow-hidden" style={{ background: 'hsl(var(--surface-1))' }}>
            <h2 className="text-sm font-semibold text-foreground p-4 pb-3">Faturas</h2>
            {invoices.length === 0 ? (
              <p className="text-xs text-muted-foreground px-4 pb-6">Nenhuma fatura registrada.</p>
            ) : (
              <div className="divide-y divide-border">
                {invoices.map((inv) => {
                  const st = STATUS_LABEL[inv.status] || STATUS_LABEL.PENDING
                  return (
                    <div key={inv.id} className="flex items-center justify-between px-4 py-3">
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-foreground">{inv.plan}</p>
                        <p className="text-[10px] text-muted-foreground">Venc. {formatDate(inv.dueAt)}</p>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: st.color + '25', color: st.color }}>{st.label}</span>
                        <span className="text-xs font-bold text-foreground w-24 text-right">{formatCurrency(inv.amount)}</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function Card({ icon: Icon, color, label, value, sub }: { icon: any; color: string; label: string; value: string; sub: string }) {
  return (
    <div className="relative overflow-hidden rounded-xl p-4 border border-border" style={{ background: 'hsl(var(--surface-1))' }}>
      <div className="absolute top-0 left-0 right-0 h-0.5" style={{ background: `linear-gradient(90deg, ${color}, transparent)` }} />
      <div className="flex items-start justify-between mb-3">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</span>
        <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: color + '18' }}>
          <Icon className="w-4 h-4" style={{ color }} />
        </div>
      </div>
      <p className="text-2xl font-bold text-foreground mb-0.5">{value}</p>
      <p className="text-[10px] text-muted-foreground">{sub}</p>
    </div>
  )
}
