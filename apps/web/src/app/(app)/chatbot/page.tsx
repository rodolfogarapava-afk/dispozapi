'use client'
import { useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { api } from '@/lib/api'
import {
  Bot, Save, Loader2, Send, Check, CheckCheck, Sparkles, Sliders,
  Clock, MessageSquare, Power, RotateCcw, Phone, MoreVertical,
} from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'

interface BotConfig {
  persona: string
  instructions: string
  knowledge: string
  greeting: string
  fallback: string
  temperature: number
  maxTokens: number
  historyLimit: number
  humanize: boolean
  readDelayMinMs: number
  readDelayMaxMs: number
  typing: boolean
  typingCharsPerSec: number
  typingMinMs: number
  typingMaxMs: number
  splitMessages: boolean
  splitMaxChars: number
  splitMode: 'compact' | 'balanced' | 'split'
  bubbleDelayMinMs: number
  bubbleDelayMaxMs: number
  replyToGroups: boolean
  onlyBusinessHours: boolean
  businessStart: string
  businessEnd: string
  outOfHoursMessage: string
  autoClassify: boolean
  pauseHumanHours: number
  classifyInstructions: string
  categoryMap: CategoryRule[]
  autoPauseEnabled: boolean
  pauseKeywords: string
  pauseAiEnabled: boolean
  pauseAiInstructions: string
  autoPauseHours: number
  removeOnResolved: boolean
  resolvedInstructions: string
  antiFloodEnabled: boolean
  floodMinIntervalMs: number
  floodMaxPerMinute: number
  model: string
  visionEnabled: boolean
  visionModel: string
  readPdfEnabled: boolean
  thinkMore: boolean
}

interface CategoryRule {
  category: string
  stageId: string
  pauseBot?: boolean
}

interface PreviewMsg {
  id: string
  role: 'user' | 'assistant'
  content: string
  pending?: boolean
}

const rand = (min: number, max: number) => Math.floor(min + Math.random() * Math.max(0, max - min))
const sleep = (ms: number) => new Promise((r) => setTimeout(r, Math.max(0, ms)))

export default function ChatbotPage() {
  const [config, setConfig] = useState<BotConfig | null>(null)
  const [name, setName] = useState('Atendente IA')
  const [active, setActive] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [toggling, setToggling] = useState(false)
  const [tab, setTab] = useState<'persona' | 'comportamento' | 'avancado'>('persona')

  // preview
  const [chat, setChat] = useState<PreviewMsg[]>([])
  const [draft, setDraft] = useState('')
  const [botTyping, setBotTyping] = useState(false)
  const [sending, setSending] = useState(false)
  const chatEndRef = useRef<HTMLDivElement>(null)

  const set = <K extends keyof BotConfig>(k: K, v: BotConfig[K]) =>
    setConfig((c) => (c ? { ...c, [k]: v } : c))

  useEffect(() => {
    ;(async () => {
      try {
        const { data } = await api.get('/chatbot')
        setConfig(data.config)
        setName(data.name || 'Atendente IA')
        setActive(!!data.active)
        if (data.config?.greeting) {
          setChat([{ id: 'greet', role: 'assistant', content: data.config.greeting }])
        }
      } catch {
        toast.error('Falha ao carregar configuração')
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chat, botTyping])

  const save = async () => {
    if (!config) return
    setSaving(true)
    try {
      await api.put('/chatbot', { name, active, config })
      toast.success('Configuração salva!')
    } catch {
      toast.error('Falha ao salvar')
    } finally {
      setSaving(false)
    }
  }

  // Liga/desliga o bot persistindo imediatamente no backend (efeito real no WhatsApp).
  const toggleActive = async () => {
    if (!config || toggling) return
    const next = !active
    setToggling(true)
    setActive(next) // otimista
    try {
      await api.put('/chatbot', { name, active: next, config })
      toast.success(next ? 'Bot ativado — respondendo no WhatsApp' : 'Bot desativado')
    } catch {
      setActive(!next) // reverte
      toast.error('Falha ao alterar status do bot')
    } finally {
      setToggling(false)
    }
  }

  const resetChat = () => {
    setChat(config?.greeting ? [{ id: 'greet', role: 'assistant', content: config.greeting }] : [])
    setBotTyping(false)
  }

  // Preview funcional: usa /chatbot/test com a config ATUAL (mesmo não salva)
  const sendPreview = async (e?: React.FormEvent) => {
    e?.preventDefault()
    const message = draft.trim()
    if (!message || !config || sending) return
    setSending(true)
    setDraft('')

    const userMsg: PreviewMsg = { id: `u_${Date.now()}`, role: 'user', content: message }
    const history = chat.map((m) => ({ role: m.role, content: m.content }))
    setChat((c) => [...c, userMsg])

    try {
      if (config.humanize) await sleep(rand(config.readDelayMinMs, config.readDelayMaxMs))
      const { data } = await api.post('/chatbot/test', { config, history, message })
      const bubbles: { text: string; typingMs: number }[] = data.bubbles || []

      for (let i = 0; i < bubbles.length; i++) {
        const b = bubbles[i]
        if (i > 0 && config.humanize) await sleep(rand(config.bubbleDelayMinMs, config.bubbleDelayMaxMs))
        if (config.typing) {
          setBotTyping(true)
          await sleep(b.typingMs || 800)
          setBotTyping(false)
        }
        setChat((c) => [...c, { id: `a_${Date.now()}_${i}`, role: 'assistant', content: b.text }])
      }
    } catch {
      setBotTyping(false)
      setChat((c) => [
        ...c,
        { id: `err_${Date.now()}`, role: 'assistant', content: config.fallback || 'Erro ao gerar resposta.' },
      ])
    } finally {
      setSending(false)
    }
  }

  if (loading || !config) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="w-6 h-6 animate-spin" style={{ color: '#00AEEF' }} />
      </div>
    )
  }

  const now = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })

  return (
    <div className="app-page space-y-5">
      <PageHeader
        eyebrow="Automação inteligente"
        title="Bot de atendimento"
        description="Configure como a inteligência artificial responde e se comporta no WhatsApp."
        icon={Bot}
        tone="violet"
        actions={(
          <>
          <button
            onClick={toggleActive}
            disabled={toggling}
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold border transition disabled:opacity-60"
            style={
              active
                ? { background: '#10B98118', borderColor: '#10B98140', color: '#10B981' }
                : { background: 'hsl(var(--surface-3))', borderColor: 'hsl(var(--border))', color: 'hsl(var(--muted-foreground))' }
            }
          >
            {toggling ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Power className="w-3.5 h-3.5" />}
            {active ? 'Bot ativo' : 'Bot desativado'}
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold text-foreground transition disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg, #00AEEF, #0A84FF)', boxShadow: '0 0 12px #00AEEF40' }}
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            Salvar
          </button>
          </>
        )}
      />

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-4">
        {/* ─── Painel de configuração ─── */}
        <div className="app-tool-shell">
          {/* Tabs */}
          <div className="flex border-b border-border">
            {[
              { id: 'persona', label: 'Personalidade', icon: Sparkles },
              { id: 'comportamento', label: 'Comportamento', icon: MessageSquare },
              { id: 'avancado', label: 'Avançado', icon: Sliders },
            ].map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setTab(id as any)}
                className="flex items-center gap-2 px-4 py-3 text-xs font-medium transition relative"
                style={{ color: tab === id ? '#00AEEF' : 'hsl(var(--muted-foreground))' }}
              >
                <Icon className="w-3.5 h-3.5" />
                {label}
                {tab === id && (
                  <span className="absolute bottom-0 left-0 right-0 h-0.5" style={{ background: '#00AEEF' }} />
                )}
              </button>
            ))}
          </div>

          <div className="p-5 space-y-5">
            {tab === 'persona' && (
              <>
                <Field label="Nome do bot" hint="Apenas para sua organização interna">
                  <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
                </Field>
                <Field label="Personalidade / quem é o bot" hint="Defina nome, tom de voz e papel do atendente">
                  <textarea className={textareaCls} rows={3} value={config.persona} onChange={(e) => set('persona', e.target.value)} />
                </Field>
                <Field label="Instruções de comportamento" hint="Como o bot deve agir, o que pode e não pode fazer">
                  <textarea className={textareaCls} rows={4} value={config.instructions} onChange={(e) => set('instructions', e.target.value)} />
                </Field>
                <Field label="Base de conhecimento" hint="Informações da empresa: produtos, preços, FAQ, políticas. O bot só usa isto como verdade.">
                  <textarea className={textareaCls} rows={5} value={config.knowledge} onChange={(e) => set('knowledge', e.target.value)} placeholder="Ex: Horário de funcionamento: 9h às 18h. Produto X custa R$ 99..." />
                </Field>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Field label="Saudação inicial" hint="Primeira mensagem (e abertura do preview)">
                    <textarea className={textareaCls} rows={2} value={config.greeting} onChange={(e) => set('greeting', e.target.value)} />
                  </Field>
                  <Field label="Resposta padrão (fallback)" hint="Quando o bot não sabe responder">
                    <textarea className={textareaCls} rows={2} value={config.fallback} onChange={(e) => set('fallback', e.target.value)} />
                  </Field>
                </div>
              </>
            )}

            {tab === 'comportamento' && (
              <>
                <div className="rounded-lg border border-border p-3" style={{ background: '#00AEEF08' }}>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    ⚡ Estes ajustes fazem o bot parecer humano para o WhatsApp não detectar automação. Os valores já vêm pré-configurados de forma segura.
                  </p>
                </div>

                <Toggle label="Simular comportamento humano" hint="Delay de leitura, pausas e digitação natural" checked={config.humanize} onChange={(v) => set('humanize', v)} />
                <Toggle label="Mostrar 'digitando...'" hint="Exibe o status de digitação antes de responder" checked={config.typing} onChange={(v) => set('typing', v)} />

                <div>
                  <p className="text-xs font-medium text-foreground mb-1.5">Modo de resposta</p>
                  <div className="flex rounded-lg border border-border overflow-hidden">
                    {([
                      { id: 'compact', label: 'Compacto', hint: 'Uma única mensagem' },
                      { id: 'balanced', label: 'Equilibrado', hint: 'Poucas mensagens' },
                      { id: 'split', label: 'Dividido', hint: 'Várias mensagens' },
                    ] as const).map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => set('splitMode', opt.id)}
                        className="flex-1 px-3 py-2 text-xs font-medium transition"
                        style={
                          config.splitMode === opt.id
                            ? { background: '#00AEEF18', color: '#00AEEF' }
                            : { background: 'transparent', color: 'hsl(var(--muted-foreground))' }
                        }
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-1">
                    {config.splitMode === 'compact'
                      ? 'O bot responde tudo em uma única mensagem.'
                      : config.splitMode === 'balanced'
                      ? 'Agrupa o texto em poucas mensagens (recomendado).'
                      : 'Divide bastante, uma ideia por mensagem.'}
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <Slider label="Delay de leitura mín. (s)" min={0} max={15} step={0.5} value={config.readDelayMinMs / 1000} onChange={(v) => set('readDelayMinMs', Math.round(v * 1000))} />
                  <Slider label="Delay de leitura máx. (s)" min={0} max={20} step={0.5} value={config.readDelayMaxMs / 1000} onChange={(v) => set('readDelayMaxMs', Math.round(v * 1000))} />
                  <Slider label="Velocidade de digitação (car/s)" min={5} max={40} step={1} value={config.typingCharsPerSec} onChange={(v) => set('typingCharsPerSec', v)} />
                  <Slider label="Pausa entre bolhas mín. (s)" min={0} max={6} step={0.1} value={config.bubbleDelayMinMs / 1000} onChange={(v) => set('bubbleDelayMinMs', Math.round(v * 1000))} />
                  <Slider label="Pausa entre bolhas máx. (s)" min={0} max={8} step={0.1} value={config.bubbleDelayMaxMs / 1000} onChange={(v) => set('bubbleDelayMaxMs', Math.round(v * 1000))} />
                </div>
              </>
            )}

            {tab === 'avancado' && (
              <>
                <Slider label={`Criatividade (temperature): ${config.temperature.toFixed(2)}`} min={0} max={1} step={0.05} value={config.temperature} onChange={(v) => set('temperature', v)} />
                <Slider label={`Tamanho máx. da resposta (tokens): ${config.maxTokens}`} min={100} max={2000} step={50} value={config.maxTokens} onChange={(v) => set('maxTokens', v)} />
                <Slider label={`Mensagens de histórico consideradas: ${config.historyLimit}`} min={2} max={30} step={1} value={config.historyLimit} onChange={(v) => set('historyLimit', v)} />

                <Toggle label="Responder em grupos" hint="Por padrão o bot ignora mensagens de grupos" checked={config.replyToGroups} onChange={(v) => set('replyToGroups', v)} />
                <Toggle label="Apenas em horário comercial" hint="Fora do horário envia mensagem automática" checked={config.onlyBusinessHours} onChange={(v) => set('onlyBusinessHours', v)} />

                {config.onlyBusinessHours && (
                  <>
                    <div className="grid grid-cols-2 gap-4">
                      <Field label="Abre às">
                        <input type="time" className={inputCls} value={config.businessStart} onChange={(e) => set('businessStart', e.target.value)} />
                      </Field>
                      <Field label="Fecha às">
                        <input type="time" className={inputCls} value={config.businessEnd} onChange={(e) => set('businessEnd', e.target.value)} />
                      </Field>
                    </div>
                    <Field label="Mensagem fora do horário">
                      <textarea className={textareaCls} rows={2} value={config.outOfHoursMessage} onChange={(e) => set('outOfHoursMessage', e.target.value)} />
                    </Field>
                  </>
                )}

                {/* ─── Automação: pausa e classificação IA ─── */}
                <div className="pt-4 mt-2 border-t border-border">
                  <p className="text-xs font-semibold text-foreground mb-3">Automação inteligente</p>

                  <Slider
                    label={`Pausar bot ao detectar humano por: ${config.pauseHumanHours}h`}
                    min={1}
                    max={48}
                    step={1}
                    value={config.pauseHumanHours}
                    onChange={(v) => set('pauseHumanHours', v)}
                  />

                </div>

                {/* ─── Pausa automática ─── */}
                <div className="pt-4 mt-2 border-t border-border space-y-3">
                  <p className="text-xs font-semibold text-foreground">Pausa automática</p>

                  <Toggle
                    label="Pausar por palavra-chave"
                    hint="Quando a mensagem do cliente contém um dos gatilhos abaixo, o bot pausa e não responde"
                    checked={config.autoPauseEnabled}
                    onChange={(v) => set('autoPauseEnabled', v)}
                  />

                  {config.autoPauseEnabled && (
                    <Field label="Gatilhos de pausa" hint="Uma palavra ou frase por linha (também aceita vírgulas)">
                      <textarea
                        className={textareaCls}
                        rows={3}
                        value={config.pauseKeywords}
                        onChange={(e) => set('pauseKeywords', e.target.value)}
                        placeholder={'falar com humano\natendente\nreclamação'}
                      />
                    </Field>
                  )}

                  <Toggle
                    label="Pausar por análise da IA"
                    hint="A IA lê a conversa e pausa quando detectar as situações descritas"
                    checked={config.pauseAiEnabled}
                    onChange={(v) => set('pauseAiEnabled', v)}
                  />

                  {config.pauseAiEnabled && (
                    <Field label="Quando a IA deve pausar">
                      <textarea
                        className={textareaCls}
                        rows={2}
                        value={config.pauseAiInstructions}
                        onChange={(e) => set('pauseAiInstructions', e.target.value)}
                      />
                    </Field>
                  )}

                  {(config.autoPauseEnabled || config.pauseAiEnabled) && (
                    <Slider
                      label={`Duração da pausa automática: ${config.autoPauseHours}h`}
                      min={1}
                      max={48}
                      step={1}
                      value={config.autoPauseHours}
                      onChange={(v) => set('autoPauseHours', v)}
                    />
                  )}
                </div>

                {/* ─── Anti-flood ─── */}
                <div className="pt-4 mt-2 border-t border-border space-y-3">
                  <p className="text-xs font-semibold text-foreground">Anti-flood</p>

                  <Toggle
                    label="Limitar rajada de mensagens"
                    hint="Evita que o bot envie muitas respostas seguidas na mesma conversa"
                    checked={config.antiFloodEnabled}
                    onChange={(v) => set('antiFloodEnabled', v)}
                  />

                  {config.antiFloodEnabled && (
                    <div className="grid grid-cols-2 gap-4">
                      <Slider
                        label={`Intervalo mínimo: ${(config.floodMinIntervalMs / 1000).toFixed(1)}s`}
                        min={0.5}
                        max={10}
                        step={0.5}
                        value={config.floodMinIntervalMs / 1000}
                        onChange={(v) => set('floodMinIntervalMs', Math.round(v * 1000))}
                      />
                      <Slider
                        label={`Máx. por minuto: ${config.floodMaxPerMinute}`}
                        min={1}
                        max={20}
                        step={1}
                        value={config.floodMaxPerMinute}
                        onChange={(v) => set('floodMaxPerMinute', v)}
                      />
                    </div>
                  )}
                </div>

                <div className="pt-4 mt-2 border-t border-border space-y-3">
                  <p className="text-xs font-semibold text-foreground">IA & Mídia</p>

                  <Field label="Modelo principal (texto)" hint="Deixe vazio para usar o padrão do servidor. Ex: claude-haiku-4-5, claude-sonnet-4-6">
                    <input className={inputCls} value={config.model} placeholder="claude-haiku-4-5 (padrão)" onChange={(e) => set('model', e.target.value)} />
                  </Field>

                  <Toggle
                    label="Pensar mais antes de responder"
                    hint="Lê todo o contexto, evita repetir o que já enviou e mantém coerência (recomendado)"
                    checked={config.thinkMore}
                    onChange={(v) => set('thinkMore', v)}
                  />

                  <Toggle
                    label="Bot enxerga imagens"
                    hint="Quando o cliente envia uma foto (ex: comprovante), o bot analisa a imagem"
                    checked={config.visionEnabled}
                    onChange={(v) => set('visionEnabled', v)}
                  />

                  {config.visionEnabled && (
                    <Field label="Modelo de visão (imagens)" hint="Usado só quando chega imagem. Modelos Claude com visão. Ex: claude-haiku-4-5 (mais barato) ou claude-sonnet-4-6">
                      <input className={inputCls} value={config.visionModel} placeholder="claude-haiku-4-5" onChange={(e) => set('visionModel', e.target.value)} />
                    </Field>
                  )}

                  <Toggle
                    label="Bot lê documentos (PDF)"
                    hint="Extrai o texto de PDFs enviados (ex: comprovante de pagamento) e usa no atendimento"
                    checked={config.readPdfEnabled}
                    onChange={(v) => set('readPdfEnabled', v)}
                  />
                </div>
              </>
            )}
          </div>
        </div>

        {/* ─── Preview WhatsApp funcional ─── */}
        <div className="flex flex-col">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
              <Phone className="w-3.5 h-3.5" style={{ color: '#00AEEF' }} /> Pré-visualização (funcional)
            </span>
            <button onClick={resetChat} className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition">
              <RotateCcw className="w-3 h-3" /> Reiniciar
            </button>
          </div>

          <div className="app-tool-shell flex flex-col" style={{ background: 'hsl(var(--surface-0))', height: '560px' }}>
            {/* Header do chat */}
            <div className="flex items-center gap-3 px-4 py-3 border-b border-border flex-shrink-0" style={{ background: 'hsl(var(--surface-2))' }}>
              <div className="w-9 h-9 rounded-full flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #00AEEF, #0A84FF)' }}>
                <Bot className="w-4.5 h-4.5 text-white" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-semibold text-foreground">{name}</p>
                <p className="text-[10px]" style={{ color: botTyping ? '#00AEEF' : 'hsl(var(--muted-foreground))' }}>
                  {botTyping ? 'digitando...' : 'online'}
                </p>
              </div>
              <MoreVertical className="w-4 h-4 text-muted-foreground" />
            </div>

            {/* Mensagens */}
            <div className="flex-1 overflow-y-auto p-4 space-y-1.5">
              {chat.length === 0 && (
                <p className="text-center text-[11px] text-muted-foreground pt-8">
                  Envie uma mensagem para testar o bot 👇
                </p>
              )}
              {chat.map((m) => (
                <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className="max-w-[78%] px-3 py-2 text-xs leading-relaxed whitespace-pre-wrap"
                    style={
                      m.role === 'user'
                        ? { background: 'linear-gradient(135deg, #00AEEF, #0A84FF)', color: 'white', borderRadius: '12px 12px 2px 12px' }
                        : { background: 'hsl(var(--surface-3))', border: '1px solid hsl(var(--border))', color: 'hsl(var(--foreground))', borderRadius: '12px 12px 12px 2px' }
                    }
                  >
                    <p>{m.content}</p>
                    <div className={`flex items-center justify-end gap-1 mt-1 ${m.role === 'user' ? 'text-white/60' : 'text-muted-foreground'}`} style={{ fontSize: '9px' }}>
                      {now}
                      {m.role === 'user' && <CheckCheck className="w-2.5 h-2.5" style={{ color: '#4FC3F7' }} />}
                    </div>
                  </div>
                </div>
              ))}
              {botTyping && (
                <div className="flex justify-start">
                  <div className="px-3 py-2.5 rounded-xl flex items-center gap-1" style={{ background: 'hsl(var(--surface-3))', border: '1px solid hsl(var(--border))', borderRadius: '12px 12px 12px 2px' }}>
                    <span className="typing-dot" />
                    <span className="typing-dot" style={{ animationDelay: '0.2s' }} />
                    <span className="typing-dot" style={{ animationDelay: '0.4s' }} />
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            {/* Input */}
            <form onSubmit={sendPreview} className="flex items-center gap-2 p-3 border-t border-border flex-shrink-0" style={{ background: 'hsl(var(--surface-2))' }}>
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Teste uma pergunta do cliente..."
                disabled={sending}
                className="flex-1 px-3 py-2 rounded-xl border border-border bg-transparent text-xs text-foreground placeholder:text-muted-foreground outline-none focus:border-[#00AEEF] transition disabled:opacity-50"
                style={{ background: 'hsl(var(--surface-sunken))' }}
              />
              <button
                type="submit"
                disabled={!draft.trim() || sending}
                className="w-9 h-9 rounded-xl flex items-center justify-center transition flex-shrink-0 disabled:opacity-40"
                style={{ background: 'linear-gradient(135deg, #00AEEF, #0A84FF)', boxShadow: '0 0 12px #00AEEF40' }}
              >
                {sending && !botTyping ? <Loader2 className="w-4 h-4 text-white animate-spin" /> : <Send className="w-4 h-4 text-white" />}
              </button>
            </form>
          </div>

          <p className="text-[10px] text-muted-foreground mt-2 flex items-center gap-1">
            <Clock className="w-3 h-3" /> O preview usa a configuração atual (mesmo sem salvar) e simula delays reais.
          </p>
        </div>
      </div>

      <style jsx global>{`
        .typing-dot {
          width: 6px;
          height: 6px;
          border-radius: 9999px;
          background: #00AEEF;
          display: inline-block;
          animation: typingBounce 1s infinite ease-in-out;
        }
        @keyframes typingBounce {
          0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
          30% { transform: translateY(-4px); opacity: 1; }
        }
      `}</style>
    </div>
  )
}

const inputCls =
  'w-full px-3 py-2 rounded-lg border border-border bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none focus:border-[#00AEEF] transition'
const textareaCls = inputCls + ' resize-none leading-relaxed'

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-foreground mb-1.5">{label}</label>
      {children}
      {hint && <p className="text-[10px] text-muted-foreground mt-1">{hint}</p>}
    </div>
  )
}

function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <p className="text-xs font-medium text-foreground">{label}</p>
        {hint && <p className="text-[10px] text-muted-foreground mt-0.5">{hint}</p>}
      </div>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className="relative w-10 h-5 rounded-full flex-shrink-0 transition"
        style={{ background: checked ? '#00AEEF' : 'hsl(var(--surface-4))' }}
      >
        <span
          className="absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all"
          style={{ left: checked ? '22px' : '2px' }}
        />
      </button>
    </div>
  )
}

function Slider({ label, min, max, step, value, onChange }: { label: string; min: number; max: number; step: number; value: number; onChange: (v: number) => void }) {
  return (
    <div>
      <label className="block text-[11px] font-medium text-muted-foreground mb-1.5">{label}</label>
      <div className="flex items-center gap-2">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="flex-1 accent-[#00AEEF]"
        />
        <span className="text-[11px] font-mono text-foreground w-12 text-right">{value}</span>
      </div>
    </div>
  )
}
