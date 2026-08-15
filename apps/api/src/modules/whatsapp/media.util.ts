import axios from 'axios'
import { promises as fs } from 'fs'
import path from 'path'
import crypto from 'crypto'

// Diretório onde a mídia baixada do WhatsApp é persistida. Configurável por env
// (na VPS aponta para um dir servido pelo app). Default: <cwd>/uploads/media.
const MEDIA_DIR = process.env.MEDIA_DIR || path.join(process.cwd(), 'uploads', 'media')

const evo = axios.create({
  baseURL: process.env.EVOLUTION_API_URL,
  headers: { apikey: process.env.EVOLUTION_API_KEY },
  timeout: 30000,
})

// Extensão a partir do mimetype (sufixo após "/", sem parâmetros tipo ";codecs").
const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'audio/ogg': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/amr': 'amr',
  'video/mp4': 'mp4',
  'application/pdf': 'pdf',
}

function extFromMime(mime?: string): string {
  if (!mime) return 'bin'
  const clean = mime.split(';')[0].trim()
  if (EXT_BY_MIME[clean]) return EXT_BY_MIME[clean]
  const tail = clean.split('/')[1]
  return (tail || 'bin').replace(/[^a-z0-9]/gi, '').slice(0, 5) || 'bin'
}

export interface SavedMedia {
  /** Caminho relativo servível: /whatsapp/media/<file> */
  url: string
  /** Nome do arquivo salvo em disco. */
  file: string
  mimetype: string
  /** Tipo grosso para o front: image | audio | video | document */
  kind: 'image' | 'audio' | 'video' | 'document'
  /** base64 puro (sem prefixo data:), reusado pela visão da IA sem reler do disco. */
  base64: string
}

function kindFromMime(mime: string): SavedMedia['kind'] {
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('audio/')) return 'audio'
  if (mime.startsWith('video/')) return 'video'
  return 'document'
}

/**
 * Pede à Evolution o base64 da mídia de uma mensagem (descriptografado) e salva
 * em disco. Retorna a URL servível + metadados. `null` se não houver mídia ou falhar.
 *
 * `data` é o objeto `data` do evento messages.upsert (contém `key` e `message`).
 */
export async function downloadAndStoreMedia(instanceName: string, data: any): Promise<SavedMedia | null> {
  try {
    const res = await evo.post(`/chat/getBase64FromMediaMessage/${instanceName}`, {
      message: { key: data.key },
      convertToMp4: false,
    })
    const base64: string | undefined = res.data?.base64
    const mimetype: string =
      res.data?.mimetype ||
      data?.message?.imageMessage?.mimetype ||
      data?.message?.audioMessage?.mimetype ||
      data?.message?.videoMessage?.mimetype ||
      data?.message?.documentMessage?.mimetype ||
      'application/octet-stream'
    if (!base64) return null

    const ext = extFromMime(mimetype)
    const file = `${crypto.randomBytes(16).toString('hex')}.${ext}`
    await fs.mkdir(MEDIA_DIR, { recursive: true })
    await fs.writeFile(path.join(MEDIA_DIR, file), Buffer.from(base64, 'base64'))

    return { url: `/whatsapp/media/${file}`, file, mimetype, kind: kindFromMime(mimetype), base64 }
  } catch {
    return null
  }
}

// Mime a partir da extensão do arquivo salvo (para reconstruir o data-URI da imagem).
const MIME_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif',
  ogg: 'audio/ogg', mp3: 'audio/mpeg', m4a: 'audio/mp4', amr: 'audio/amr',
  mp4: 'video/mp4', pdf: 'application/pdf', csv: 'text/csv', txt: 'text/plain',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
}

/** Lê um arquivo de mídia do disco e devolve base64 + mimetype (para a visão da IA). */
export async function readMediaBase64(file: string): Promise<{ base64: string; mimetype: string } | null> {
  try {
    const abs = resolveMediaPath(file)
    if (!abs) return null
    const buf = await fs.readFile(abs)
    const ext = (file.split('.').pop() || '').toLowerCase()
    return { base64: buf.toString('base64'), mimetype: MIME_BY_EXT[ext] || 'application/octet-stream' }
  } catch {
    return null
  }
}

/** Resolve o caminho absoluto de um arquivo de mídia, barrando path traversal. */
export function resolveMediaPath(file: string): string | null {
  const safe = path.basename(file || '')
  if (!safe || safe !== file) return null
  return path.join(MEDIA_DIR, safe)
}

/** Salva um buffer arbitrário (upload do operador) e devolve a URL servível. */
export async function storeBuffer(buffer: Buffer, mimetype: string): Promise<SavedMedia> {
  const ext = extFromMime(mimetype)
  const file = `${crypto.randomBytes(16).toString('hex')}.${ext}`
  await fs.mkdir(MEDIA_DIR, { recursive: true })
  await fs.writeFile(path.join(MEDIA_DIR, file), buffer)
  return {
    url: `/whatsapp/media/${file}`,
    file,
    mimetype,
    kind: kindFromMime(mimetype),
    base64: buffer.toString('base64'),
  }
}

export { MEDIA_DIR, extFromMime }
