/**
 * Normalização e casamento de telefones (WhatsApp ↔ CRM).
 *
 * Problema que isto resolve: a base mistura formatos — JID do WhatsApp
 * (`5581999998888@s.whatsapp.net`), telefone salvo no Contact (com/sem DDI,
 * com/sem 9º dígito, com máscara). O casamento ingênuo `a.startsWith(b) ||
 * b.startsWith(a)` casa números errados (um telefone que é prefixo de outro).
 *
 * Estratégia: reduzir todo número a uma CHAVE canônica comparável:
 *  - só dígitos;
 *  - remove DDI 55 do Brasil quando presente;
 *  - remove o 9º dígito de celular (após o DDD) para que `8 9999-8888` e
 *    `9 9999-8888` casem;
 *  - compara os últimos 8 dígitos (núcleo do número) + DDD quando ambos têm.
 * Só casa quando a chave é IGUAL — nunca por prefixo.
 */

/** Extrai o telefone cru de um remoteJid (remove `@s.whatsapp.net`/`@g.us` e `:device`). */
export function phoneFromJid(remoteJid: string): string {
  return remoteJid.split('@')[0].split(':')[0]
}

/** Só os dígitos de uma string qualquer. */
export function onlyDigits(input?: string | null): string {
  return (input || '').replace(/\D/g, '')
}

/**
 * Reduz um número a uma chave canônica para comparação.
 * Ex.: `+55 (81) 99999-8888`, `5581999998888`, `8199998888` → todos `8199998888`.
 * Retorna '' se não houver dígitos suficientes (< 8) — nunca casa nesse caso.
 */
export function phoneKey(input?: string | null): string {
  let d = onlyDigits(input)
  if (d.length < 8) return ''
  // Remove DDI do Brasil (55) quando o número tem DDD + número (>= 12 com DDI).
  if (d.length >= 12 && d.startsWith('55')) d = d.slice(2)
  // Agora esperado: DDD (2) + [9] + 8 dígitos. Remove o 9º dígito de celular.
  if (d.length === 11 && d[2] === '9') d = d.slice(0, 2) + d.slice(3) // DDD + 8
  // Mantém só DDD (2) + núcleo (8) = 10, ou o núcleo (8) quando não há DDD.
  if (d.length > 10) d = d.slice(-10)
  return d
}

/**
 * Casa dois números (telefone ou JID) de forma segura.
 * Compara as chaves canônicas: se ambas têm DDD compara os 10 dígitos; se uma
 * não tem DDD, compara o núcleo de 8 dígitos. Nunca casa por prefixo solto.
 */
export function phonesMatch(a?: string | null, b?: string | null): boolean {
  const ka = phoneKey(a)
  const kb = phoneKey(b)
  if (!ka || !kb) return false
  if (ka === kb) return true
  // Um lado sem DDD (8 díg) vs outro com DDD (10 díg): compara o núcleo de 8.
  const coreA = ka.slice(-8)
  const coreB = kb.slice(-8)
  return coreA.length === 8 && coreA === coreB
}
