import { promises as fs } from 'fs'
import { resolveMediaPath } from '../whatsapp/media.util'

/**
 * Extrai o texto de um PDF salvo em disco (pelo nome de arquivo da mídia).
 * Usa `pdf-parse` (carregado sob demanda; se não instalado, retorna null sem quebrar).
 * Retorna null se não for PDF, falhar, ou vier vazio.
 */
export async function extractPdfText(file: string): Promise<string | null> {
  try {
    if (!file.toLowerCase().endsWith('.pdf')) return null
    const abs = resolveMediaPath(file)
    if (!abs) return null
    // import dinâmico: a lib só é necessária quando chega um PDF.
    // @ts-expect-error — pdf-parse é instalado só na VPS (sem types); resolução em runtime.
    const mod: any = await import('pdf-parse').catch(() => null)
    const pdfParse = mod?.default || mod
    if (!pdfParse) return null
    const buffer = await fs.readFile(abs)
    const data = await pdfParse(buffer)
    const text = (data?.text || '').trim()
    return text || null
  } catch {
    return null
  }
}

/** Nome do arquivo a partir da mediaUrl servível (/whatsapp/media/<file>). */
export function fileFromMediaUrl(url?: string | null): string | null {
  if (!url) return null
  const m = url.match(/\/media\/([^/?#]+)$/)
  return m ? m[1] : null
}
