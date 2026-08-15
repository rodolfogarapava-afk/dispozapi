import axios from 'axios'
import { PrismaClient } from '@prisma/client'
import { ContactService } from '../contacts/contacts.service'

const prisma = new PrismaClient()
const contacts = new ContactService()
const evo = axios.create({
  baseURL: process.env.EVOLUTION_API_URL,
  headers: { apikey: process.env.EVOLUTION_API_KEY },
  timeout: 30000,
})

const INVITE_CODE_RE = /^[A-Za-z0-9_-]{16,32}$/

function inviteCodeFrom(input: string) {
  const value = String(input || '').trim()
  const code = value.includes('chat.whatsapp.com/')
    ? value.split('chat.whatsapp.com/')[1]?.split(/[?#/]/)[0]
    : value
  if (!code || !INVITE_CODE_RE.test(code)) {
    throw { statusCode: 400, message: 'Informe um link de convite válido do WhatsApp' }
  }
  return code
}

function participantsFrom(group: any) {
  const raw = Array.isArray(group?.participants)
    ? group.participants
    : Array.isArray(group?.Participants)
      ? group.Participants
      : []

  return raw.map((participant: any) => {
    const jid = String(participant?.id || participant?.jid || participant?.phoneNumber || '')
    const phone = jid.includes('@lid') ? '' : jid.split('@')[0].replace(/\D/g, '')
    return {
      id: jid,
      phone,
      name: String(participant?.name || participant?.pushName || participant?.notify || phone || 'Participante'),
      role: participant?.admin === 'superadmin' ? 'Proprietário' : participant?.admin ? 'Admin' : 'Membro',
      canImport: /^\d{10,15}$/.test(phone),
    }
  })
}

function normalizeGroup(group: any, includeParticipants = false) {
  const participants = participantsFrom(group)
  const jid = String(group?.id || group?.groupJid || group?.remoteJid || group?.jid || '')
  return {
    jid,
    subject: String(group?.subject || group?.name || group?.title || 'Grupo sem nome'),
    description: String(group?.desc || group?.description || ''),
    pictureUrl: group?.pictureUrl || group?.profilePicUrl || null,
    participantCount: participants.length || Number(group?.size || group?.participantCount || 0),
    role: group?.announce ? 'Somente admins' : 'Participante',
    participants: includeParticipants ? participants : undefined,
  }
}

export class GroupsService {
  private async instance(orgId: string, instanceId: string) {
    const instance = await prisma.whatsappInstance.findFirst({
      where: { id: instanceId, organizationId: orgId },
    })
    if (!instance) throw { statusCode: 404, message: 'Instância do WhatsApp não encontrada' }
    return { ...instance, apiName: `${instance.organizationId}_${instance.name}` }
  }

  private evolutionError(error: any, fallback: string): never {
    const message = error?.response?.data?.response?.message
      || error?.response?.data?.message
      || error?.message
      || fallback
    throw { statusCode: error?.response?.status === 404 ? 404 : 502, message: Array.isArray(message) ? message.join(', ') : String(message) }
  }

  async list(orgId: string, instanceId: string, search = '') {
    const instance = await this.instance(orgId, instanceId)
    try {
      const response = await evo.get(`/group/fetchAllGroups/${instance.apiName}`, {
        params: { getParticipants: true },
      })
      const raw = Array.isArray(response.data) ? response.data : response.data?.groups || []
      const term = search.trim().toLocaleLowerCase('pt-BR')
      return raw
        .map((group: any) => normalizeGroup(group))
        .filter((group: any) => !term || `${group.subject} ${group.description}`.toLocaleLowerCase('pt-BR').includes(term))
    } catch (error) {
      this.evolutionError(error, 'Não foi possível listar os grupos desta conta')
    }
  }

  async inspectInvite(orgId: string, data: { instanceId?: string; inviteLink?: string }) {
    const instance = await this.instance(orgId, String(data.instanceId || ''))
    const inviteCode = inviteCodeFrom(String(data.inviteLink || ''))
    try {
      const response = await evo.get(`/group/findGroupInfos/${instance.apiName}`, { params: { inviteCode } })
      return { ...normalizeGroup(response.data, true), inviteCode, joined: false }
    } catch (error) {
      this.evolutionError(error, 'Não foi possível consultar este convite')
    }
  }

  async join(orgId: string, data: { instanceId?: string; inviteLink?: string; membershipConfirmed?: boolean }) {
    if (data.membershipConfirmed !== true) {
      throw { statusCode: 400, message: 'Confirme que você tem autorização para entrar no grupo' }
    }
    const instance = await this.instance(orgId, String(data.instanceId || ''))
    const inviteCode = inviteCodeFrom(String(data.inviteLink || ''))
    try {
      const response = await evo.post(`/group/acceptInviteCode/${instance.apiName}`, { inviteCode })
      return { joined: true, inviteCode, result: response.data }
    } catch (error) {
      this.evolutionError(error, 'Não foi possível entrar no grupo')
    }
  }

  async participants(orgId: string, instanceId: string, groupJid: string) {
    const instance = await this.instance(orgId, instanceId)
    if (!groupJid?.includes('@g.us')) throw { statusCode: 400, message: 'Identificador de grupo inválido' }
    try {
      const response = await evo.get(`/group/findGroupInfos/${instance.apiName}`, { params: { groupJid } })
      return normalizeGroup(response.data, true)
    } catch (error) {
      this.evolutionError(error, 'Não foi possível carregar os participantes')
    }
  }

  async importParticipants(orgId: string, data: {
    instanceId?: string
    groupJid?: string
    participantIds?: string[]
    consentConfirmed?: boolean
  }) {
    if (data.consentConfirmed !== true) {
      throw { statusCode: 400, message: 'Confirme que os contatos autorizaram o recebimento de mensagens' }
    }
    const group = await this.participants(orgId, String(data.instanceId || ''), String(data.groupJid || '')) as any
    const selected = new Set((data.participantIds || []).slice(0, 500).map(String))
    const rows = (group.participants || [])
      .filter((participant: any) => participant.canImport && selected.has(participant.id))
      .map((participant: any) => ({ name: participant.name, phone: participant.phone }))

    if (!rows.length) throw { statusCode: 400, message: 'Selecione ao menos um participante com número disponível' }
    return contacts.bulkImport(orgId, rows, {
      consentConfirmed: true,
      source: 'WHATSAPP_GROUP',
      consentSource: `Grupo: ${group.subject}`,
      groupList: { id: group.jid, name: group.subject, instanceId: String(data.instanceId || '') },
    })
  }
}
