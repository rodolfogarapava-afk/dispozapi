'use client'
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import {
  Bot, GitBranch, UserCheck, RefreshCw, Megaphone, BarChart3, Sparkles,
  Check, ArrowRight, Zap, Shield, Clock, MessageSquare, Settings2, TrendingUp, Star,
} from 'lucide-react'

const BLUE = '#00AEEF'
const BLUE2 = '#0A84FF'

/* Revela elementos .reveal quando entram na viewport. */
function useReveal() {
  useEffect(() => {
    const els = Array.from(document.querySelectorAll('.reveal'))
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('is-visible'); io.unobserve(e.target) } }),
      { threshold: 0.12 }
    )
    els.forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [])
}

export default function LandingPage() {
  useReveal()
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20)
    window.addEventListener('scroll', onScroll)
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <div className="min-h-screen text-white overflow-x-hidden" style={{ background: 'hsl(213 35% 5%)' }}>
      {/* ===== NAV ===== */}
      <header className="fixed top-0 inset-x-0 z-50 transition-all duration-300"
        style={{ background: scrolled ? 'rgba(9,14,20,0.85)' : 'transparent', backdropFilter: scrolled ? 'blur(12px)' : 'none', borderBottom: scrolled ? '1px solid rgba(255,255,255,0.06)' : '1px solid transparent' }}>
        <div className="max-w-6xl mx-auto px-5 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <img src="/logo.png" alt="ZapShark" className="w-9 h-9 object-contain" style={{ filter: `drop-shadow(0 0 12px ${BLUE}60)` }} />
            <div className="leading-none">
              <span className="text-lg font-bold tracking-tight">ZapShark</span>
              <p className="text-[8px] font-semibold tracking-[0.2em] mt-0.5" style={{ color: BLUE }}>MULTI-ATENDIMENTO</p>
            </div>
          </div>
          <nav className="hidden md:flex items-center gap-7 text-sm text-white/70">
            <a href="#recursos" className="hover:text-white transition">Recursos</a>
            <a href="#como" className="hover:text-white transition">Como funciona</a>
            <a href="#precos" className="hover:text-white transition">Acesso</a>
          </nav>
          <div className="flex items-center gap-2">
            <Link href="/auth/login" className="hidden sm:block text-sm text-white/70 hover:text-white transition px-3 py-2">Entrar</Link>
            <a href="#precos" className="btn-primary text-sm">Ver acesso</a>
          </div>
        </div>
      </header>

      {/* ===== HERO ===== */}
      <section className="relative pt-36 pb-24 px-5">
        {/* fundo animado */}
        <div className="absolute inset-0 lp-grid opacity-40 pointer-events-none" />
        <div className="absolute inset-0 pointer-events-none" style={{ background: 'radial-gradient(ellipse 60% 50% at 50% 0%, #00AEEF22, transparent 70%)' }} />
        <div className="absolute -top-24 left-1/2 -translate-x-1/2 w-[520px] h-[520px] rounded-full lp-pulse pointer-events-none"
          style={{ background: `radial-gradient(circle, ${BLUE}25, transparent 65%)`, filter: 'blur(40px)' }} />

        <div className="relative max-w-4xl mx-auto text-center">
          <div className="reveal inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-medium mb-7 lp-glass">
            <Sparkles className="w-3.5 h-3.5" style={{ color: BLUE }} />
            CRM com IA que organiza sua operação sozinho
          </div>

          <h1 className="reveal text-4xl sm:text-6xl font-bold tracking-tight leading-[1.05] mb-6" style={{ transitionDelay: '60ms' }}>
            Seu WhatsApp vira uma<br />
            <span className="lp-gradient-text">máquina de vendas</span>
          </h1>

          <p className="reveal text-base sm:text-lg text-white/60 max-w-2xl mx-auto mb-9 leading-relaxed" style={{ transitionDelay: '120ms' }}>
            Atendimento, pipeline automática e disparos em massa num só lugar. A IA detecta humano,
            classifica cada conversa e move seus negócios pelo funil — você só fecha.
          </p>

          <div className="reveal flex flex-col sm:flex-row items-center justify-center gap-3 mb-5" style={{ transitionDelay: '180ms' }}>
            <a href="#precos" className="group inline-flex items-center gap-2 px-7 py-3.5 rounded-xl text-sm font-semibold text-white transition-all"
              style={{ background: `linear-gradient(135deg, ${BLUE}, ${BLUE2})`, boxShadow: `0 0 30px ${BLUE}45` }}>
              Como obter acesso
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </a>
            <Link href="/auth/login" className="inline-flex items-center gap-2 px-7 py-3.5 rounded-xl text-sm font-semibold lp-glass hover:bg-white/5 transition">
              Já tenho conta
            </Link>
          </div>
          <p className="reveal text-xs text-white/40" style={{ transitionDelay: '220ms' }}>
            Sem cartão de crédito · Configuração em minutos · Cancele quando quiser
          </p>

          {/* mockup flutuante */}
          <div className="reveal mt-16 relative" style={{ transitionDelay: '280ms' }}>
            <div className="lp-float relative max-w-3xl mx-auto rounded-2xl lp-glass p-2 shadow-2xl" style={{ boxShadow: `0 30px 80px -20px ${BLUE}30` }}>
              <div className="rounded-xl overflow-hidden border border-white/5" style={{ background: 'hsl(213 35% 7%)' }}>
                <div className="flex items-center gap-1.5 px-4 py-3 border-b border-white/5">
                  <span className="w-2.5 h-2.5 rounded-full bg-red-400/70" />
                  <span className="w-2.5 h-2.5 rounded-full bg-yellow-400/70" />
                  <span className="w-2.5 h-2.5 rounded-full bg-green-400/70" />
                  <span className="ml-3 text-[11px] text-white/40">app.zapshark.site/pipeline</span>
                </div>
                {/* mini-pipeline fake */}
                <div className="grid grid-cols-4 gap-2 p-4">
                  {[
                    { t: 'Novo lead', c: '#64748b', n: 8 },
                    { t: 'Em conversa', c: BLUE, n: 5 },
                    { t: 'Negociando', c: '#8B5CF6', n: 3 },
                    { t: 'Fechado', c: '#10B981', n: 12 },
                  ].map((col, i) => (
                    <div key={i} className="rounded-lg p-2" style={{ background: 'hsl(220 28% 10%)' }}>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-[9px] font-semibold" style={{ color: col.c }}>{col.t}</span>
                        <span className="text-[9px] text-white/30">{col.n}</span>
                      </div>
                      <div className="space-y-1.5">
                        {Array.from({ length: i === 3 ? 3 : 2 }).map((_, j) => (
                          <div key={j} className="rounded-md p-1.5 border border-white/5" style={{ background: 'hsl(213 35% 8%)' }}>
                            <div className="h-1.5 rounded-full mb-1" style={{ width: `${60 + j * 15}%`, background: col.c + '60' }} />
                            <div className="h-1 rounded-full bg-white/10" style={{ width: '40%' }} />
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ===== STATS ===== */}
      <section className="relative px-5 py-10 border-y border-white/5" style={{ background: 'rgba(255,255,255,0.015)' }}>
        <div className="max-w-5xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-6">
          {[
            { v: '24/7', l: 'Atendimento sem parar', icon: Clock },
            { v: '+70%', l: 'Menos tempo organizando', icon: Zap },
            { v: '100%', l: 'Configurável ao seu jeito', icon: Settings2 },
            { v: '1 clique', l: 'Para reavaliar o funil', icon: RefreshCw },
          ].map((s, i) => (
            <div key={i} className="reveal text-center" style={{ transitionDelay: `${i * 70}ms` }}>
              <s.icon className="w-5 h-5 mx-auto mb-2" style={{ color: BLUE }} />
              <p className="text-2xl sm:text-3xl font-bold lp-gradient-text">{s.v}</p>
              <p className="text-xs text-white/50 mt-1">{s.l}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ===== RECURSOS ===== */}
      <section id="recursos" className="relative px-5 py-24">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <p className="reveal text-xs font-semibold tracking-widest mb-3" style={{ color: BLUE }}>TUDO QUE VOCÊ PRECISA</p>
            <h2 className="reveal text-3xl sm:text-4xl font-bold mb-4" style={{ transitionDelay: '60ms' }}>
              Poder de verdade, <span className="lp-gradient-text">no automático</span>
            </h2>
            <p className="reveal text-white/55 max-w-2xl mx-auto" style={{ transitionDelay: '120ms' }}>
              Cada recurso pensado para você vender mais gastando menos tempo. E tudo editável, do seu jeito.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-5">
            {FEATURES.map((f, i) => (
              <div key={i} className="reveal lp-card-hover rounded-2xl p-6 border border-white/7"
                style={{ background: 'hsl(220 28% 9%)', transitionDelay: `${(i % 3) * 80}ms` }}>
                <div className="w-11 h-11 rounded-xl flex items-center justify-center mb-4"
                  style={{ background: f.color + '18', border: `1px solid ${f.color}30` }}>
                  <f.icon className="w-5 h-5" style={{ color: f.color }} />
                </div>
                <h3 className="text-base font-semibold mb-2">{f.title}</h3>
                <p className="text-sm text-white/55 leading-relaxed">{f.desc}</p>
                {f.tags && (
                  <div className="flex flex-wrap gap-1.5 mt-4">
                    {f.tags.map((t) => (
                      <span key={t} className="text-[10px] px-2 py-0.5 rounded-full" style={{ background: f.color + '15', color: f.color }}>{t}</span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ===== DESTAQUE: PIPELINE IA ===== */}
      <section className="relative px-5 py-20">
        <div className="max-w-6xl mx-auto grid lg:grid-cols-2 gap-12 items-center">
          <div className="reveal">
            <p className="text-xs font-semibold tracking-widest mb-3" style={{ color: BLUE }}>INTELIGÊNCIA ARTIFICIAL</p>
            <h2 className="text-3xl sm:text-4xl font-bold mb-5 leading-tight">
              A IA cuida do funil<br />enquanto você <span className="lp-gradient-text">fecha vendas</span>
            </h2>
            <div className="space-y-4">
              {[
                { icon: UserCheck, t: 'Detecta humano automaticamente', d: 'Quando um atendente entra na conversa, o bot pausa sozinho — sem atropelar o cliente.' },
                { icon: GitBranch, t: 'Classifica e move no pipeline', d: 'Cada conversa é lida pela IA e colocada no estágio certo do funil, sem você arrastar card.' },
                { icon: RefreshCw, t: 'Reavalia tudo em 1 clique', d: 'Relê o pipeline inteiro, remove quem já resolveu, marca ganhos e reorganiza o restante.' },
              ].map((it, i) => (
                <div key={i} className="flex gap-3.5">
                  <div className="w-9 h-9 rounded-lg flex-shrink-0 flex items-center justify-center" style={{ background: BLUE + '18', border: `1px solid ${BLUE}30` }}>
                    <it.icon className="w-4 h-4" style={{ color: BLUE }} />
                  </div>
                  <div>
                    <h4 className="font-semibold text-sm mb-0.5">{it.t}</h4>
                    <p className="text-sm text-white/55 leading-relaxed">{it.d}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* visual reavaliar */}
          <div className="reveal relative" style={{ transitionDelay: '120ms' }}>
            <div className="absolute -inset-4 rounded-3xl lp-pulse pointer-events-none" style={{ background: `radial-gradient(circle, ${BLUE}18, transparent 70%)`, filter: 'blur(30px)' }} />
            <div className="relative rounded-2xl lp-glass p-5">
              <div className="flex items-center justify-between mb-4">
                <span className="text-sm font-semibold">Reavaliação automática</span>
                <span className="inline-flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-full" style={{ background: BLUE + '20', color: BLUE }}>
                  <RefreshCw className="w-3 h-3 lp-spin-slow" /> IA processando
                </span>
              </div>
              <div className="space-y-2.5">
                {[
                  { n: 'André Silva', s: 'Pagou + recebeu key', m: '→ Fechado', c: '#10B981' },
                  { n: 'João Vitor', s: 'Produto com problema', m: '→ Mantido (suporte)', c: '#F59E0B' },
                  { n: 'Patrick L.', s: 'Negociando upgrade', m: '→ Mantido (negócio)', c: '#8B5CF6' },
                  { n: 'Felipe R.', s: 'Pediu reembolso', m: '→ Mantido (aberto)', c: '#F59E0B' },
                ].map((r, i) => (
                  <div key={i} className="flex items-center gap-3 rounded-lg p-2.5 border border-white/5" style={{ background: 'hsl(213 35% 8%)' }}>
                    <div className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0" style={{ background: `linear-gradient(135deg, ${BLUE}, ${BLUE2})` }}>
                      {r.n[0]}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold truncate">{r.n}</p>
                      <p className="text-[10px] text-white/45 truncate">{r.s}</p>
                    </div>
                    <span className="text-[10px] font-semibold flex-shrink-0" style={{ color: r.c }}>{r.m}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ===== COMO FUNCIONA ===== */}
      <section id="como" className="relative px-5 py-24" style={{ background: 'rgba(255,255,255,0.015)' }}>
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-16">
            <p className="reveal text-xs font-semibold tracking-widest mb-3" style={{ color: BLUE }}>SIMPLES DE COMEÇAR</p>
            <h2 className="reveal text-3xl sm:text-4xl font-bold" style={{ transitionDelay: '60ms' }}>Do zero ao automático em 3 passos</h2>
          </div>
          <div className="grid md:grid-cols-3 gap-6">
            {[
              { n: '01', icon: MessageSquare, t: 'Conecte seu WhatsApp', d: 'Leu o QR code e pronto. Suas conversas começam a aparecer no painel na hora.' },
              { n: '02', icon: Bot, t: 'A IA assume', d: 'Ela responde, detecta humano, classifica e organiza o pipeline automaticamente.' },
              { n: '03', icon: TrendingUp, t: 'Você acompanha e vende', d: 'Relatórios mostram tudo. Você foca em fechar enquanto o sistema organiza.' },
            ].map((s, i) => (
              <div key={i} className="reveal relative rounded-2xl p-6 border border-white/7 lp-card-hover" style={{ background: 'hsl(220 28% 9%)', transitionDelay: `${i * 90}ms` }}>
                <span className="absolute top-5 right-5 text-3xl font-bold text-white/5">{s.n}</span>
                <div className="w-11 h-11 rounded-xl flex items-center justify-center mb-4" style={{ background: BLUE + '18', border: `1px solid ${BLUE}30` }}>
                  <s.icon className="w-5 h-5" style={{ color: BLUE }} />
                </div>
                <h3 className="font-semibold mb-2">{s.t}</h3>
                <p className="text-sm text-white/55 leading-relaxed">{s.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ===== CTA / PREÇO ===== */}
      <section id="precos" className="relative px-5 py-28">
        <div className="absolute inset-0 pointer-events-none" style={{ background: 'radial-gradient(ellipse 50% 60% at 50% 50%, #00AEEF18, transparent 70%)' }} />
        <div className="relative max-w-2xl mx-auto text-center">
          <div className="reveal inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-medium mb-6 lp-glass">
            <Star className="w-3.5 h-3.5" style={{ color: BLUE }} /> Oferta de lançamento
          </div>
          <h2 className="reveal text-4xl sm:text-5xl font-bold mb-5 leading-tight" style={{ transitionDelay: '60ms' }}>
            Acesso <span className="lp-gradient-text">controlado</span>
          </h2>
          <p className="reveal text-white/60 mb-9 max-w-lg mx-auto" style={{ transitionDelay: '120ms' }}>
            As contas são criadas exclusivamente pelo administrador. Se sua conta já foi
            liberada, use as credenciais recebidas para entrar.
          </p>

          <div className="reveal rounded-2xl lp-glass p-8 mb-8 text-left" style={{ transitionDelay: '160ms' }}>
            <p className="text-sm font-semibold mb-4 text-center">Recursos incluídos no acesso:</p>
            <div className="grid sm:grid-cols-2 gap-3">
              {[
                'Atendimento multi-WhatsApp', 'Pipeline automática com IA',
                'Detecção de humano', 'Reavaliação do funil em 1 clique',
                'Campanhas de disparo em massa', 'Anti-spam configurável',
                'Relatórios completos', 'Equipe e permissões',
              ].map((b) => (
                <div key={b} className="flex items-center gap-2.5">
                  <span className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: '#10B98120' }}>
                    <Check className="w-3 h-3" style={{ color: '#10B981' }} />
                  </span>
                  <span className="text-sm text-white/75">{b}</span>
                </div>
              ))}
            </div>
          </div>

          <a href="/auth/login" className="reveal group inline-flex items-center gap-2 px-8 py-4 rounded-xl text-base font-semibold text-white transition-all"
            style={{ background: `linear-gradient(135deg, ${BLUE}, ${BLUE2})`, boxShadow: `0 0 40px ${BLUE}50`, transitionDelay: '200ms' }}>
            Entrar na plataforma
            <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
          </a>
          <p className="reveal text-xs text-white/40 mt-4 flex items-center justify-center gap-1.5" style={{ transitionDelay: '240ms' }}>
            <Shield className="w-3.5 h-3.5" /> Cadastro realizado somente pelo administrador
          </p>
        </div>
      </section>

      {/* ===== FOOTER ===== */}
      <footer className="border-t border-white/5 px-5 py-10">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <img src="/logo.png" alt="ZapShark" className="w-7 h-7 object-contain" />
            <span className="font-bold">ZapShark</span>
            <span className="text-xs text-white/40">· Multi-atendimento com IA</span>
          </div>
          <div className="flex items-center gap-6 text-sm text-white/50">
            <Link href="/auth/login" className="hover:text-white transition">Entrar</Link>
            <a href="#recursos" className="hover:text-white transition">Recursos</a>
            <a href="#precos" className="hover:text-white transition">Acesso</a>
          </div>
          <p className="text-xs text-white/30">© {new Date().getFullYear()} ZapShark</p>
        </div>
      </footer>
    </div>
  )
}

const FEATURES = [
  { icon: Bot, color: '#00AEEF', title: 'Pipeline automática com IA', desc: 'A inteligência lê cada conversa, entende o contexto e move o negócio para o estágio certo do funil — sem trabalho manual.', tags: ['Automático', 'Editável'] },
  { icon: UserCheck, color: '#10B981', title: 'Detecção de humano', desc: 'Assim que um atendente responde, o bot reconhece e pausa sozinho naquela conversa. Reativa quando você quiser.', tags: ['Inteligente'] },
  { icon: RefreshCw, color: '#8B5CF6', title: 'Reavaliar pipeline', desc: 'Um clique relê todo o funil: remove quem já resolveu, marca ganhos com valor e reorganiza o resto. Regras configuráveis.', tags: ['1 clique', 'Configurável'] },
  { icon: Megaphone, color: '#F59E0B', title: 'Campanhas de disparo', desc: 'Envie mensagens em massa para listas de contatos com personalização por nome e mídia. Acompanhe o progresso ao vivo.', tags: ['Em massa', 'Ao vivo'] },
  { icon: Shield, color: '#EF4444', title: 'Anti-spam configurável', desc: 'Intervalos aleatórios entre envios, pausas automáticas e limites — pré-ativados para proteger seu número, e ajustáveis.', tags: ['Pré-ativado', 'Seguro'] },
  { icon: BarChart3, color: '#0A84FF', title: 'Relatórios completos', desc: 'Vendas, receita, ticket médio, funil de conversão e ranking de atendentes. Tudo que aconteceu, em números claros.', tags: ['Tempo real'] },
]
