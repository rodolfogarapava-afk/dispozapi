import { PrismaClient } from '@prisma/client'
import { WhatsappService } from '../whatsapp/whatsapp.service'
import { emitToOrg } from '../../common/ws-connections'
import { readMediaBase64, storeBuffer } from '../whatsapp/media.util'
import { getPlanDefinition, planLimitMessage } from '../../common/plan-limits'

const prisma = new PrismaClient()
const whatsapp = new WhatsappService()

export interface CadenceConfig {
  minDelayMs: number
  maxDelayMs: number
  pauseEvery: number
  pauseMs: number
  maxPerRun: number
}

export interface CampaignStep {
  id?: string
  text?: string
  attachment?: {
    url: string
    fileName: string
    mimetype: string
    kind: 'image' | 'audio' | 'video' | 'document'
  }
}

interface CampaignContent {
  version: 1
  messages: CampaignStep[]
  consentConfirmed: true
  instanceId?: string
  instanceName?: string
}

export const DEFAULT_CADENCE: CadenceConfig = {
  minDelayMs: 15000,
  maxDelayMs: 30000,
  pauseEvery: 20,
  pauseMs: 180000,
  maxPerRun: 100,
}

const CONTENT_PREFIX = '__ZAPSHARK_SEQUENCE_V1__:'
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const rand = (min: number, max: number) => Math.floor(min + Math.random() * Math.max(1, max - min + 1))

const running = new Set<string>()

function clamp(value: unknown, min: number, max: number, fallback: number) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, Math.round(parsed))) : fallback
}

function sanitizeCadence(input: Partial<CadenceConfig> = {}): CadenceConfig {
  const minDelayMs = clamp(input.minDelayMs, 5000, 10 * 60 * 1000, DEFAULT_CADENCE.minDelayMs)
  const maxDelayMs = clamp(input.maxDelayMs, minDelayMs, 15 * 60 * 1000, DEFAULT_CADENCE.maxDelayMs)
  return {
    minDelayMs,
    maxDelayMs,
    pauseEvery: clamp(input.pauseEvery, 0, 250, DEFAULT_CADENCE.pauseEvery),
    pauseMs: clamp(input.pauseMs, 0, 60 * 60 * 1000, DEFAULT_CADENCE.pauseMs),
    maxPerRun: clamp(input.maxPerRun, 1, 250, DEFAULT_CADENCE.maxPerRun),
  }
}

function parseContent(raw: string): CampaignContent {
  if (raw.startsWith(CONTENT_PREFIX)) {
    try {
      const parsed = JSON.parse(raw.slice(CONTENT_PREFIX.length)) as CampaignContent
      if (Array.isArray(parsed.messages) && parsed.messages.length) return parsed
    } catch {
      // Campanhas legadas continuam funcionando como mensagem única.
    }
  }
  return {
    version: 1,
    messages: [{ text: raw }],
    consentConfirmed: true,
  }
}

function serializeContent(content: CampaignContent) {
  return `${CONTENT_PREFIX}${JSON.stringify(content)}`
}

function presentCampaign<T extends { message: string }>(campaign: T) {
  const content = parseContent(campaign.message)
  return {
    ...campaign,
    message: content.messages.map((step) => step.text).filter(Boolean).join(' · '),
    messages: content.messages,
    instanceId: content.instanceId || null,
    instanceName: content.instanceName || null,
  }
}

function normalizeMessages(messages: CampaignStep[] | undefined, legacyMessage?: string): CampaignStep[] {
  const input = Array.isArray(messages) && messages.length ? messages : [{ text: legacyMessage || '' }]
  const normalized = input.slice(0, 1).map((step, index) => {
    const text = String(step?.text || '').trim().slice(0, 4096)
    const attachment = step?.attachment
    const safeAttachment = attachment?.url?.startsWith('/whatsapp/media/')
      ? {
          url: attachment.url,
          fileName: String(attachment.fileName || `anexo-${index + 1}`).slice(0, 160),
          mimetype: String(attachment.mimetype || 'application/octet-stream').slice(0, 100),
          kind: attachment.kind,
        }
      : undefined
    return { id: String(step?.id || index + 1), text, attachment: safeAttachment }
  }).filter((step) => Boolean(step.text || step.attachment))

  if (!normalized.length) throw { statusCode: 400, message: 'Adicione ao menos uma mensagem ou anexo' }
  return normalized
}

export class CampaignService {
  async getAntiSpam(orgId: string): Promise<CadenceConfig> {
    const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { settings: true } })
    const saved = (org?.settings as any)?.campaign || {}
    return sanitizeCadence({ ...DEFAULT_CADENCE, ...saved })
  }

  async saveAntiSpam(orgId: string, cfg: Partial<CadenceConfig>) {
    const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { settings: true } })
    const campaign = sanitizeCadence({ ...((org?.settings as any)?.campaign || {}), ...cfg })
    const settings = { ...((org?.settings as any) || {}), campaign }
    await prisma.organization.update({ where: { id: orgId }, data: { settings } })
    return campaign
  }

  async uploadAsset(data: { fileBase64?: string; mimetype?: string; fileName?: string }) {
    if (!data.fileBase64 || !data.mimetype) throw { statusCode: 400, message: 'Arquivo inválido' }
    const buffer = Buffer.from(data.fileBase64, 'base64')
    if (!buffer.length || buffer.length > 10 * 1024 * 1024) {
      throw { statusCode: 400, message: 'O anexo deve ter no máximo 10 MB' }
    }
    const saved = await storeBuffer(buffer, data.mimetype)
    return {
      url: saved.url,
      fileName: String(data.fileName || saved.file).slice(0, 160),
      mimetype: saved.mimetype,
      kind: saved.kind,
    }
  }

  async list(orgId: string) {
    const campaigns = await prisma.campaign.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { contacts: true } } },
    })
    return campaigns.map(presentCampaign)
  }

  async get(id: string, orgId: string) {
    const campaign = await prisma.campaign.findFirst({
      where: { id, organizationId: orgId },
      include: {
        contacts: { include: { contact: { select: { id: true, name: true, phone: true } } } },
      },
    })
    if (!campaign) throw { statusCode: 404, message: 'Campanha não encontrada' }
    return presentCampaign(campaign)
  }

  async create(orgId: string, data: {
    name: string
    message?: string
    messages?: CampaignStep[]
    contactIds: string[]
    instanceId?: string
    scheduledAt?: string
    consentConfirmed?: boolean
  }) {
    if (!data.name?.trim()) throw { statusCode: 400, message: 'Informe o nome da campanha' }
    if (data.consentConfirmed !== true) {
      throw { statusCode: 400, message: 'Confirme que os destinatários autorizaram o contato' }
    }

    const ids = Array.from(new Set(Array.isArray(data.contactIds) ? data.contactIds : []))
    if (!ids.length) throw { statusCode: 400, message: 'Selecione ao menos um contato' }

    const contacts = await prisma.contact.findMany({
      where: { id: { in: ids }, organizationId: orgId, status: 'ACTIVE' },
      select: { id: true },
    })
    if (!contacts.length) throw { statusCode: 400, message: 'Nenhum contato ativo foi selecionado' }

    const messages = normalizeMessages(data.messages, data.message)
    const instances = await whatsapp.listInstances(orgId)
    const instance = instances.find((item: any) => item.id === String(data.instanceId || ''))
    if (!instance) throw { statusCode: 400, message: 'Selecione uma instância do WhatsApp' }
    if (instance.status !== 'CONNECTED') {
      throw { statusCode: 400, message: 'A instância selecionada não está conectada' }
    }
    const content: CampaignContent = {
      version: 1,
      messages,
      consentConfirmed: true,
      instanceId: instance.id,
      instanceName: instance.name,
    }

    const campaign = await prisma.campaign.create({
      data: {
        name: data.name.trim().slice(0, 120),
        message: serializeContent(content),
        mediaUrl: messages.find((step) => step.attachment)?.attachment?.url || null,
        scheduledAt: data.scheduledAt ? new Date(data.scheduledAt) : null,
        status: data.scheduledAt ? 'SCHEDULED' : 'DRAFT',
        organizationId: orgId,
        contacts: { create: contacts.map((contact) => ({ contactId: contact.id, status: 'PENDING' as any })) },
      },
      include: { _count: { select: { contacts: true } } },
    })
    return presentCampaign(campaign)
  }

  async remove(id: string, orgId: string) {
    await this.get(id, orgId)
    running.delete(id)
    await prisma.campaign.delete({ where: { id } })
    return { message: 'Campanha removida' }
  }

  async pause(id: string, orgId: string) {
    await this.get(id, orgId)
    running.delete(id)
    await prisma.campaign.update({ where: { id }, data: { status: 'PAUSED' } })
    return { message: 'Campanha pausada' }
  }

  async start(id: string, orgId: string, overrides?: Partial<CadenceConfig>, requestedInstanceId?: string) {
    const campaign = await this.get(id, orgId)
    if (running.has(id)) throw { statusCode: 400, message: 'Campanha já está em execução' }

    const [organization, activeCampaigns] = await Promise.all([
      prisma.organization.findUnique({ where: { id: orgId }, select: { plan: true } }),
      prisma.campaign.count({ where: { organizationId: orgId, status: 'RUNNING', id: { not: id } } }),
    ])
    if (!organization) throw { statusCode: 404, message: 'Organização não encontrada' }
    const plan = getPlanDefinition(organization.plan)
    if (activeCampaigns >= plan.maxActiveCampaigns) {
      throw { statusCode: 403, message: planLimitMessage(plan, 'campanhas ativas ao mesmo tempo', plan.maxActiveCampaigns) }
    }

    const stored = await prisma.campaign.findUnique({ where: { id }, select: { message: true } })
    const content = parseContent(stored!.message)
    const instances = await whatsapp.listInstances(orgId)
    const selectedId = String(requestedInstanceId || content.instanceId || '')
    const instance = selectedId
      ? instances.find((item: any) => item.id === selectedId)
      : instances.find((item: any) => item.status === 'CONNECTED')
    if (!instance) throw { statusCode: 400, message: 'A instância selecionada não foi encontrada' }
    if (instance.status !== 'CONNECTED') {
      throw { statusCode: 400, message: `A instância "${instance.name}" não está conectada` }
    }

    const cadence = sanitizeCadence({ ...(await this.getAntiSpam(orgId)), ...(overrides || {}) })

    await prisma.campaign.update({ where: { id }, data: { status: 'RUNNING', startedAt: new Date(), finishedAt: null } })
    running.add(id)

    this.run(id, orgId, instance.id, content, cadence).catch(async (error) => {
      console.error('[campaign] erro no envio:', error?.message || error)
      await prisma.campaign.update({ where: { id }, data: { status: 'PAUSED' } }).catch(() => {})
      running.delete(id)
    })

    return { message: 'Campanha iniciada', config: cadence, campaign }
  }

  private async sendStep(instanceId: string, phone: string, name: string, step: CampaignStep) {
    const text = String(step.text || '').replace(/\{nome\}/gi, name)
    if (!step.attachment) {
      if (text) await whatsapp.sendMessage({ instanceId, to: phone, message: text })
      return
    }

    const file = step.attachment.url.split('/').pop() || ''
    const media = await readMediaBase64(file)
    if (!media) throw new Error(`Anexo indisponível: ${step.attachment.fileName}`)
    await whatsapp.sendMedia({
      instanceId,
      to: phone,
      fileBase64: media.base64,
      mimetype: step.attachment.mimetype || media.mimetype,
      caption: text || undefined,
      fileName: step.attachment.fileName,
      asAudio: step.attachment.kind === 'audio',
    })
  }

  private async run(id: string, orgId: string, instanceId: string, content: CampaignContent, cadence: CadenceConfig) {
    const pending = await prisma.campaignContact.findMany({
      where: { campaignId: id, status: 'PENDING' },
      include: { contact: { select: { id: true, name: true, phone: true } } },
      take: cadence.maxPerRun,
    })

    let sentThisRun = 0
    let failedThisRun = 0
    for (let index = 0; index < pending.length; index++) {
      if (!running.has(id)) break
      const campaignContact = pending[index]
      const phone = campaignContact.contact?.phone
      try {
        if (!phone) throw new Error('Contato sem telefone')
        for (let stepIndex = 0; stepIndex < content.messages.length; stepIndex++) {
          if (!running.has(id)) break
          const step = content.messages[stepIndex]
          await this.sendStep(instanceId, phone, campaignContact.contact?.name || '', step)
          if (stepIndex < content.messages.length - 1) await sleep(1500)
        }
        if (!running.has(id)) break
        await prisma.campaignContact.update({ where: { id: campaignContact.id }, data: { status: 'SENT', sentAt: new Date(), error: null } })
        sentThisRun++
      } catch (error: any) {
        await prisma.campaignContact.update({
          where: { id: campaignContact.id },
          data: { status: 'FAILED', error: String(error?.message || error).slice(0, 200) },
        })
        failedThisRun++
      }

      const [totalSent, totalFailed] = await Promise.all([
        prisma.campaignContact.count({ where: { campaignId: id, status: 'SENT' } }),
        prisma.campaignContact.count({ where: { campaignId: id, status: 'FAILED' } }),
      ])
      await prisma.campaign.update({ where: { id }, data: { totalSent, totalFailed } })
      emitToOrg(orgId, 'campaign_progress', {
        campaignId: id,
        sent: totalSent,
        failed: totalFailed,
        total: pending.length,
        index: index + 1,
      })

      if (index < pending.length - 1 && running.has(id)) {
        await sleep(rand(cadence.minDelayMs, cadence.maxDelayMs))
        if (cadence.pauseEvery > 0 && (index + 1) % cadence.pauseEvery === 0) await sleep(cadence.pauseMs)
      }
    }

    const [stillPending, totalSent, totalFailed] = await Promise.all([
      prisma.campaignContact.count({ where: { campaignId: id, status: 'PENDING' } }),
      prisma.campaignContact.count({ where: { campaignId: id, status: 'SENT' } }),
      prisma.campaignContact.count({ where: { campaignId: id, status: 'FAILED' } }),
    ])
    const wasPaused = !running.has(id)
    await prisma.campaign.update({
      where: { id },
      data: {
        totalSent,
        totalFailed,
        status: stillPending > 0 || wasPaused ? 'PAUSED' : 'FINISHED',
        finishedAt: stillPending === 0 && !wasPaused ? new Date() : null,
      },
    })
    running.delete(id)
    emitToOrg(orgId, 'campaign_done', { campaignId: id, sent: sentThisRun, failed: failedThisRun })
  }
}
