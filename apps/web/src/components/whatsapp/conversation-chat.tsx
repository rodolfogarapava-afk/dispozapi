'use client'
import { useEffect, useRef, useState, useCallback } from 'react'
import toast from 'react-hot-toast'
import { api } from '@/lib/api'
import { wsClient } from '@/lib/ws'
import { Send, Check, CheckCheck, Loader2, Paperclip, Mic, Trash2 } from 'lucide-react'
import { MediaBubble } from './media-bubble'
import { sendFileMessage } from '@/lib/upload'
import { useAudioRecorder } from '@/lib/use-audio-recorder'

interface Message {
  id: string
  content: string
  senderName?: string | null
  fromMe: boolean
  timestamp: string
  status?: string
  mediaUrl?: string | null
  mediaType?: string | null
}

interface ConversationChatProps {
  conversationId: string
  instanceId: string
  remoteJid: string
}

const timeStr = (t?: string) =>
  t ? new Date(t).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : ''

/**
 * Chat de uma conversa, isolado e reutilizável. Carrega o histórico, envia
 * mensagens e escuta `new_message` em tempo real. Usado no modal da pipeline.
 */
export function ConversationChat({ conversationId, instanceId, remoteJid }: ConversationChatProps) {
  const [messages, setMessages] = useState<Message[]>([])
  const [loading, setLoading] = useState(true)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)

  const scrollToBottom = () => {
    setTimeout(() => endRef.current?.scrollIntoView({ behavior: 'smooth' }), 50)
  }

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await api.get(`/whatsapp/conversations/${encodeURIComponent(conversationId)}/messages`)
      setMessages(r.data || [])
      scrollToBottom()
    } catch {
      toast.error('Erro ao carregar mensagens')
    }
    setLoading(false)
  }, [conversationId])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    const off = wsClient.on('new_message', (payload: any) => {
      if (payload.conversationId !== conversationId) return
      const nextMessage: Message = payload.message
      setMessages((prev) => {
        if (prev.some((m) => m.id === nextMessage.id)) return prev
        const updated = [...prev, nextMessage].sort(
          (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
        )
        scrollToBottom()
        return updated
      })
    })
    return off
  }, [conversationId])

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!text.trim() || sending) return
    setSending(true)
    const textToSend = text
    setText('')
    try {
      await api.post('/whatsapp/send', { instanceId, to: remoteJid, message: textToSend })
    } catch (e: any) {
      setText(textToSend)
      toast.error(e?.response?.data?.message || 'Falha ao enviar mensagem')
    }
    setSending(false)
  }

  const fileRef = useRef<HTMLInputElement>(null)
  const onPickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setSending(true)
    const t = toast.loading('Enviando arquivo...')
    try {
      await sendFileMessage({ instanceId, to: remoteJid, file })
      toast.success('Enviado', { id: t })
    } catch (err: any) {
      toast.error(err?.response?.data?.message || err?.message || 'Falha ao enviar', { id: t })
    }
    setSending(false)
  }

  const recorder = useAudioRecorder()
  const startRec = async () => {
    const ok = await recorder.start()
    if (!ok) toast.error('Não foi possível acessar o microfone')
  }
  const stopAndSendAudio = async () => {
    const file = await recorder.stop()
    if (!file) return
    setSending(true)
    const t = toast.loading('Enviando áudio...')
    try {
      await sendFileMessage({ instanceId, to: remoteJid, file, asAudio: true })
      toast.success('Áudio enviado', { id: t })
    } catch (err: any) {
      toast.error(err?.response?.data?.message || err?.message || 'Falha ao enviar áudio', { id: t })
    }
    setSending(false)
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex-1 overflow-y-auto p-4 space-y-1.5" style={{ background: 'hsl(var(--surface-0))' }}>
        {loading && (
          <div className="flex items-center justify-center pt-8">
            <Loader2 className="w-5 h-5 animate-spin" style={{ color: '#00AEEF' }} />
          </div>
        )}
        {!loading && messages.length === 0 && (
          <div className="text-center text-xs text-muted-foreground pt-8">Nenhuma mensagem</div>
        )}
        {messages.map((msg, i) => (
          <div key={msg.id || i} className={`flex ${msg.fromMe ? 'justify-end' : 'justify-start'}`}>
            <div
              className="max-w-[75%] px-3 py-2 rounded-xl text-xs leading-relaxed"
              style={
                msg.fromMe
                  ? {
                      background: 'linear-gradient(135deg, #00AEEF, #0A84FF)',
                      color: 'white',
                      borderRadius: '12px 12px 2px 12px',
                      boxShadow: '0 2px 8px #00AEEF30',
                    }
                  : {
                      background: 'hsl(var(--surface-3))',
                      border: '1px solid hsl(var(--border))',
                      color: 'hsl(var(--foreground))',
                      borderRadius: '12px 12px 12px 2px',
                    }
              }
            >
              {msg.mediaUrl && <MediaBubble mediaUrl={msg.mediaUrl} mediaType={msg.mediaType} fromMe={msg.fromMe} />}
              {msg.content && msg.content !== '[mídia]' && <p>{msg.content}</p>}
              {!msg.mediaUrl && msg.content === '[mídia]' && <p className="italic opacity-70">📎 mídia</p>}
              <div
                className={`flex items-center justify-end gap-1 mt-1 ${msg.fromMe ? 'text-white/60' : 'text-muted-foreground'}`}
                style={{ fontSize: '9px' }}
              >
                {timeStr(msg.timestamp)}
                {msg.fromMe &&
                  (msg.status === 'READ' ? (
                    <CheckCheck className="w-2.5 h-2.5" style={{ color: '#4FC3F7' }} />
                  ) : (
                    <Check className="w-2.5 h-2.5" />
                  ))}
              </div>
            </div>
          </div>
        ))}
        <div ref={endRef} />
      </div>

      <form
        onSubmit={sendMessage}
        className="flex items-center gap-2 p-3 border-t border-border flex-shrink-0"
        style={{ background: 'hsl(var(--surface-2))' }}
      >
        <input ref={fileRef} type="file" accept="image/*,video/*,audio/*,application/pdf,.pdf,.doc,.docx,.xls,.xlsx" className="hidden" onChange={onPickFile} />
        {recorder.recording ? (
          <>
            <button type="button" onClick={recorder.cancel} title="Cancelar" className="w-9 h-9 rounded-xl flex items-center justify-center hover:bg-accent transition flex-shrink-0">
              <Trash2 className="w-4 h-4 text-red-400" />
            </button>
            <div className="flex-1 flex items-center gap-2 px-3 py-2 rounded-xl border border-border" style={{ background: 'hsl(var(--surface-sunken))' }}>
              <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse flex-shrink-0" />
              <span className="text-sm text-foreground tabular-nums">{Math.floor(recorder.seconds / 60)}:{String(recorder.seconds % 60).padStart(2, '0')}</span>
              <span className="text-xs text-muted-foreground">Gravando...</span>
            </div>
            <button type="button" onClick={stopAndSendAudio} disabled={sending} title="Enviar áudio" className="w-10 h-10 rounded-xl flex items-center justify-center transition flex-shrink-0 disabled:opacity-40" style={{ background: 'linear-gradient(135deg, #00AEEF, #0A84FF)', boxShadow: '0 0 12px #00AEEF40' }}>
              <Send className="w-4 h-4 text-white" />
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={sending}
              title="Anexar"
              className="w-9 h-9 rounded-xl flex items-center justify-center hover:bg-accent transition flex-shrink-0 disabled:opacity-40"
            >
              <Paperclip className="w-4 h-4 text-muted-foreground" />
            </button>
            <div className="flex-1 flex items-center gap-2 px-3 py-2 rounded-xl border border-border" style={{ background: 'hsl(var(--surface-sunken))' }}>
              <input
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    sendMessage(e as any)
                  }
                }}
                placeholder="Digite uma mensagem..."
                disabled={sending}
                className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none disabled:opacity-50"
              />
            </div>
            <button
              type={text.trim() ? 'submit' : 'button'}
              onClick={text.trim() ? undefined : startRec}
              disabled={sending}
              title={text.trim() ? 'Enviar' : 'Gravar áudio'}
              className="w-10 h-10 rounded-xl flex items-center justify-center transition flex-shrink-0 disabled:opacity-40"
              style={{ background: 'linear-gradient(135deg, #00AEEF, #0A84FF)', boxShadow: '0 0 12px #00AEEF40' }}
            >
              {text.trim() ? <Send className="w-4 h-4 text-white" /> : <Mic className="w-4 h-4 text-white" />}
            </button>
          </>
        )}
      </form>
    </div>
  )
}
