'use client'
import { FileText, Download } from 'lucide-react'
import { mediaUrl, mediaKind } from '@/lib/media'

interface MediaBubbleProps {
  mediaUrl?: string | null
  mediaType?: string | null
  fromMe?: boolean
}

/** Renderiza a mídia de uma mensagem (imagem/áudio/vídeo/documento) de forma responsiva. */
export function MediaBubble({ mediaUrl: url, mediaType, fromMe }: MediaBubbleProps) {
  const kind = mediaKind(mediaType)
  const src = mediaUrl(url)
  if (!src || !kind) return null

  if (kind === 'image') {
    return (
      <a href={src} target="_blank" rel="noopener noreferrer" className="block">
        <img
          src={src}
          alt="imagem"
          className="rounded-lg mb-1 max-w-full max-h-64 object-cover cursor-pointer"
          loading="lazy"
          onError={(e) => { (e.currentTarget.style.display = 'none') }}
        />
      </a>
    )
  }

  if (kind === 'video') {
    return <video src={src} controls className="rounded-lg mb-1 max-w-full max-h-64" />
  }

  if (kind === 'audio') {
    return <audio src={src} controls className="mb-1 w-52 max-w-full h-9" style={{ minWidth: '180px' }} />
  }

  // documento
  return (
    <a
      href={src}
      target="_blank"
      rel="noopener noreferrer"
      download
      className="flex items-center gap-2 mb-1 px-2.5 py-2 rounded-lg transition hover:opacity-80"
      style={{ background: fromMe ? 'rgba(255,255,255,0.15)' : 'hsl(var(--surface-4))' }}
    >
      <FileText className="w-4 h-4 flex-shrink-0" />
      <span className="text-[11px] flex-1 truncate">Documento</span>
      <Download className="w-3.5 h-3.5 flex-shrink-0 opacity-70" />
    </a>
  )
}
