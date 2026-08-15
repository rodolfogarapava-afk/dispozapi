// Resolve a URL de mídia retornada pela API. O backend devolve caminho relativo
// (/whatsapp/media/<file>); aqui prefixamos com a base da API. URLs absolutas
// (http...) ou data: passam direto.
const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'

export function mediaUrl(url?: string | null): string {
  if (!url) return ''
  if (/^(https?:|data:|blob:)/.test(url)) return url
  return `${API_BASE}${url.startsWith('/') ? '' : '/'}${url}`
}

// Tipo grosso a partir do mediaType salvo (image|audio|video|document) ou de
// valores legados da Evolution (imageMessage, audioMessage, ...).
export function mediaKind(mediaType?: string | null): 'image' | 'audio' | 'video' | 'document' | null {
  if (!mediaType) return null
  const t = mediaType.toLowerCase()
  if (t.includes('image') || t.includes('sticker')) return 'image'
  if (t.includes('audio') || t.includes('ptt')) return 'audio'
  if (t.includes('video')) return 'video'
  if (t.includes('document') || t.includes('pdf')) return 'document'
  return null
}
