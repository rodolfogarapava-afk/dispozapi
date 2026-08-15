import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

interface GroupListRef {
  id: string
  name: string
  importedAt: string
}

function groupRefs(customFields: unknown, createdAt?: Date): GroupListRef[] {
  const fields = (customFields && typeof customFields === 'object' ? customFields : {}) as Record<string, unknown>
  const refs = Array.isArray(fields.groupLists) ? fields.groupLists : []
  const normalized = refs.flatMap((value) => {
    const ref = value && typeof value === 'object' ? value as Record<string, unknown> : {}
    const id = String(ref.id || '').trim()
    const name = String(ref.name || '').trim()
    if (!id || !name) return []
    return [{ id, name, importedAt: String(ref.importedAt || createdAt?.toISOString() || new Date(0).toISOString()) }]
  })
  if (normalized.length) return normalized

  const legacySource = String(fields.consentSource || '')
  if (!legacySource.toLocaleLowerCase('pt-BR').startsWith('grupo:')) return []
  const name = legacySource.slice(legacySource.indexOf(':') + 1).trim()
  if (!name) return []
  const id = `legacy:${name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR').replace(/[^a-z0-9]+/g, '-')}`
  return [{ id, name, importedAt: String(fields.consentAt || createdAt?.toISOString() || new Date(0).toISOString()) }]
}

export class ContactService {
  async list(orgId: string, query: any) {
    const { page = 1, limit = 20, search, tags, status } = query
    const pageNum = Number(page); const limitNum = Number(limit)
    const where: any = { organizationId: orgId }
    if (search) where.OR = [{ name: { contains: search, mode: 'insensitive' } }, { email: { contains: search, mode: 'insensitive' } }, { phone: { contains: search } }]
    if (tags) where.tags = { hasSome: tags.split(',') }
    if (status) where.status = status
    const [data, total] = await Promise.all([
      prisma.contact.findMany({ where, skip: (pageNum - 1) * limitNum, take: limitNum, orderBy: { createdAt: 'desc' } }),
      prisma.contact.count({ where })
    ])
    return { data, total, page, limit, pages: Math.ceil(total / limit) }
  }
  async create(orgId: string, data: any) {
    return prisma.contact.create({ data: { ...data, organizationId: orgId } })
  }
  /**
   * Importa contatos em lote (ex: CSV de campanha). Dedup por telefone dentro da
   * org: reaproveita contatos existentes, cria os que faltam. Retorna a lista
   * final (id, name, phone) — o front usa os ids para já selecionar na campanha.
   */
  async bulkImport(
    orgId: string,
    rows: Array<{ name?: string; phone?: string; email?: string }>,
    options: { consentConfirmed?: boolean; consentSource?: string; source?: string; groupList?: { id: string; name: string; instanceId?: string } } = {},
  ) {
    if (options.consentConfirmed !== true) {
      throw { statusCode: 400, message: 'Confirme que os contatos autorizaram o recebimento de mensagens' }
    }
    const seen = new Set<string>()
    const clean = [] as Array<{ name: string; phone: string; email?: string }>
    for (const r of rows || []) {
      const phone = String(r.phone || '').replace(/\D/g, '')
      if (!phone || seen.has(phone)) continue
      seen.add(phone)
      clean.push({ name: (r.name || '').trim() || phone, phone, email: r.email?.trim() || undefined })
    }
    if (!clean.length) return { created: 0, total: 0, contacts: [] as Array<{ id: string; name: string; phone: string }> }

    const existing = await prisma.contact.findMany({
      where: { organizationId: orgId, phone: { in: clean.map((c) => c.phone) } },
      select: { id: true, name: true, phone: true, customFields: true },
    })
    const byPhone = new Map<string, { id: string; name: string; phone: string }>(
      existing.map((c) => [String(c.phone || '').replace(/\D/g, ''), { id: c.id, name: c.name, phone: c.phone }]),
    )

    const toCreate = clean.filter((c) => !byPhone.has(c.phone))
    if (toCreate.length) {
      const importedAt = new Date().toISOString()
      const groupList = options.groupList
        ? [{ id: String(options.groupList.id), name: String(options.groupList.name), importedAt }]
        : []
      const consent = {
        marketingConsent: true,
        consentAt: importedAt,
        consentSource: String(options.consentSource || options.source || 'IMPORTAÇÃO').slice(0, 120),
        groupLists: groupList,
      }
      await prisma.contact.createMany({
        data: toCreate.map((c) => ({
          organizationId: orgId,
          name: c.name,
          phone: c.phone,
          email: c.email,
          source: String(options.source || 'CSV').slice(0, 60),
          customFields: consent,
        })),
      })
      const created = await prisma.contact.findMany({
        where: { organizationId: orgId, phone: { in: toCreate.map((c) => c.phone) } },
        select: { id: true, name: true, phone: true },
      })
      for (const c of created) byPhone.set(String(c.phone || '').replace(/\D/g, ''), c)
    }

    if (existing.length) {
      const consentAt = new Date().toISOString()
      await prisma.$transaction(existing.map((contact) => prisma.contact.update({
        where: { id: contact.id },
        data: (() => {
          const fields = ((contact.customFields as Record<string, unknown>) || {})
          const lists = groupRefs(fields)
          if (options.groupList) {
            const next = { id: String(options.groupList.id), name: String(options.groupList.name), importedAt: consentAt }
            const index = lists.findIndex((item) => item.id === next.id)
            if (index >= 0) lists[index] = next
            else lists.push(next)
          }
          return { customFields: {
            ...fields,
            marketingConsent: true,
            consentAt,
            consentSource: String(options.consentSource || options.source || 'IMPORTAÇÃO').slice(0, 120),
            groupLists: lists,
          } as any }
        })(),
      })))
    }

    const contacts = clean.map((c) => byPhone.get(c.phone)).filter(Boolean) as Array<{ id: string; name: string; phone: string }>

    let persistedGroupList: { id: string; name: string; groupJid: string; importedAt: Date } | null = null
    if (options.groupList) {
      const groupJid = String(options.groupList.id || '').trim()
      const groupName = String(options.groupList.name || '').trim()
      if (groupJid && groupName) {
        persistedGroupList = await prisma.$transaction(async (tx) => {
          const list = await tx.groupContactList.upsert({
            where: { organizationId_groupJid: { organizationId: orgId, groupJid } },
            update: {
              name: groupName,
              instanceId: String(options.groupList?.instanceId || '').trim() || null,
              importedAt: new Date(),
            },
            create: {
              organizationId: orgId,
              groupJid,
              name: groupName,
              instanceId: String(options.groupList?.instanceId || '').trim() || null,
            },
          })
          if (contacts.length) {
            await tx.groupContactListMember.createMany({
              data: contacts.map((contact) => ({ listId: list.id, contactId: contact.id })),
              skipDuplicates: true,
            })
          }
          return list
        })
      }
    }

    return {
      created: toCreate.length,
      total: contacts.length,
      contacts,
      groupList: persistedGroupList ? {
        id: persistedGroupList.id,
        name: persistedGroupList.name,
        groupJid: persistedGroupList.groupJid,
        importedAt: persistedGroupList.importedAt,
      } : null,
    }
  }

  private async backfillLegacyGroupLists(orgId: string) {
    const rows = await prisma.contact.findMany({
      where: { organizationId: orgId },
      select: { id: true, customFields: true, createdAt: true },
    })
    const legacyLists = new Map<string, { name: string; importedAt: Date; contactIds: Set<string> }>()
    for (const contact of rows) {
      for (const ref of groupRefs(contact.customFields, contact.createdAt)) {
        const importedAt = new Date(ref.importedAt)
        const safeImportedAt = Number.isNaN(importedAt.getTime()) ? contact.createdAt : importedAt
        const list = legacyLists.get(ref.id) || { name: ref.name, importedAt: safeImportedAt, contactIds: new Set<string>() }
        list.name = ref.name
        if (safeImportedAt.getTime() > list.importedAt.getTime()) list.importedAt = safeImportedAt
        list.contactIds.add(contact.id)
        legacyLists.set(ref.id, list)
      }
    }
    if (!legacyLists.size) return

    await prisma.$transaction(async (tx) => {
      for (const [groupJid, legacy] of legacyLists) {
        const list = await tx.groupContactList.upsert({
          where: { organizationId_groupJid: { organizationId: orgId, groupJid } },
          update: { name: legacy.name },
          create: {
            organizationId: orgId,
            groupJid,
            name: legacy.name,
            importedAt: legacy.importedAt,
          },
        })
        await tx.groupContactListMember.createMany({
          data: Array.from(legacy.contactIds).map((contactId) => ({ listId: list.id, contactId })),
          skipDuplicates: true,
        })
      }
    })
  }

  async groupLists(orgId: string) {
    await this.backfillLegacyGroupLists(orgId)
    const lists = await prisma.groupContactList.findMany({
      where: { organizationId: orgId },
      orderBy: { importedAt: 'desc' },
      include: {
        _count: { select: { members: true } },
        members: {
          take: 5,
          orderBy: { addedAt: 'desc' },
          select: { contact: { select: { id: true, name: true, phone: true, avatar: true, status: true } } },
        },
      },
    })
    return lists.map((list) => ({
      id: list.id,
      name: list.name,
      groupJid: list.groupJid,
      instanceId: list.instanceId,
      importedAt: list.importedAt,
      contactCount: list._count.members,
      preview: list.members.map((member) => member.contact),
    }))
  }

  async groupList(id: string, orgId: string) {
    await this.backfillLegacyGroupLists(orgId)
    const list = await prisma.groupContactList.findFirst({
      where: { organizationId: orgId, OR: [{ id }, { groupJid: id }] },
    })
    if (!list) throw { statusCode: 404, message: 'Lista de grupo não encontrada' }
    const members = await prisma.groupContactListMember.findMany({
      where: { listId: list.id, list: { organizationId: orgId } },
      select: {
        contact: {
          select: { id: true, name: true, phone: true, email: true, avatar: true, tags: true, status: true, source: true, createdAt: true },
        },
      },
    })
    const contacts = members.map((member) => member.contact).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
    return {
      id: list.id,
      name: list.name,
      groupJid: list.groupJid,
      instanceId: list.instanceId,
      importedAt: list.importedAt,
      contactCount: contacts.length,
      contacts,
    }
  }

  async removeGroupList(id: string, orgId: string) {
    const removed = await prisma.groupContactList.deleteMany({
      where: { id, organizationId: orgId },
    })
    if (!removed.count) throw { statusCode: 404, message: 'Lista de grupo não encontrada' }
    return { success: true, id }
  }

  async findOne(id: string, orgId: string) {
    const c = await prisma.contact.findFirst({ where: { id, organizationId: orgId }, include: { activities: true, deals: { include: { stage: true } } } })
    if (!c) throw { statusCode: 404, message: 'Contato não encontrado' }
    return c
  }
  async update(id: string, orgId: string, data: any) {
    return prisma.contact.updateMany({ where: { id, organizationId: orgId }, data })
  }
  async remove(id: string, orgId: string) {
    return prisma.contact.deleteMany({ where: { id, organizationId: orgId } })
  }
}
