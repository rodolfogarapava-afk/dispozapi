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
    options: { consentConfirmed?: boolean; consentSource?: string; source?: string; groupList?: { id: string; name: string } } = {},
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
    return { created: toCreate.length, total: contacts.length, contacts }
  }

  async groupLists(orgId: string) {
    const rows = await prisma.contact.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, name: true, phone: true, avatar: true, status: true, customFields: true, createdAt: true },
    })
    const lists = new Map<string, { id: string; name: string; importedAt: string; contacts: Array<{ id: string; name: string; phone: string; avatar: string | null; status: string }> }>()
    for (const contact of rows) {
      for (const ref of groupRefs(contact.customFields, contact.createdAt)) {
        const list = lists.get(ref.id) || { id: ref.id, name: ref.name, importedAt: ref.importedAt, contacts: [] }
        list.name = ref.name
        if (new Date(ref.importedAt).getTime() > new Date(list.importedAt).getTime()) list.importedAt = ref.importedAt
        list.contacts.push({ id: contact.id, name: contact.name, phone: contact.phone, avatar: contact.avatar, status: contact.status })
        lists.set(ref.id, list)
      }
    }
    return Array.from(lists.values())
      .map((list) => ({ ...list, contactCount: list.contacts.length, preview: list.contacts.slice(0, 5), contacts: undefined }))
      .sort((a, b) => new Date(b.importedAt).getTime() - new Date(a.importedAt).getTime())
  }

  async groupList(id: string, orgId: string) {
    const rows = await prisma.contact.findMany({
      where: { organizationId: orgId },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, phone: true, email: true, avatar: true, tags: true, status: true, customFields: true, createdAt: true },
    })
    const matched = rows.filter((contact) => groupRefs(contact.customFields, contact.createdAt).some((ref) => ref.id === id))
    if (!matched.length) throw { statusCode: 404, message: 'Lista de grupo não encontrada' }
    const reference = groupRefs(matched[0].customFields, matched[0].createdAt).find((ref) => ref.id === id)!
    return {
      id,
      name: reference.name,
      contactCount: matched.length,
      contacts: matched.map(({ customFields: _customFields, ...contact }) => contact),
    }
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
