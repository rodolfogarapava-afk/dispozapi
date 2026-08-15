import { api } from './api'

/** Lê um File como base64 puro (sem o prefixo data:...;base64,). */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      const comma = result.indexOf(',')
      resolve(comma >= 0 ? result.slice(comma + 1) : result)
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

const MAX_BYTES = 20 * 1024 * 1024 // 20MB

/** Envia um arquivo (foto/doc/áudio) por uma conversa via /whatsapp/send-media. */
export async function sendFileMessage(params: {
  instanceId: string
  to: string
  file: File
  caption?: string
  asAudio?: boolean
}): Promise<void> {
  if (params.file.size > MAX_BYTES) {
    throw new Error('Arquivo muito grande (máx. 20MB)')
  }
  const fileBase64 = await fileToBase64(params.file)
  await api.post('/whatsapp/send-media', {
    instanceId: params.instanceId,
    to: params.to,
    fileBase64,
    mimetype: params.file.type || 'application/octet-stream',
    fileName: params.file.name,
    caption: params.caption,
    asAudio: params.asAudio,
  })
}
