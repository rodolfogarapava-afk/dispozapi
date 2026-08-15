'use client'
import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { formatCurrency } from '@/lib/utils'
import { Building2, CheckCircle, Clock, AlertTriangle, DollarSign, UserPlus, Loader2, Users, MessageSquare, Wifi } from 'lucide-react'

interface Overview {
  orgs: { total: number; active: number; trial: number; suspended: number; pastDue: number; expiringTrials: number; newLast30d: number }
  mrr: number
  platform: { users: number; contacts: number; messages: number; connectedInstances: number }
}
interface GrowthPoint { label: string; newOrgs: number; mrr: number }

export default function AdminOverviewPage() {
  const [data, setData] = useState<Overview | null>(null)
  const [growth, setGrowth] = useState<GrowthPoint[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([api.get('/admin/overview'), api.get('/admin/growth')])
      .then(([o, g]) => { setData(o.data); setGrowth(g.data) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const maxBar = Math.max(1, ...growth.map((g) => g.newOrgs))

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-white">Visão Geral da Plataforma</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Monitoramento de todos os clientes, assinaturas e trials</p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64"><Loader2 className="w-6 h-6 animate-spin" style={{ color: '#00AEEF' }} /></div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <Card icon={CheckCircle} color="#10B981" label="Clientes ativos" value={String(data?.orgs.active ?? 0)} sub={`${data?.orgs.total ?? 0} no total`} />
            <Card icon={Clock} color="#00AEEF" label="Em teste" value={String(data?.orgs.trial ?? 0)} sub={`${data?.orgs.expiringTrials ?? 0} expiram em 3 dias`} />
            <Card icon={UserPlus} color="#8B5CF6" label="Novas assinaturas" value={String(data?.orgs.newLast30d ?? 0)} sub="últimos 30 dias" />
            <Card icon={DollarSign} color="#F59E0B" label="MRR" value={formatCurrency(data?.mrr ?? 0)} sub="receita recorrente" />
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <Card icon={AlertTriangle} color="#EF4444" label="Suspensos" value={String(data?.orgs.suspended ?? 0)} sub={`${data?.orgs.pastDue ?? 0} em atraso`} />
            <Card icon={Users} color="#00AEEF" label="Usuários" value={String(data?.platform.users ?? 0)} sub="na plataforma" />
            <Card icon={Building2} color="#10B981" label="Contatos" value={String(data?.platform.contacts ?? 0)} sub="total geral" />
            <Card icon={MessageSquare} color="#8B5CF6" label="Mensagens" value={String(data?.platform.messages ?? 0)} sub={`${data?.platform.connectedInstances ?? 0} WhatsApp on`} />
          </div>

          <div className="rounded-xl p-4 border border-border" style={{ background: 'hsl(220 28% 10%)' }}>
            <h2 className="text-sm font-semibold text-white mb-4">Novos clientes por mês</h2>
            <div className="flex items-end gap-2 h-40">
              {growth.map((g, i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-1" title={`${g.newOrgs} clientes · ${formatCurrency(g.mrr)} MRR`}>
                  <div className="w-full rounded-t-sm" style={{ height: `${Math.max(2, (g.newOrgs / maxBar) * 100)}%`, background: 'linear-gradient(0deg, #00AEEF, #38BDF8)', opacity: 0.85 }} />
                  <span className="text-[9px] text-muted-foreground">{g.label}</span>
                </div>
              ))}
              {!growth.length && <p className="text-xs text-muted-foreground m-auto">Sem dados</p>}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function Card({ icon: Icon, color, label, value, sub }: { icon: any; color: string; label: string; value: string; sub: string }) {
  return (
    <div className="relative overflow-hidden rounded-xl p-4 border border-border" style={{ background: 'hsl(220 28% 10%)' }}>
      <div className="absolute top-0 left-0 right-0 h-0.5" style={{ background: `linear-gradient(90deg, ${color}, transparent)` }} />
      <div className="flex items-start justify-between mb-3">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</span>
        <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: color + '18' }}>
          <Icon className="w-4 h-4" style={{ color }} />
        </div>
      </div>
      <p className="text-2xl font-bold text-white mb-0.5">{value}</p>
      <p className="text-[10px] text-muted-foreground">{sub}</p>
    </div>
  )
}
