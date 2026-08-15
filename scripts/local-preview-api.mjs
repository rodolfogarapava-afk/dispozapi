import http from 'node:http'
import { readFileSync } from 'node:fs'
import ws from '../node_modules/.pnpm/ws@8.18.3/node_modules/ws/index.js'

const { WebSocketServer } = ws
const now = () => new Date().toISOString()
const EVOLUTION_PREFIX = 'disparox_local_'

function loadEnv(file) {
  const values = {}
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
    if (!match) continue
    values[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, '')
  }
  return values
}

const apiEnv = loadEnv(new URL('../apps/api/.env', import.meta.url))
const evolutionUrl = String(apiEnv.EVOLUTION_API_URL || '').replace(/\/$/, '')
const evolutionKey = String(apiEnv.EVOLUTION_API_KEY || '')

async function evolution(path, options = {}) {
  if (!evolutionUrl || !evolutionKey) throw { statusCode: 503, message: 'Evolution API não configurada' }
  const response = await fetch(`${evolutionUrl}${path}`, {
    method: options.method || 'GET',
    headers: { apikey: evolutionKey, 'content-type': 'application/json' },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: AbortSignal.timeout(20000),
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    const message = payload?.response?.message || payload?.message || `Evolution API respondeu ${response.status}`
    throw { statusCode: response.status, message: Array.isArray(message) ? message.join(', ') : String(message) }
  }
  return payload
}

function safeEvolutionInstance(value) {
  const name = String(value || '')
  if (!name.startsWith(EVOLUTION_PREFIX) || !/^[A-Za-z0-9_-]+$/.test(name)) {
    throw { statusCode: 403, message: 'Apenas instâncias locais de teste podem ser acessadas' }
  }
  return name
}

function testInstanceName(label) {
  const slug = String(label || 'teste').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 24) || 'teste'
  return `${EVOLUTION_PREFIX}${slug}_${Date.now().toString(36)}`
}

function evolutionError(response, error, fallback) {
  const status = Number(error?.statusCode) || (error?.name === 'TimeoutError' ? 504 : 502)
  console.error('[preview:evolution] falha', { status, message: error?.message || fallback })
  return send(response, status, { message: error?.message || fallback })
}

function inviteCode(input) {
  const raw = String(input || '').trim()
  const code = raw.includes('chat.whatsapp.com/') ? raw.split('chat.whatsapp.com/')[1]?.split(/[?#/]/)[0] : raw
  if (!code || !/^[A-Za-z0-9_-]{16,32}$/.test(code)) throw { statusCode: 400, message: 'Informe um link de convite válido' }
  return code
}

function evolutionParticipants(group) {
  const rows = Array.isArray(group?.participants) ? group.participants : Array.isArray(group?.Participants) ? group.Participants : []
  return rows.map((participant) => {
    const id = String(participant?.id || participant?.jid || participant?.phoneNumber || '')
    // O WhatsApp pode usar um LID privado como `id`, mas a Evolution às vezes
    // fornece o telefone resolvido separadamente. Usamos somente esse campo
    // explícito; sem ele, o participante continua protegido.
    const explicitPhone = String(participant?.phoneNumber || participant?.phone || participant?.pn || '')
    const phoneSource = explicitPhone && !explicitPhone.includes('@lid') ? explicitPhone : id
    const phone = phoneSource.includes('@lid') ? '' : phoneSource.split('@')[0].replace(/\D/g, '')
    return {
      id,
      phone,
      name: String(participant?.name || participant?.pushName || participant?.notify || phone || 'Participante'),
      role: participant?.admin === 'superadmin' ? 'Proprietário' : participant?.admin ? 'Admin' : 'Membro',
      canImport: /^\d{10,15}$/.test(phone),
    }
  })
}

function evolutionGroup(group, includeParticipants = false) {
  const members = evolutionParticipants(group)
  return {
    jid: String(group?.id || group?.groupJid || group?.remoteJid || group?.jid || ''),
    subject: String(group?.subject || group?.name || group?.title || 'Grupo sem nome'),
    description: String(group?.desc || group?.description || ''),
    pictureUrl: group?.pictureUrl || group?.profilePicUrl || null,
    participantCount: members.length || Number(group?.size || group?.participantCount || 0),
    role: group?.announce ? 'Somente admins' : 'Participante',
    participants: includeParticipants ? members : undefined,
  }
}

const conversationCache = new Map()

function evolutionTimestamp(value) {
  if (value instanceof Date) return value.toISOString()
  const numeric = Number(value)
  const date = Number.isFinite(numeric) && numeric > 0
    ? new Date(numeric > 1e12 ? numeric : numeric * 1000)
    : new Date(value || Date.now())
  return Number.isNaN(date.getTime()) ? now() : date.toISOString()
}

function evolutionMessageContent(record) {
  const message = record?.message || {}
  return String(
    message.conversation ||
    message.extendedTextMessage?.text ||
    message.imageMessage?.caption ||
    message.videoMessage?.caption ||
    message.documentMessage?.caption ||
    message.documentWithCaptionMessage?.message?.documentMessage?.caption ||
    (message.audioMessage ? '[Áudio]' : '') ||
    (message.imageMessage ? '[Imagem]' : '') ||
    (message.videoMessage ? '[Vídeo]' : '') ||
    (message.documentMessage || message.documentWithCaptionMessage ? '[Documento]' : '') ||
    (message.stickerMessage ? '[Figurinha]' : '') ||
    (record?.messageType && record.messageType !== 'conversation' ? '[Mídia]' : '') ||
    ''
  )
}

function conversationToken(instanceName, remoteJid) {
  return Buffer.from(JSON.stringify([instanceName, remoteJid])).toString('base64url')
}

function parseConversationToken(value) {
  try {
    const [instanceName, remoteJid] = JSON.parse(Buffer.from(String(value), 'base64url').toString('utf8'))
    safeEvolutionInstance(instanceName)
    if (typeof remoteJid !== 'string' || remoteJid.length > 160 || !remoteJid.includes('@')) throw new Error('invalid jid')
    return { instanceName, remoteJid }
  } catch {
    throw { statusCode: 400, message: 'Conversa inválida' }
  }
}

function evolutionConversation(instanceName, chat) {
  const remoteJid = String(chat?.remoteJid || chat?.id || chat?.lastMessage?.key?.remoteJid || '')
  if (!remoteJid || remoteJid === 'status@broadcast') return null
  const lastMessage = chat?.lastMessage || {}
  return {
    id: conversationToken(instanceName, remoteJid),
    instanceId: instanceName,
    remoteJid,
    pushName: String(chat?.pushName || chat?.name || remoteJid.split('@')[0]),
    lastMessage: evolutionMessageContent(lastMessage),
    lastMessageAt: evolutionTimestamp(chat?.updatedAt || lastMessage?.messageTimestamp),
    unreadCount: Math.max(0, Number(chat?.unreadCount) || 0),
    profilePicUrl: chat?.profilePicUrl || null,
    isGroup: remoteJid.endsWith('@g.us'),
    botPaused: false,
  }
}

function evolutionMessage(record) {
  const type = String(record?.messageType || '')
  const mediaType = /image/i.test(type) ? 'image' : /video/i.test(type) ? 'video' : /audio/i.test(type) ? 'audio' : /document/i.test(type) ? 'document' : null
  return {
    id: String(record?.key?.id || record?.id || record?.messageId || `evolution-${Date.now()}-${Math.random().toString(36).slice(2)}`),
    content: evolutionMessageContent(record),
    senderName: record?.key?.fromMe ? null : record?.pushName || null,
    fromMe: Boolean(record?.key?.fromMe),
    timestamp: evolutionTimestamp(record?.messageTimestamp || record?.createdAt),
    status: String(record?.MessageUpdate?.[0]?.status || record?.status || 'SENT'),
    mediaUrl: null,
    mediaType,
  }
}

async function listEvolutionConversations(instanceName) {
  const cached = conversationCache.get(instanceName)
  if (cached && Date.now() - cached.at < 4000) return cached.value
  const payload = await evolution(`/chat/findChats/${instanceName}`, { method: 'POST', body: {} })
  const rows = (Array.isArray(payload) ? payload : payload?.chats || [])
    .map((chat) => evolutionConversation(instanceName, chat))
    .filter(Boolean)
    .sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime())
    .slice(0, 100)
  conversationCache.set(instanceName, { at: Date.now(), value: rows })
  return rows
}

const contacts = [
  { id: 'contact-1', name: 'Ana Souza', phone: '5511999991001', email: null, tags: ['Cliente'], status: 'ACTIVE', source: 'Preview', createdAt: now() },
  { id: 'contact-2', name: 'Bruno Lima', phone: '5511999991002', email: null, tags: [], status: 'ACTIVE', source: 'Preview', createdAt: now() },
  { id: 'contact-3', name: 'Carla Mendes', phone: '5511999991003', email: null, tags: ['Lead', 'Evento'], status: 'ACTIVE', source: 'Preview', createdAt: now() },
]

function contactGroupLists(contact) {
  const fields = contact?.customFields && typeof contact.customFields === 'object' ? contact.customFields : {}
  return Array.isArray(fields.groupLists) ? fields.groupLists : []
}

function groupedContactLists() {
  const lists = new Map()
  for (const contact of contacts) {
    for (const ref of contactGroupLists(contact)) {
      if (!ref?.id || !ref?.name) continue
      const list = lists.get(ref.id) || { id: ref.id, name: ref.name, importedAt: ref.importedAt || contact.createdAt, contacts: [] }
      list.contacts.push({ id: contact.id, name: contact.name, phone: contact.phone, avatar: contact.avatar || null, status: contact.status })
      if (new Date(ref.importedAt || 0).getTime() > new Date(list.importedAt || 0).getTime()) list.importedAt = ref.importedAt
      lists.set(ref.id, list)
    }
  }
  return Array.from(lists.values())
    .map((list) => ({ id: list.id, name: list.name, importedAt: list.importedAt, contactCount: list.contacts.length, preview: list.contacts.slice(0, 5) }))
    .sort((a, b) => new Date(b.importedAt).getTime() - new Date(a.importedAt).getTime())
}

const groups = [
  { jid: 'empreendedores@g.us', subject: 'Empreendedores da região', description: 'Networking, parcerias e eventos locais.', participantCount: 86, role: 'Participante' },
  { jid: 'marketing@g.us', subject: 'Marketing & Vendas B2B', description: 'Conteúdo e trocas sobre aquisição e CRM.', participantCount: 142, role: 'Somente admins' },
]

const participants = [
  { id: '5511999990001@s.whatsapp.net', phone: '5511999990001', name: 'Marina Costa', role: 'Admin', canImport: true },
  { id: '5511999990002@s.whatsapp.net', phone: '5511999990002', name: 'Rafael Lima', role: 'Membro', canImport: true },
  { id: 'contato-protegido@lid', phone: '', name: 'Contato protegido', role: 'Membro', canImport: false },
]

const campaigns = [{
  id: 'campaign-preview', name: 'Boas-vindas clientes',
  message: 'Olá, {nome}! Temos uma novidade para você.',
  messages: [{ id: '1', text: 'Olá, {nome}! Temos uma novidade para você.' }],
  status: 'DRAFT', totalSent: 0, totalFailed: 0, createdAt: now(), _count: { contacts: 3 },
}]

const runningCampaigns = new Set()
let campaignCadence = { minDelayMs: 15000, maxDelayMs: 30000, pauseEvery: 20, pauseMs: 180000, maxPerRun: 100 }

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function clampNumber(value, min, max, fallback) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, Math.round(parsed))) : fallback
}

function sanitizeCampaignCadence(input = {}) {
  const minDelayMs = clampNumber(input.minDelayMs, 5000, 10 * 60 * 1000, campaignCadence.minDelayMs)
  return {
    minDelayMs,
    maxDelayMs: clampNumber(input.maxDelayMs, minDelayMs, 15 * 60 * 1000, campaignCadence.maxDelayMs),
    pauseEvery: clampNumber(input.pauseEvery, 0, 250, campaignCadence.pauseEvery),
    pauseMs: clampNumber(input.pauseMs, 0, 60 * 60 * 1000, campaignCadence.pauseMs),
    maxPerRun: clampNumber(input.maxPerRun, 1, 250, campaignCadence.maxPerRun),
  }
}

function publicCampaign(campaign) {
  const { contactIds, sentContactIds, failedContactIds, consentConfirmed, ...visible } = campaign
  return visible
}

function broadcast(event, data) {
  if (typeof sockets === 'undefined') return
  const payload = JSON.stringify({ event, data })
  for (const client of sockets.clients) {
    if (client.readyState === 1) client.send(payload)
  }
}

async function connectedCampaignInstance(requestedInstanceId = '') {
  const all = await evolution('/instance/fetchInstances')
  const owned = (Array.isArray(all) ? all : []).filter((item) => String(item?.name || '').startsWith(EVOLUTION_PREFIX))
  const instance = requestedInstanceId
    ? owned.find((item) => String(item?.name || '') === String(requestedInstanceId))
    : owned.find((item) => item?.connectionStatus === 'open')
  if (!instance) throw { statusCode: 400, message: 'A instância selecionada não foi encontrada' }
  if (instance.connectionStatus !== 'open') throw { statusCode: 400, message: 'A instância selecionada não está conectada' }
  return safeEvolutionInstance(instance.name)
}

async function sendCampaignStep(instanceName, contact, step) {
  const phone = String(contact?.phone || '').replace(/\D/g, '')
  if (!/^\d{10,15}$/.test(phone)) throw new Error('Contato sem telefone válido')
  const text = String(step?.text || '').replace(/\{nome\}/gi, contact?.name || '')
  const attachment = step?.attachment

  if (!attachment) {
    if (!text) throw new Error('Mensagem vazia')
    await evolution(`/message/sendText/${instanceName}`, { method: 'POST', body: { number: phone, text } })
    return
  }

  const media = String(attachment.url || '')
  if (!media) throw new Error('Anexo indisponível')
  if (attachment.kind === 'audio') {
    await evolution(`/message/sendWhatsAppAudio/${instanceName}`, { method: 'POST', body: { number: phone, audio: media } })
    if (text) await evolution(`/message/sendText/${instanceName}`, { method: 'POST', body: { number: phone, text } })
    return
  }

  await evolution(`/message/sendMedia/${instanceName}`, {
    method: 'POST',
    body: {
      number: phone,
      mediatype: attachment.kind === 'video' ? 'video' : attachment.kind === 'document' ? 'document' : 'image',
      mimetype: attachment.mimetype || 'application/octet-stream',
      media,
      fileName: attachment.fileName || 'anexo',
      ...(text ? { caption: text } : {}),
    },
  })
}

async function runCampaign(campaign, instanceName, cadence) {
  const alreadySent = new Set(campaign.sentContactIds || [])
  const targets = (campaign.contactIds || [])
    .filter((id) => !alreadySent.has(id))
    .map((id) => contacts.find((contact) => contact.id === id))
    .filter(Boolean)
    .slice(0, cadence.maxPerRun)

  for (let index = 0; index < targets.length; index++) {
    if (!runningCampaigns.has(campaign.id)) break
    const contact = targets[index]
    try {
      for (let stepIndex = 0; stepIndex < campaign.messages.length; stepIndex++) {
        if (!runningCampaigns.has(campaign.id)) break
        await sendCampaignStep(instanceName, contact, campaign.messages[stepIndex])
        if (stepIndex < campaign.messages.length - 1) await sleep(1500)
      }
      if (!runningCampaigns.has(campaign.id)) break
      campaign.sentContactIds = Array.from(new Set([...(campaign.sentContactIds || []), contact.id]))
      campaign.failedContactIds = (campaign.failedContactIds || []).filter((id) => id !== contact.id)
    } catch (error) {
      campaign.failedContactIds = Array.from(new Set([...(campaign.failedContactIds || []), contact.id]))
      console.error('[preview:campaign] falha no destinatário', { campaignId: campaign.id, message: error?.message || String(error) })
    }

    campaign.totalSent = campaign.sentContactIds.length
    campaign.totalFailed = campaign.failedContactIds.length
    broadcast('campaign_progress', {
      campaignId: campaign.id,
      sent: campaign.totalSent,
      failed: campaign.totalFailed,
      total: campaign._count.contacts,
    })

    if (index < targets.length - 1 && runningCampaigns.has(campaign.id)) {
      const delay = Math.round(cadence.minDelayMs + Math.random() * (cadence.maxDelayMs - cadence.minDelayMs))
      await sleep(delay)
      if (cadence.pauseEvery > 0 && (index + 1) % cadence.pauseEvery === 0) await sleep(cadence.pauseMs)
    }
  }

  const paused = !runningCampaigns.has(campaign.id)
  runningCampaigns.delete(campaign.id)
  const remaining = campaign.contactIds.filter((id) => !(campaign.sentContactIds || []).includes(id))
  campaign.status = paused || remaining.length ? 'PAUSED' : 'FINISHED'
  campaign.finishedAt = campaign.status === 'FINISHED' ? now() : null
  console.log('[preview:campaign] processamento concluído', { campaignId: campaign.id, sent: campaign.totalSent, failed: campaign.totalFailed, status: campaign.status })
  broadcast('campaign_done', { campaignId: campaign.id, sent: campaign.totalSent, failed: campaign.totalFailed })
}

const team = [
  { id: 'preview-user', name: 'Teste local', email: 'local@teste.invalid', role: 'OWNER', avatar: null, active: true, dealsCount: 1 },
  { id: 'preview-agent', name: 'Marina Costa', email: 'marina@teste.invalid', role: 'MEMBER', avatar: null, active: true, dealsCount: 1 },
]

const pipelines = [{
  id: 'pipeline-preview',
  name: 'Vendas',
  stages: [
    {
      id: 'stage-new', name: 'Novo lead', color: '#0ea5e9', order: 0,
      deals: [{ id: 'deal-preview', title: 'Plano Pro', value: 2490, status: 'OPEN', stageId: 'stage-new', notes: null, unreadCount: 0, contact: contacts[0], assignedTo: team[1] }],
    },
    { id: 'stage-proposal', name: 'Proposta', color: '#f59e0b', order: 1, deals: [] },
    { id: 'stage-closing', name: 'Fechamento', color: '#10b981', order: 2, deals: [] },
  ],
}]

let chatbot = {
  name: 'Atendente IA',
  active: false,
  config: {
    persona: 'Você é um atendente cordial e objetivo.',
    instructions: 'Responda com clareza e encaminhe para uma pessoa quando necessário.',
    knowledge: 'Ambiente local de demonstração do DisparoX.',
    greeting: 'Olá! Como posso ajudar?', fallback: 'Vou chamar um atendente para ajudar.',
    temperature: 0.4, maxTokens: 500, historyLimit: 12,
    humanize: false, readDelayMinMs: 0, readDelayMaxMs: 0,
    typing: false, typingCharsPerSec: 35, typingMinMs: 400, typingMaxMs: 2500,
    splitMessages: false, splitMaxChars: 320, splitMode: 'balanced', bubbleDelayMinMs: 300, bubbleDelayMaxMs: 900,
    replyToGroups: false, onlyBusinessHours: false, businessStart: '08:00', businessEnd: '18:00', outOfHoursMessage: 'Retornaremos no próximo horário útil.',
    autoClassify: false, pauseHumanHours: 8, classifyInstructions: '', categoryMap: [],
    autoPauseEnabled: true, pauseKeywords: 'atendente,humano,pessoa', pauseAiEnabled: false, pauseAiInstructions: '', autoPauseHours: 8,
    removeOnResolved: false, resolvedInstructions: '', antiFloodEnabled: true, floodMinIntervalMs: 1500, floodMaxPerMinute: 10,
    model: 'gpt-4o-mini', visionEnabled: false, visionModel: 'gpt-4o-mini', readPdfEnabled: false, thinkMore: false,
  },
}

function readJson(request) {
  if (request.method === 'GET' || request.method === 'DELETE') return Promise.resolve({})
  return new Promise((resolve, reject) => {
    const chunks = []
    request.on('data', (chunk) => chunks.push(chunk))
    request.on('end', () => {
      if (!chunks.length) return resolve({})
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))) }
      catch (error) { reject(error) }
    })
    request.on('error', reject)
  })
}

function send(response, status, payload) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': 'http://localhost:3000',
    'access-control-allow-credentials': 'true',
    'access-control-allow-headers': 'authorization,content-type',
    'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  })
  response.end(JSON.stringify(payload))
}

const server = http.createServer(async (request, response) => {
  if (request.method === 'OPTIONS') return send(response, 204, {})
  const url = new URL(request.url || '/', 'http://localhost:3001')
  const path = url.pathname
  let body = {}
  try { body = await readJson(request) }
  catch { return send(response, 400, { message: 'JSON inválido' }) }

  if (request.method === 'POST' && path === '/auth/login') return send(response, 200, {
    token: 'local-preview-token',
    user: { id: 'preview-user', name: 'Teste local', email: 'local@teste.invalid', role: 'OWNER', organizationId: 'preview-org', organization: { id: 'preview-org', name: 'Ambiente local', plan: 'PRO' } },
  })
  if (request.method === 'GET' && path === '/auth/me') return send(response, 200, {
    id: 'preview-user', name: 'Teste local', email: 'local@teste.invalid', role: 'OWNER', organizationId: 'preview-org', organization: { id: 'preview-org', name: 'Ambiente local', plan: 'PRO' },
  })
  if (request.method === 'PATCH' && path.startsWith('/auth/')) return send(response, 200, { ok: true })

  if (request.method === 'GET' && path === '/dashboard') {
    const sent = campaigns.reduce((total, campaign) => total + Number(campaign.totalSent || 0), 0)
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const labels = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
    const weeklyMessages = Array.from({ length: 7 }, (_, index) => {
      const date = new Date(today)
      date.setDate(today.getDate() - 6 + index)
      return {
        date: date.toISOString().slice(0, 10),
        label: labels[date.getDay()],
        sent: index === 6 ? sent : 0,
        delivered: 0,
        read: 0,
        responses: 0,
      }
    })
    return send(response, 200, {
      messageMetrics: {
        sent: { value: sent, delta: null },
        delivered: { value: 0, delta: null },
        read: { value: 0, delta: null },
        responses: { value: 0, delta: null },
      },
      weeklyMessages,
      conversion: { deliveryRate: 0, readRate: 0, responseRate: 0 },
      metrics: {
        contacts: { value: contacts.length, delta: null }, conversations: { value: conversationCache.size, delta: null },
        openDeals: { value: 1, delta: null }, revenueMonth: { value: 2490, delta: null },
      },
      salesByMonth: [],
      funnel: pipelines[0].stages.map((stage) => ({ label: stage.name, value: stage.deals.length, color: stage.color })),
      recentActivity: [{ id: 'activity-preview', type: 'contact', title: 'Carla Mendes entrou na lista de contatos', createdAt: new Date(Date.now() - 12 * 60000).toISOString() }],
      wonCountMonth: 1,
    })
  }

  if (request.method === 'GET' && path === '/whatsapp/instances') {
    try {
      const all = await evolution('/instance/fetchInstances')
      const instances = (Array.isArray(all) ? all : [])
        .filter((item) => String(item?.name || '').startsWith(EVOLUTION_PREFIX))
        .map((item) => ({
          id: item.name,
          name: String(item.name).replace(EVOLUTION_PREFIX, '').replace(/_[a-z0-9]+$/i, '').replace(/_/g, ' '),
          number: String(item.number || item.ownerJid || '').replace(/@.*/, ''),
          status: item.connectionStatus === 'open' ? 'CONNECTED' : item.connectionStatus === 'connecting' ? 'CONNECTING' : 'DISCONNECTED',
        }))
      console.log('[preview:whatsapp] instâncias carregadas', { count: instances.length })
      return send(response, 200, instances)
    } catch (error) {
      return evolutionError(response, error, 'Não foi possível consultar a Evolution API')
    }
  }
  if (request.method === 'GET' && path === '/whatsapp/conversations') {
    try {
      const instanceName = safeEvolutionInstance(url.searchParams.get('instanceId'))
      const conversations = await listEvolutionConversations(instanceName)
      console.log('[preview:whatsapp] conversas carregadas', { count: conversations.length })
      return send(response, 200, conversations)
    } catch (error) {
      return evolutionError(response, error, 'Não foi possível carregar as conversas')
    }
  }
  if (request.method === 'GET' && /^\/whatsapp\/conversations\/[^/]+\/messages$/.test(path)) {
    try {
      const token = decodeURIComponent(path.split('/')[3])
      const { instanceName, remoteJid } = parseConversationToken(token)
      const payload = await evolution(`/chat/findMessages/${instanceName}`, {
        method: 'POST',
        body: { where: { key: { remoteJid } }, limit: 100 },
      })
      const records = payload?.messages?.records || payload?.records || (Array.isArray(payload) ? payload : [])
      const messages = records
        .map(evolutionMessage)
        .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
      console.log('[preview:whatsapp] mensagens carregadas', { count: messages.length })
      return send(response, 200, messages)
    } catch (error) {
      return evolutionError(response, error, 'Não foi possível carregar as mensagens')
    }
  }
  if (request.method === 'POST' && path === '/whatsapp/instances') {
    const instanceName = testInstanceName(body.name)
    try {
      await evolution('/instance/create', {
        method: 'POST',
        body: { instanceName, integration: 'WHATSAPP-BAILEYS', qrcode: true },
      })
      return send(response, 201, { id: instanceName, name: body.name || 'Teste Evolution', status: 'CONNECTING' })
    } catch (error) {
      return evolutionError(response, error, 'Não foi possível criar a instância de teste')
    }
  }
  if (request.method === 'POST' && path === '/whatsapp/send') return send(response, 403, { message: 'Envio real bloqueado até a confirmação do número de teste' })
  if (request.method === 'GET' && /^\/whatsapp\/instances\/[^/]+\/(qrcode|status)$/.test(path)) {
    try {
      const instanceName = safeEvolutionInstance(decodeURIComponent(path.split('/')[3]))
      const endpoint = path.endsWith('/qrcode') ? `/instance/connect/${instanceName}` : `/instance/connectionState/${instanceName}`
      return send(response, 200, await evolution(endpoint))
    } catch (error) {
      return evolutionError(response, error, 'Não foi possível consultar a instância')
    }
  }
  if (request.method === 'DELETE' && /^\/whatsapp\/instances\/[^/]+$/.test(path)) {
    try {
      const instanceName = safeEvolutionInstance(decodeURIComponent(path.split('/')[3]))
      await evolution(`/instance/logout/${instanceName}`, { method: 'DELETE' }).catch(() => null)
      await evolution(`/instance/delete/${instanceName}`, { method: 'DELETE' })
      return send(response, 200, { ok: true })
    } catch (error) {
      return evolutionError(response, error, 'Não foi possível excluir a instância de teste')
    }
  }

  if (request.method === 'GET' && path === '/contacts/group-lists') return send(response, 200, groupedContactLists())
  if (request.method === 'GET' && /^\/contacts\/group-lists\/[^/]+$/.test(path)) {
    const groupId = decodeURIComponent(path.split('/')[3])
    const list = groupedContactLists().find((item) => item.id === groupId)
    if (!list) return send(response, 404, { message: 'Lista de grupo não encontrada' })
    const groupedContacts = contacts.filter((contact) => contactGroupLists(contact).some((ref) => ref.id === groupId))
    return send(response, 200, { ...list, contacts: groupedContacts })
  }
  if (request.method === 'GET' && path === '/contacts') {
    const search = (url.searchParams.get('search') || '').toLocaleLowerCase('pt-BR')
    const filtered = search
      ? contacts.filter((contact) => `${contact.name} ${contact.phone} ${contact.email || ''}`.toLocaleLowerCase('pt-BR').includes(search))
      : contacts
    return send(response, 200, { data: filtered, total: filtered.length, page: 1, pages: 1 })
  }
  if (request.method === 'POST' && path === '/contacts/bulk-import') {
    let created = 0
    const importedAt = now()
    const groupRef = body.groupList?.id && body.groupList?.name
      ? { id: String(body.groupList.id), name: String(body.groupList.name), importedAt }
      : null
    const imported = (Array.isArray(body.contacts) ? body.contacts : []).map((item, index) => {
      const phone = String(item.phone || '').replace(/\D/g, '')
      if (!phone) return null
      const existing = contacts.find((contact) => contact.phone === phone)
      if (existing) {
        if (groupRef) {
          const refs = contactGroupLists(existing).filter((ref) => ref.id !== groupRef.id)
          existing.customFields = { ...(existing.customFields || {}), groupLists: [...refs, groupRef] }
        }
        return existing
      }
      created++
      const contact = {
        id: `contact-import-${Date.now()}-${index}`,
        name: item.name || phone,
        phone,
        email: item.email || null,
        tags: item.tags || [],
        status: 'ACTIVE',
        source: body.source || 'CSV',
        customFields: groupRef ? { groupLists: [groupRef] } : {},
        createdAt: importedAt,
      }
      contacts.push(contact)
      return contact
    }).filter(Boolean)
    return send(response, 200, { contacts: imported, total: imported.length, created })
  }
  if (request.method === 'POST' && path === '/contacts') {
    const contact = { id: `contact-${Date.now()}`, name: body.name || 'Novo contato', phone: body.phone || '', email: body.email || null, tags: body.tags || [], status: body.status || 'ACTIVE', source: body.source || 'Manual', createdAt: now() }
    contacts.unshift(contact)
    return send(response, 201, contact)
  }
  if (request.method === 'PATCH' && /^\/contacts\/[^/]+$/.test(path)) {
    const contact = contacts.find((item) => item.id === decodeURIComponent(path.split('/')[2]))
    if (!contact) return send(response, 404, { message: 'Contato não encontrado' })
    Object.assign(contact, body)
    return send(response, 200, contact)
  }
  if (request.method === 'DELETE' && /^\/contacts\/[^/]+$/.test(path)) {
    const index = contacts.findIndex((item) => item.id === decodeURIComponent(path.split('/')[2]))
    if (index >= 0) contacts.splice(index, 1)
    return send(response, 200, { ok: true })
  }

  if (request.method === 'GET' && path === '/campaigns/antispam') return send(response, 200, campaignCadence)
  if (request.method === 'GET' && path === '/campaigns') return send(response, 200, campaigns.map(publicCampaign))
  if (request.method === 'PATCH' && path === '/campaigns/antispam') {
    campaignCadence = sanitizeCampaignCadence({ ...campaignCadence, ...body })
    return send(response, 200, campaignCadence)
  }
  if (request.method === 'POST' && path === '/campaigns/assets') {
    const mimetype = body.mimetype || 'application/octet-stream'
    const kind = mimetype.startsWith('image/') ? 'image' : mimetype.startsWith('audio/') ? 'audio' : mimetype.startsWith('video/') ? 'video' : 'document'
    return send(response, 201, { url: body.fileBase64 || '', fileName: body.fileName || 'anexo', mimetype, kind })
  }
  if (request.method === 'POST' && path === '/campaigns') {
    if (body.consentConfirmed !== true) return send(response, 400, { message: 'Confirme que os destinatários autorizaram o contato' })
    const contactIds = Array.from(new Set(Array.isArray(body.contactIds) ? body.contactIds.map(String) : []))
      .filter((id) => contacts.some((contact) => contact.id === id && contact.status === 'ACTIVE'))
    if (!contactIds.length) return send(response, 400, { message: 'Selecione ao menos um contato ativo' })
    const messages = (Array.isArray(body.messages) ? body.messages : [])
      .slice(0, 1)
      .map((step, index) => ({ ...step, id: String(step?.id || index + 1), text: String(step?.text || '').trim().slice(0, 4096) }))
      .filter((step) => step.text || step.attachment)
    if (!messages.length) return send(response, 400, { message: 'Adicione ao menos uma mensagem ou anexo' })
    let instanceId
    try {
      instanceId = await connectedCampaignInstance(body.instanceId)
    } catch (error) {
      return evolutionError(response, error, 'Selecione uma instância conectada')
    }
    const instanceName = String(instanceId).replace(EVOLUTION_PREFIX, '').replace(/_[a-z0-9]+$/i, '').replace(/_/g, ' ')
    const campaign = {
      id: `campaign-${Date.now()}`,
      name: String(body.name || 'Campanha local').trim().slice(0, 120),
      message: messages.map((step) => step.text).filter(Boolean).join(' · '),
      messages,
      instanceId,
      instanceName,
      contactIds,
      sentContactIds: [],
      failedContactIds: [],
      consentConfirmed: true,
      status: 'DRAFT',
      totalSent: 0,
      totalFailed: 0,
      createdAt: now(),
      _count: { contacts: contactIds.length },
    }
    campaigns.unshift(campaign)
    return send(response, 201, publicCampaign(campaign))
  }
  if (request.method === 'POST' && /^\/campaigns\/[^/]+\/(start|pause)$/.test(path)) {
    const campaign = campaigns.find((item) => item.id === path.split('/')[2])
    if (!campaign) return send(response, 404, { message: 'Campanha não encontrada' })
    if (path.endsWith('/pause')) {
      runningCampaigns.delete(campaign.id)
      campaign.status = 'PAUSED'
      return send(response, 200, { message: 'Campanha pausada', campaign: publicCampaign(campaign) })
    }
    if (!campaign.contactIds?.length) return send(response, 409, { message: 'Esta campanha foi criada no modo de demonstração. Crie uma nova para usar o envio real.' })
    if (runningCampaigns.has(campaign.id)) return send(response, 400, { message: 'Campanha já está em execução' })
    try {
      const instanceName = await connectedCampaignInstance(body.instanceId || campaign.instanceId)
      const cadence = sanitizeCampaignCadence({ ...campaignCadence, ...(body.config || {}) })
      campaign.status = 'RUNNING'
      campaign.startedAt = now()
      campaign.finishedAt = null
      runningCampaigns.add(campaign.id)
      console.log('[preview:campaign] envio iniciado', { campaignId: campaign.id, recipients: campaign.contactIds.length, messages: campaign.messages.length })
      void runCampaign(campaign, instanceName, cadence).catch((error) => {
        runningCampaigns.delete(campaign.id)
        campaign.status = 'PAUSED'
        console.error('[preview:campaign] processamento interrompido', { campaignId: campaign.id, message: error?.message || String(error) })
      })
      return send(response, 200, { message: 'Campanha iniciada', campaign: publicCampaign(campaign), config: cadence })
    } catch (error) {
      return evolutionError(response, error, 'Não foi possível iniciar a campanha')
    }
  }
  if (request.method === 'DELETE' && /^\/campaigns\/[^/]+$/.test(path)) {
    const id = path.split('/')[2]
    runningCampaigns.delete(id)
    const index = campaigns.findIndex((item) => item.id === id)
    if (index >= 0) campaigns.splice(index, 1)
    return send(response, 200, { ok: true })
  }

  if (request.method === 'GET' && path === '/pipeline') return send(response, 200, pipelines)
  if (request.method === 'POST' && path === '/pipeline') {
    const pipeline = { id: `pipeline-${Date.now()}`, name: body.name || 'Novo funil', stages: [] }
    pipelines.push(pipeline)
    return send(response, 201, pipeline)
  }
  if (request.method === 'POST' && /^\/pipeline\/[^/]+\/stages$/.test(path)) {
    const pipeline = pipelines.find((item) => item.id === path.split('/')[2])
    const stage = { id: `stage-${Date.now()}`, name: body.name || 'Novo estágio', color: body.color || '#0ea5e9', order: pipeline?.stages.length || 0, deals: [] }
    pipeline?.stages.push(stage)
    return send(response, 201, stage)
  }
  if (request.method === 'POST' && path === '/pipeline/deals') {
    const stage = pipelines.flatMap((item) => item.stages).find((item) => item.id === body.stageId)
    const contact = contacts.find((item) => item.id === body.contactId) || contacts[0]
    const deal = { id: `deal-${Date.now()}`, title: body.title || 'Novo negócio', value: Number(body.value) || 0, status: 'OPEN', stageId: body.stageId, notes: body.notes || null, unreadCount: 0, contact, assignedTo: team[1] }
    stage?.deals.push(deal)
    return send(response, 201, deal)
  }
  if (request.method === 'PATCH' && /^\/pipeline\/deals\/[^/]+(?:\/move)?$/.test(path)) {
    const dealId = path.split('/')[3]
    const allStages = pipelines.flatMap((item) => item.stages)
    const source = allStages.find((stage) => stage.deals.some((item) => item.id === dealId))
    const deal = source?.deals.find((item) => item.id === dealId)
    if (!deal) return send(response, 404, { message: 'Negócio não encontrado' })
    if (body.stageId && body.stageId !== deal.stageId) {
      source.deals.splice(source.deals.indexOf(deal), 1)
      allStages.find((stage) => stage.id === body.stageId)?.deals.push(deal)
    }
    Object.assign(deal, body)
    return send(response, 200, deal)
  }
  if (request.method === 'PATCH' && /^\/pipeline\/[^/]+$/.test(path)) {
    const pipeline = pipelines.find((item) => item.id === path.split('/')[2])
    if (pipeline) Object.assign(pipeline, body)
    return send(response, 200, pipeline || {})
  }
  if (request.method === 'DELETE' && /^\/pipeline\/deals\/[^/]+$/.test(path)) {
    const dealId = path.split('/')[3]
    for (const stage of pipelines.flatMap((item) => item.stages)) {
      const index = stage.deals.findIndex((item) => item.id === dealId)
      if (index >= 0) stage.deals.splice(index, 1)
    }
    return send(response, 200, { ok: true })
  }
  if (request.method === 'POST' && path === '/pipeline/reevaluate') return send(response, 200, { applied: !!body.apply, truncated: false, counts: { win: 0, move: 0, remove: 0, keep: 1, total: 1 }, items: [] })
  if (request.method === 'POST' && path === '/pipeline/clean-inactive') return send(response, 200, { applied: !!body.apply, hours: 4, count: 0, items: [] })

  if (request.method === 'GET' && path === '/chatbot') return send(response, 200, chatbot)
  if (request.method === 'PUT' && path === '/chatbot') {
    chatbot = { ...chatbot, ...body, config: { ...chatbot.config, ...(body.config || {}) } }
    return send(response, 200, chatbot)
  }
  if (request.method === 'POST' && path === '/chatbot/test') return send(response, 200, { bubbles: [{ text: `Recebi: ${body.message || ''}`, typingMs: 0 }] })

  if (request.method === 'GET' && path === '/team') return send(response, 200, team)
  if (request.method === 'POST' && path === '/team') {
    const member = { id: `member-${Date.now()}`, name: body.name || 'Novo atendente', email: body.email || '', role: body.role || 'MEMBER', avatar: null, active: true, dealsCount: 0 }
    team.push(member)
    return send(response, 201, member)
  }
  if (request.method === 'PATCH' && /^\/team\/[^/]+$/.test(path)) {
    const member = team.find((item) => item.id === path.split('/')[2])
    if (member) Object.assign(member, body)
    return send(response, 200, member || {})
  }
  if (request.method === 'DELETE' && /^\/team\/[^/]+$/.test(path)) {
    const member = team.find((item) => item.id === path.split('/')[2])
    if (member) member.active = false
    return send(response, 200, { ok: true })
  }

  if (request.method === 'GET' && path === '/reports/sales') return send(response, 200, { count: 1, total: 2490, avg: 2490, series: [{ date: now().slice(0, 10), value: 2490 }] })
  if (request.method === 'GET' && path === '/reports/funnel') return send(response, 200, pipelines[0].stages.map((stage) => ({ stage: stage.name, color: stage.color, count: stage.deals.length })))
  if (request.method === 'GET' && path === '/reports/agents') return send(response, 200, [{ name: team[1].name, avatar: null, count: 1, total: 2490 }])
  if (request.method === 'GET' && path === '/financial/summary') return send(response, 200, { salesRevenue: 2490, salesCount: 1, invoicesPaid: { amount: 2490, count: 1 }, invoicesPending: { amount: 0, count: 0 } })
  if (request.method === 'GET' && path === '/financial/invoices') return send(response, 200, [{ id: 'invoice-preview', plan: 'Plano Pro', amount: 2490, status: 'PAID', dueAt: now(), paidAt: now(), createdAt: now() }])
  if (request.method === 'GET' && path === '/financial/revenue') return send(response, 200, [{ label: 'Ago', value: 2490 }])

  if (request.method === 'GET' && path === '/groups') {
    try {
      const instanceName = safeEvolutionInstance(url.searchParams.get('instanceId'))
      const payload = await evolution(`/group/fetchAllGroups/${instanceName}?getParticipants=true`)
      const rows = Array.isArray(payload) ? payload : payload?.groups || []
      return send(response, 200, rows.map((group) => evolutionGroup(group)))
    } catch (error) {
      return evolutionError(response, error, 'Não foi possível listar os grupos')
    }
  }
  if (request.method === 'GET' && path.startsWith('/groups/') && path.endsWith('/participants')) {
    try {
      const instanceName = safeEvolutionInstance(url.searchParams.get('instanceId'))
      const groupJid = decodeURIComponent(path.split('/')[2])
      const payload = await evolution(`/group/findGroupInfos/${instanceName}?groupJid=${encodeURIComponent(groupJid)}`)
      return send(response, 200, evolutionGroup(payload, true))
    } catch (error) {
      return evolutionError(response, error, 'Não foi possível carregar os participantes')
    }
  }
  if (request.method === 'POST' && path === '/groups/inspect') {
    try {
      const instanceName = safeEvolutionInstance(body.instanceId)
      const code = inviteCode(body.inviteLink)
      const payload = await evolution(`/group/findGroupInfos/${instanceName}?inviteCode=${encodeURIComponent(code)}`)
      return send(response, 200, { ...evolutionGroup(payload, true), inviteCode: code, joined: false })
    } catch (error) {
      return evolutionError(response, error, 'Não foi possível consultar o convite')
    }
  }
  if (request.method === 'POST' && path === '/groups/join') {
    if (body.membershipConfirmed !== true) return send(response, 400, { message: 'Confirme sua autorização para entrar no grupo' })
    try {
      const instanceName = safeEvolutionInstance(body.instanceId)
      const code = inviteCode(body.inviteLink)
      const result = await evolution(`/group/acceptInviteCode/${instanceName}`, { method: 'POST', body: { inviteCode: code } })
      return send(response, 200, { joined: true, result })
    } catch (error) {
      return evolutionError(response, error, 'Não foi possível entrar no grupo')
    }
  }
  if (request.method === 'POST' && path === '/groups/import') {
    if (body.consentConfirmed !== true) return send(response, 400, { message: 'Confirme a autorização dos contatos selecionados' })
    try {
      const instanceName = safeEvolutionInstance(body.instanceId)
      const payload = await evolution(`/group/findGroupInfos/${instanceName}?groupJid=${encodeURIComponent(body.groupJid || '')}`)
      const group = evolutionGroup(payload, true)
      const selected = new Set(Array.isArray(body.participantIds) ? body.participantIds.map(String) : [])
      const importedAt = now()
      let created = 0
      const imported = evolutionParticipants(payload).filter((participant) => participant.canImport && selected.has(participant.id)).map((participant, index) => {
        const existing = contacts.find((contact) => contact.phone === participant.phone)
        const groupRef = { id: group.jid, name: group.subject, importedAt }
        if (existing) {
          existing.customFields = existing.customFields && typeof existing.customFields === 'object' ? existing.customFields : {}
          const refs = contactGroupLists(existing).filter((ref) => ref.id !== group.jid)
          existing.customFields.groupLists = [...refs, groupRef]
          return existing
        }
        created++
        const contact = { id: `group-contact-${Date.now()}-${index}`, name: participant.name, phone: participant.phone, email: null, tags: ['Grupo WhatsApp'], status: 'ACTIVE', source: 'WHATSAPP_GROUP', customFields: { groupLists: [groupRef] }, createdAt: importedAt }
        contacts.push(contact)
        return contact
      })
      return send(response, 200, { created, total: imported.length, contacts: imported, groupList: { id: group.jid, name: group.subject } })
    } catch (error) {
      return evolutionError(response, error, 'Não foi possível importar os participantes')
    }
  }

  return send(response, 404, { message: 'Rota não disponível no preview local' })
})

const sockets = new WebSocketServer({ noServer: true })
server.on('upgrade', (request, socket, head) => {
  sockets.handleUpgrade(request, socket, head, (client) => {
    client.send(JSON.stringify({ event: 'connected' }))
  })
})

server.listen(3001, '127.0.0.1', () => {
  console.log('API de preview local em http://localhost:3001')
})
