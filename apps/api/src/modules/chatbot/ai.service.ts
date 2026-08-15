import axios from 'axios'

// Conteúdo multimodal (compatível com OpenAI/Claude via gateway):
// texto puro OU array de blocos (texto + imagem em base64 data-URI).
export type AiContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }

export interface AiMessage {
  role: 'system' | 'user' | 'assistant'
  content: string | AiContentBlock[]
}

const ai = axios.create({
  baseURL: process.env.AI_API_URL || 'https://api.picgeo.ai/v1',
  headers: {
    Authorization: `Bearer ${process.env.AI_API_KEY || ''}`,
    'Content-Type': 'application/json',
  },
  timeout: 60000,
})

/**
 * Gera uma resposta do modelo (compatível com a API da OpenAI).
 * Retorna o texto puro da resposta do assistente.
 */
export async function generateCompletion(
  messages: AiMessage[],
  opts: { temperature?: number; maxTokens?: number; model?: string } = {}
): Promise<string> {
  const res = await ai.post('/chat/completions', {
    model: opts.model || process.env.AI_MODEL || 'claude-haiku-4-5',
    messages,
    temperature: opts.temperature ?? 0.7,
    max_tokens: opts.maxTokens ?? 1024,
    stream: false,
  })

  const content: string =
    res.data?.choices?.[0]?.message?.content ??
    res.data?.choices?.[0]?.text ??
    ''

  return (content || '').trim()
}
