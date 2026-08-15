'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  Activity, AlertCircle, CalendarDays, CheckCheck, Eye, MessageCircle,
  RefreshCw, Send, TrendingDown, TrendingUp,
} from 'lucide-react'
import {
  Area, AreaChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from 'recharts'
import { api } from '@/lib/api'
import { PageHeader } from '@/components/layout/page-header'

interface Metric { value: number; delta: number | null }
interface MessageMetrics {
  sent: Metric
  delivered: Metric
  read: Metric
  responses: Metric
}
interface WeeklyMessagePoint {
  date: string
  label: string
  sent: number
  delivered: number
  read: number
  responses: number
}
interface Overview {
  messageMetrics?: MessageMetrics
  weeklyMessages?: WeeklyMessagePoint[]
  conversion?: { deliveryRate: number; readRate: number; responseRate: number }
  metrics: { contacts: Metric; conversations: Metric; openDeals: Metric; revenueMonth: Metric }
  salesByMonth: { label: string; value: number }[]
  funnel: { label: string; value: number; color: string }[]
  recentActivity: { id: string; type: string; title: string; createdAt: string }[]
  wonCountMonth: number
}

const EMPTY_MESSAGES: MessageMetrics = {
  sent: { value: 0, delta: null },
  delivered: { value: 0, delta: null },
  read: { value: 0, delta: null },
  responses: { value: 0, delta: null },
}

const WEEK_LABELS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']

function emptyWeek(): WeeklyMessagePoint[] {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(today)
    date.setDate(today.getDate() - 6 + index)
    return {
      date: date.toISOString().slice(0, 10),
      label: WEEK_LABELS[date.getDay()],
      sent: 0,
      delivered: 0,
      read: 0,
      responses: 0,
    }
  })
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const min = Math.floor(diff / 60000)
  if (min < 1) return 'agora'
  if (min < 60) return `${min} min`
  const hours = Math.floor(min / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

function MetricCard({ label, metric, icon: Icon, color }: {
  label: string
  metric: Metric
  icon: typeof Send
  color: string
}) {
  return (
    <article
      className="app-surface relative overflow-hidden p-4 sm:p-5"
      style={{ background: `radial-gradient(circle at 88% 0%, ${color}1f, transparent 46%), hsl(var(--surface-1))` }}
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-muted-foreground">{label}</p>
        <span className="flex h-10 w-10 items-center justify-center rounded-xl" style={{ background: `${color}22`, color }}>
          <Icon className="h-5 w-5" />
        </span>
      </div>
      <p className="text-3xl font-bold tracking-tight text-foreground">{metric.value.toLocaleString('pt-BR')}</p>
      {metric.delta === null ? (
        <p className="mt-2 text-[11px] text-muted-foreground">Sem base nos 7 dias anteriores</p>
      ) : (
        <p className={`mt-2 inline-flex items-center gap-1 text-xs font-semibold ${metric.delta >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
          {metric.delta >= 0 ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
          {metric.delta > 0 ? '+' : ''}{metric.delta}% <span className="font-normal text-muted-foreground">vs. período anterior</span>
        </p>
      )}
    </article>
  )
}

function ConversionRing({ deliveryRate, readRate, responseRate }: {
  deliveryRate: number
  readRate: number
  responseRate: number
}) {
  const ring = (value: number) => [{ value }, { value: Math.max(0, 100 - value) }]
  const rows = [
    { label: 'Entregues', value: deliveryRate, color: '#3B82F6' },
    { label: 'Lidas', value: readRate, color: '#8B5CF6' },
    { label: 'Respostas', value: responseRate, color: '#22D3EE' },
  ]

  return (
    <div>
      <div className="relative mx-auto h-64 w-full max-w-[280px]">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            {rows.map((row, index) => {
              const outerRadius = 112 - (index * 23)
              return (
                <Pie key={row.label} data={ring(row.value)} dataKey="value" startAngle={90} endAngle={-270} innerRadius={outerRadius - 13} outerRadius={outerRadius} stroke="none" isAnimationActive={false}>
                  <Cell fill={row.color} />
                  <Cell fill="hsl(var(--surface-3))" />
                </Pie>
              )
            })}
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-3xl font-bold tracking-tight text-foreground">{responseRate.toFixed(1)}%</span>
          <span className="mt-1 text-[11px] text-muted-foreground">taxa de resposta</span>
        </div>
      </div>
      <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center justify-between gap-2 rounded-lg border border-border bg-background/30 px-2.5 py-2 text-[11px]">
            <span className="inline-flex items-center gap-1.5 text-muted-foreground"><span className="h-2 w-2 rounded-full" style={{ background: row.color }} />{row.label}</span>
            <strong className="text-foreground">{row.value.toFixed(1)}%</strong>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function DashboardPage() {
  const [data, setData] = useState<Overview | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')

  const loadDashboard = useCallback(async (quiet = false) => {
    if (!quiet) setRefreshing(true)
    try {
      const [response, campaignResponse] = await Promise.all([
        api.get('/dashboard'),
        api.get('/campaigns').catch(() => ({ data: [] })),
      ])
      const overview = response.data as Overview
      if (!overview.messageMetrics) {
        const sent = (campaignResponse.data || []).reduce((total: number, campaign: { totalSent?: number }) => total + Number(campaign.totalSent || 0), 0)
        const week = emptyWeek()
        week[week.length - 1].sent = sent
        overview.messageMetrics = { ...EMPTY_MESSAGES, sent: { value: sent, delta: null } }
        overview.weeklyMessages = week
        overview.conversion = { deliveryRate: 0, readRate: 0, responseRate: 0 }
      }
      setData(overview)
      setError('')
    } catch {
      setError('Não foi possível atualizar as métricas agora.')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    void loadDashboard()
    const interval = window.setInterval(() => void loadDashboard(true), 30000)
    return () => window.clearInterval(interval)
  }, [loadDashboard])

  const messageMetrics = data?.messageMetrics || EMPTY_MESSAGES
  const weeklyMessages = data?.weeklyMessages?.length ? data.weeklyMessages : emptyWeek()
  const conversion = data?.conversion || { deliveryRate: 0, readRate: 0, responseRate: 0 }
  const hasWeeklyActivity = weeklyMessages.some((point) => point.sent || point.delivered || point.read || point.responses)
  const lastUpdated = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(new Date())

  const cards = [
    { label: 'Mensagens enviadas', metric: messageMetrics.sent, icon: Send, color: '#6366F1' },
    { label: 'Entregues', metric: messageMetrics.delivered, icon: CheckCheck, color: '#3B82F6' },
    { label: 'Lidas', metric: messageMetrics.read, icon: Eye, color: '#8B5CF6' },
    { label: 'Respostas', metric: messageMetrics.responses, icon: MessageCircle, color: '#22D3EE' },
  ]

  return (
    <div className="app-page space-y-5">
      <PageHeader
        eyebrow="Central de métricas"
        title="Dashboard"
        description="Visão geral das mensagens e interações do atendimento."
        icon={Activity}
        actions={(
          <>
            <span className="hidden items-center gap-1.5 rounded-xl border border-border bg-[hsl(var(--surface-1))] px-3 py-2 text-[11px] text-muted-foreground sm:inline-flex">
              <CalendarDays className="h-3.5 w-3.5" /> Últimos 7 dias · {lastUpdated}
            </span>
            <button type="button" onClick={() => void loadDashboard()} disabled={refreshing} className="app-button-secondary border-primary/25 bg-primary/10 text-primary hover:text-primary">
              <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} /> Atualizar
            </button>
          </>
        )}
      />

      {error ? (
        <div className="flex items-center gap-2 rounded-xl border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
          <AlertCircle className="h-4 w-4" /> {error}
        </div>
      ) : null}

      <section aria-label="Métricas de mensagens" className={`grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4 ${loading ? 'animate-pulse' : ''}`}>
        {cards.map((card) => <MetricCard key={card.label} {...card} />)}
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.9fr)_minmax(320px,.8fr)]">
        <article className="app-surface min-w-0 p-4 sm:p-5">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-bold text-foreground">Performance semanal</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">Mensagens enviadas, entregues e lidas nos últimos 7 dias.</p>
            </div>
            <div className="flex flex-wrap gap-3 text-[11px] text-muted-foreground">
              <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-indigo-500" />Enviadas</span>
              <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-blue-500" />Entregues</span>
              <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-cyan-400" />Lidas</span>
            </div>
          </div>
          <div className="relative h-[310px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={weeklyMessages} margin={{ top: 12, right: 10, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="sentGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#6366F1" stopOpacity={0.28} /><stop offset="100%" stopColor="#6366F1" stopOpacity={0} /></linearGradient>
                  <linearGradient id="deliveredGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#3B82F6" stopOpacity={0.22} /><stop offset="100%" stopColor="#3B82F6" stopOpacity={0} /></linearGradient>
                  <linearGradient id="readGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#22D3EE" stopOpacity={0.18} /><stop offset="100%" stopColor="#22D3EE" stopOpacity={0} /></linearGradient>
                </defs>
                <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 5" vertical={false} opacity={0.65} />
                <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }} dy={8} />
                <YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }} />
                <Tooltip contentStyle={{ background: 'hsl(var(--surface-2))', border: '1px solid hsl(var(--border))', borderRadius: 12, fontSize: 12 }} labelStyle={{ color: 'hsl(var(--foreground))' }} />
                <Area type="monotone" dataKey="sent" name="Enviadas" stroke="#6366F1" strokeWidth={2.5} fill="url(#sentGradient)" dot={{ r: 3, fill: '#6366F1' }} activeDot={{ r: 5 }} />
                <Area type="monotone" dataKey="delivered" name="Entregues" stroke="#3B82F6" strokeWidth={2.25} fill="url(#deliveredGradient)" dot={{ r: 3, fill: '#3B82F6' }} activeDot={{ r: 5 }} />
                <Area type="monotone" dataKey="read" name="Lidas" stroke="#22D3EE" strokeWidth={2.25} fill="url(#readGradient)" dot={{ r: 3, fill: '#22D3EE' }} activeDot={{ r: 5 }} />
              </AreaChart>
            </ResponsiveContainer>
            {!loading && !hasWeeklyActivity ? (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <span className="rounded-full border border-border bg-[hsl(var(--surface-2))]/90 px-3 py-1.5 text-[11px] text-muted-foreground">As métricas aparecerão após os primeiros envios.</span>
              </div>
            ) : null}
          </div>
        </article>

        <article className="app-surface p-4 sm:p-5">
          <h2 className="text-base font-bold text-foreground">Taxas de interação</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">Taxas registradas na última semana.</p>
          <ConversionRing {...conversion} />
        </article>
      </section>

      <section>
        <article className="app-surface p-4 sm:p-5">
          <h2 className="text-base font-bold text-foreground">Atividade recente</h2>
          <div className="mt-4 space-y-3">
            {(data?.recentActivity || []).slice(0, 5).map((activity) => (
              <div key={activity.id} className="flex items-start gap-2.5">
                <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary shadow-[0_0_8px_hsl(var(--primary))]" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs text-foreground">{activity.title}</p>
                  <p className="mt-0.5 text-[10px] text-muted-foreground">há {timeAgo(activity.createdAt)}</p>
                </div>
              </div>
            ))}
            {!loading && !data?.recentActivity.length ? <p className="text-xs text-muted-foreground">Nenhuma atividade recente.</p> : null}
          </div>
        </article>
      </section>
    </div>
  )
}
