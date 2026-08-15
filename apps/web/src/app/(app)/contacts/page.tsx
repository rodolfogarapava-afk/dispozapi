'use client'

import Link from 'next/link'
import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import {
  ChevronLeft, ChevronRight, ContactRound, Download, Eye, FolderOpen,
  Loader2, Plus, Search, Trash2, Users, X,
} from 'lucide-react'
import { api } from '@/lib/api'
import { cn, formatPhone } from '@/lib/utils'
import { confirmToast } from '@/lib/confirm'
import { PageHeader } from '@/components/layout/page-header'

interface Contact {
  id: string
  name: string
  phone: string
  email?: string
  avatar?: string | null
  tags: string[]
  status: string
  source?: string
  createdAt: string
}

interface GroupListPreview {
  id: string
  name: string
  contactCount: number
  importedAt: string
  preview: Array<Pick<Contact, 'id' | 'name' | 'phone' | 'avatar' | 'status'>>
}

interface GroupListDetail {
  id: string
  name: string
  contactCount: number
  contacts: Contact[]
}

type ContactView = 'groups' | 'all'

const STATUS_COLOR: Record<string, string> = {
  ACTIVE: '#10B981', INACTIVE: '#6B7280', BLOCKED: '#EF4444',
}
const STATUS_LABEL: Record<string, string> = {
  ACTIVE: 'Ativo', INACTIVE: 'Inativo', BLOCKED: 'Bloqueado',
}
const AVATAR_TONES = [
  'from-primary to-blue-500', 'from-violet-500 to-fuchsia-500',
  'from-emerald-500 to-teal-500', 'from-amber-500 to-orange-500',
]

function normalizeContact(value: unknown, index: number): Contact {
  const contact = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const status = String(contact.status || 'ACTIVE').toUpperCase()
  return {
    id: String(contact.id || `contact-${index}`),
    name: String(contact.name || contact.phone || 'Contato sem nome'),
    phone: String(contact.phone || ''),
    email: contact.email ? String(contact.email) : undefined,
    avatar: contact.avatar ? String(contact.avatar) : null,
    tags: Array.isArray(contact.tags) ? contact.tags.map(String).filter(Boolean) : [],
    status: STATUS_LABEL[status] ? status : 'ACTIVE',
    source: contact.source ? String(contact.source) : undefined,
    createdAt: String(contact.createdAt || ''),
  }
}

function csvCell(value: unknown) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`
}

function downloadContactsCsv(name: string, contacts: Contact[]) {
  const rows = [
    ['Nome', 'Telefone', 'Email', 'Status', 'Grupo'],
    ...contacts.map((contact) => [contact.name, contact.phone, contact.email || '', STATUS_LABEL[contact.status] || contact.status, name]),
  ]
  const csv = `\uFEFF${rows.map((row) => row.map(csvCell).join(';')).join('\r\n')}`
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  const slug = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'grupo'
  link.href = url
  link.download = `contatos-${slug}-${new Date().toISOString().slice(0, 10)}.csv`
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function errorMessage(error: any, fallback: string) {
  return error?.response?.data?.message || error?.message || fallback
}

export default function ContactsPage() {
  const [view, setView] = useState<ContactView>('groups')
  const [contacts, setContacts] = useState<Contact[]>([])
  const [groupLists, setGroupLists] = useState<GroupListPreview[]>([])
  const [total, setTotal] = useState(0)
  const [search, setSearch] = useState('')
  const deferredSearch = useDeferredValue(search)
  const [page, setPage] = useState(1)
  const [pages, setPages] = useState(1)
  const [showModal, setShowModal] = useState(false)
  const [selected, setSelected] = useState<Contact | null>(null)
  const [form, setForm] = useState({ name: '', phone: '', email: '', tags: '', source: '' })
  const [isLoading, setIsLoading] = useState(false)
  const [loadingGroups, setLoadingGroups] = useState(true)
  const [saving, setSaving] = useState(false)
  const [activeGroup, setActiveGroup] = useState<GroupListDetail | null>(null)
  const [loadingGroup, setLoadingGroup] = useState(false)
  const [exportingGroupId, setExportingGroupId] = useState<string | null>(null)
  const [deletingGroupId, setDeletingGroupId] = useState<string | null>(null)
  const LIMIT = 15

  const loadContacts = useCallback(async () => {
    setIsLoading(true)
    try {
      const { data } = await api.get('/contacts', { params: { search, page, limit: LIMIT } })
      const rows = Array.isArray(data?.data) ? data.data : []
      setContacts(rows.map(normalizeContact))
      setTotal(Number(data?.total) || rows.length)
      setPages(Math.max(1, Number(data?.pages) || 1))
    } catch (error) {
      setContacts([])
      toast.error(errorMessage(error, 'Não foi possível carregar os contatos'))
    } finally {
      setIsLoading(false)
    }
  }, [page, search])

  const loadGroupLists = useCallback(async () => {
    setLoadingGroups(true)
    try {
      const response = await api.get('/contacts/group-lists')
      setGroupLists(Array.isArray(response.data) ? response.data : [])
    } catch (error) {
      setGroupLists([])
      toast.error(errorMessage(error, 'Não foi possível carregar as listas extraídas'))
    } finally {
      setLoadingGroups(false)
    }
  }, [])

  useEffect(() => { void loadGroupLists() }, [loadGroupLists])
  useEffect(() => { if (view === 'all') void loadContacts() }, [loadContacts, view])

  const filteredGroupLists = useMemo(() => {
    const term = deferredSearch.trim().toLocaleLowerCase('pt-BR')
    if (!term) return groupLists
    return groupLists.filter((list) => list.name.toLocaleLowerCase('pt-BR').includes(term))
  }, [deferredSearch, groupLists])

  const openCreate = () => {
    setSelected(null)
    setForm({ name: '', phone: '', email: '', tags: '', source: '' })
    setShowModal(true)
  }

  const openEdit = (contact: Contact) => {
    setSelected(contact)
    setForm({ name: contact.name, phone: contact.phone, email: contact.email || '', tags: contact.tags.join(', '), source: contact.source || '' })
    setShowModal(true)
  }

  const handleSave = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSaving(true)
    const payload = { ...form, tags: form.tags.split(',').map((tag) => tag.trim()).filter(Boolean) }
    try {
      if (selected) await api.patch(`/contacts/${encodeURIComponent(selected.id)}`, payload)
      else await api.post('/contacts', payload)
      setShowModal(false)
      toast.success(selected ? 'Contato atualizado' : 'Contato criado')
      await loadContacts()
    } catch (error) {
      toast.error(errorMessage(error, 'Erro ao salvar o contato'))
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (contact: Contact) => {
    const confirmed = await confirmToast(`Excluir "${contact.name}"?`, { confirmLabel: 'Excluir', danger: true })
    if (!confirmed) return
    try {
      await api.delete(`/contacts/${encodeURIComponent(contact.id)}`)
      toast.success('Contato excluído')
      await Promise.all([loadContacts(), loadGroupLists()])
    } catch (error) {
      toast.error(errorMessage(error, 'Erro ao excluir o contato'))
    }
  }

  const fetchGroup = async (list: GroupListPreview) => {
    const response = await api.get(`/contacts/group-lists/${encodeURIComponent(list.id)}`)
    return {
      ...response.data,
      contacts: (Array.isArray(response.data?.contacts) ? response.data.contacts : []).map(normalizeContact),
    } as GroupListDetail
  }

  const openGroup = async (list: GroupListPreview) => {
    setLoadingGroup(true)
    setActiveGroup({ id: list.id, name: list.name, contactCount: list.contactCount, contacts: [] })
    try {
      setActiveGroup(await fetchGroup(list))
    } catch (error) {
      setActiveGroup(null)
      toast.error(errorMessage(error, 'Não foi possível abrir a lista'))
    } finally {
      setLoadingGroup(false)
    }
  }

  const exportGroup = async (list: GroupListPreview, loadedContacts?: Contact[]) => {
    setExportingGroupId(list.id)
    try {
      const rows = loadedContacts || (await fetchGroup(list)).contacts
      downloadContactsCsv(list.name, rows)
      toast.success(`${rows.length} contatos exportados`)
    } catch (error) {
      toast.error(errorMessage(error, 'Não foi possível exportar a lista'))
    } finally {
      setExportingGroupId(null)
    }
  }

  const deleteGroupList = async (list: GroupListPreview) => {
    const confirmed = await confirmToast(`Excluir a lista "${list.name}"? Os contatos continuarão disponíveis no CRM.`, {
      confirmLabel: 'Excluir lista',
      danger: true,
    })
    if (!confirmed) return

    setDeletingGroupId(list.id)
    try {
      await api.delete(`/contacts/group-lists/${encodeURIComponent(list.id)}`)
      setGroupLists((current) => current.filter((item) => item.id !== list.id))
      setActiveGroup((current) => current?.id === list.id ? null : current)
      toast.success('Lista excluída. Os contatos foram mantidos no CRM.')
    } catch (error) {
      toast.error(errorMessage(error, 'Não foi possível excluir a lista'))
    } finally {
      setDeletingGroupId(null)
    }
  }

  const switchView = (next: ContactView) => {
    setView(next)
    setSearch('')
    setPage(1)
  }

  return (
    <div className="app-page space-y-5 pb-8">
      <PageHeader
        eyebrow="Central de contatos"
        title="Contatos"
        description={view === 'groups'
          ? 'Listas extraídas dos grupos, separadas pelo nome de origem.'
          : `${total.toLocaleString('pt-BR')} contatos cadastrados no CRM.`}
        icon={ContactRound}
        actions={<button type="button" onClick={openCreate} className="btn-primary w-full justify-center sm:w-auto"><Plus className="h-4 w-4" /> Novo contato</button>}
      />

      <div className="inline-flex w-full rounded-xl border border-border bg-[hsl(var(--surface-2))] p-1 sm:w-auto" role="tablist" aria-label="Visualização dos contatos">
        <button type="button" role="tab" aria-selected={view === 'groups'} onClick={() => switchView('groups')} className={cn('flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2 text-xs font-semibold transition sm:flex-none', view === 'groups' ? 'bg-gradient-to-r from-primary to-violet-500 text-white shadow-[0_5px_18px_-8px_hsl(var(--primary))]' : 'text-muted-foreground hover:text-foreground')}>
          <FolderOpen className="h-3.5 w-3.5" /> Por grupo <span className="rounded-full bg-black/15 px-1.5 py-0.5 text-[9px]">{groupLists.length}</span>
        </button>
        <button type="button" role="tab" aria-selected={view === 'all'} onClick={() => switchView('all')} className={cn('flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2 text-xs font-semibold transition sm:flex-none', view === 'all' ? 'bg-gradient-to-r from-primary to-violet-500 text-white shadow-[0_5px_18px_-8px_hsl(var(--primary))]' : 'text-muted-foreground hover:text-foreground')}>
          <Users className="h-3.5 w-3.5" /> Todos os contatos
        </button>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1) }} placeholder={view === 'groups' ? 'Buscar pelo nome do grupo…' : 'Buscar por nome, email ou telefone…'} className="app-input pl-10" />
      </div>

      {view === 'groups' ? (
        <GroupListsView lists={filteredGroupLists} loading={loadingGroups} exportingId={exportingGroupId} deletingId={deletingGroupId} onOpen={openGroup} onExport={exportGroup} onDelete={deleteGroupList} />
      ) : (
        <AllContactsView contacts={contacts} loading={isLoading} page={page} pages={pages} total={total} limit={LIMIT} onEdit={openEdit} onDelete={handleDelete} onPage={setPage} />
      )}

      {showModal ? (
        <ContactModal selected={selected} form={form} setForm={setForm} saving={saving} onClose={() => setShowModal(false)} onSave={handleSave} />
      ) : null}

      {activeGroup ? (
        <GroupDetailModal
          group={activeGroup}
          loading={loadingGroup}
          exporting={exportingGroupId === activeGroup.id}
          onClose={() => setActiveGroup(null)}
          onExport={() => void exportGroup({ ...activeGroup, importedAt: '', preview: [] }, activeGroup.contacts)}
        />
      ) : null}
    </div>
  )
}

function GroupListsView({ lists, loading, exportingId, deletingId, onOpen, onExport, onDelete }: {
  lists: GroupListPreview[]
  loading: boolean
  exportingId: string | null
  deletingId: string | null
  onOpen: (list: GroupListPreview) => void
  onExport: (list: GroupListPreview) => void
  onDelete: (list: GroupListPreview) => void
}) {
  if (loading) return <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 6 }, (_, index) => <div key={index} className="app-surface h-40 animate-pulse bg-accent/30" />)}</div>
  if (!lists.length) return (
    <div className="flex min-h-64 flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-[hsl(var(--surface-1))] px-6 text-center">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-violet-500/10 text-violet-400"><FolderOpen className="h-6 w-6" /></div>
      <h2 className="text-sm font-bold text-foreground">Nenhuma lista extraída</h2>
      <p className="mt-1 max-w-md text-xs leading-5 text-muted-foreground">Abra um grupo, selecione os participantes e importe. A lista aparecerá aqui automaticamente com o nome do grupo.</p>
      <Link href="/groups" className="mt-4 inline-flex items-center gap-2 rounded-xl border border-primary/25 bg-primary/10 px-4 py-2.5 text-xs font-semibold text-primary transition hover:bg-primary/15"><Users className="h-4 w-4" /> Ir para Grupos</Link>
    </div>
  )
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {lists.map((list) => (
        <article key={list.id} className="app-surface flex min-h-40 flex-col p-4 transition hover:border-violet-500/30 sm:p-5">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-500/10 text-violet-400"><Users className="h-4 w-4" /></div>
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-sm font-bold text-foreground" title={list.name}>{list.name}</h2>
              <p className="mt-0.5 text-[11px] text-muted-foreground">{list.contactCount} {list.contactCount === 1 ? 'contato' : 'contatos'}</p>
            </div>
          </div>
          <div className="my-4 flex min-h-8 items-center">
            <div className="flex -space-x-2">
              {list.preview.slice(0, 4).map((contact, index) => <ContactAvatar key={contact.id} contact={contact} index={index} />)}
            </div>
            {list.contactCount > 4 ? <span className="ml-3 text-[10px] font-medium text-muted-foreground">+{list.contactCount - 4}</span> : null}
          </div>
          <div className="mt-auto grid grid-cols-2 gap-2">
            <button type="button" onClick={() => onOpen(list)} className="inline-flex items-center justify-center gap-2 rounded-xl border border-border px-3 py-2 text-xs font-semibold text-foreground transition hover:bg-accent"><Eye className="h-3.5 w-3.5" /> Ver</button>
            <button type="button" onClick={() => onExport(list)} disabled={exportingId === list.id} className="inline-flex items-center justify-center gap-2 rounded-xl border border-border px-3 py-2 text-xs font-semibold text-foreground transition hover:bg-accent disabled:opacity-50">{exportingId === list.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />} Exportar</button>
            <button type="button" onClick={() => onDelete(list)} disabled={deletingId === list.id} className="col-span-2 inline-flex items-center justify-center gap-2 rounded-xl border border-red-500/25 bg-red-500/[0.06] px-3 py-2 text-xs font-semibold text-red-400 transition hover:border-red-500/40 hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-50">{deletingId === list.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />} Excluir lista</button>
          </div>
        </article>
      ))}
    </div>
  )
}

function ContactAvatar({ contact, index }: { contact: Pick<Contact, 'name' | 'avatar'>; index: number }) {
  if (contact.avatar) return <span role="img" aria-label={contact.name} className="h-8 w-8 rounded-full border-2 border-[hsl(var(--surface-1))] bg-cover bg-center" style={{ backgroundImage: `url(${JSON.stringify(contact.avatar).slice(1, -1)})` }} />
  return <span title={contact.name} className={cn('flex h-8 w-8 items-center justify-center rounded-full border-2 border-[hsl(var(--surface-1))] bg-gradient-to-br text-[9px] font-bold text-white', AVATAR_TONES[index % AVATAR_TONES.length])}>{contact.name.slice(0, 2).toUpperCase()}</span>
}

function AllContactsView({ contacts, loading, page, pages, total, limit, onEdit, onDelete, onPage }: {
  contacts: Contact[]; loading: boolean; page: number; pages: number; total: number; limit: number
  onEdit: (contact: Contact) => void; onDelete: (contact: Contact) => void; onPage: (page: number | ((current: number) => number)) => void
}) {
  return (
    <>
      <div className="app-surface overflow-x-auto">
        <table className="w-full min-w-[820px]">
          <thead><tr className="border-b border-border">{['Nome', 'Telefone', 'Email', 'Tags', 'Fonte', 'Status', ''].map((heading) => <th key={heading} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">{heading}</th>)}</tr></thead>
          <tbody>
            {loading ? Array.from({ length: 5 }, (_, index) => <tr key={index} className="border-b border-border/50">{Array.from({ length: 7 }, (_, cell) => <td key={cell} className="px-4 py-3"><div className="h-4 animate-pulse rounded bg-border" /></td>)}</tr>) : null}
            {!loading && !contacts.length ? <tr><td colSpan={7} className="px-4 py-12 text-center text-sm text-muted-foreground">Nenhum contato encontrado</td></tr> : null}
            {!loading ? contacts.map((contact) => (
              <tr key={contact.id} className="border-b border-border/30 transition hover:bg-primary/[0.03]">
                <td className="px-4 py-3"><div className="flex items-center gap-2.5"><ContactAvatar contact={contact} index={0} /><span className="text-sm font-medium text-foreground">{contact.name}</span></div></td>
                <td className="px-4 py-3 text-sm text-muted-foreground">{formatPhone(contact.phone)}</td>
                <td className="px-4 py-3 text-sm text-muted-foreground">{contact.email || '—'}</td>
                <td className="px-4 py-3"><div className="flex flex-wrap gap-1">{contact.tags.slice(0, 2).map((tag) => <span key={tag} className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">{tag}</span>)}{contact.tags.length > 2 ? <span className="text-[10px] text-muted-foreground">+{contact.tags.length - 2}</span> : null}</div></td>
                <td className="px-4 py-3 text-sm text-muted-foreground">{contact.source || '—'}</td>
                <td className="px-4 py-3"><span className="rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ background: `${STATUS_COLOR[contact.status]}20`, color: STATUS_COLOR[contact.status] }}>{STATUS_LABEL[contact.status] || contact.status}</span></td>
                <td className="px-4 py-3"><div className="flex gap-1"><button type="button" onClick={() => onEdit(contact)} className="rounded-lg px-2 py-1 text-xs text-muted-foreground transition hover:bg-accent hover:text-foreground">Editar</button><button type="button" onClick={() => void onDelete(contact)} className="rounded-lg px-2 py-1 text-xs text-muted-foreground transition hover:text-rose-400">Excluir</button></div></td>
              </tr>
            )) : null}
          </tbody>
        </table>
      </div>
      {pages > 1 ? <div className="flex items-center justify-between"><p className="text-xs text-muted-foreground">Mostrando {(page - 1) * limit + 1}–{Math.min(page * limit, total)} de {total}</p><div className="flex gap-1"><button type="button" onClick={() => onPage((current) => Math.max(1, current - 1))} disabled={page === 1} className="rounded-lg border border-border p-1.5 transition hover:bg-accent disabled:opacity-40"><ChevronLeft className="h-4 w-4" /></button><button type="button" onClick={() => onPage((current) => Math.min(pages, current + 1))} disabled={page === pages} className="rounded-lg border border-border p-1.5 transition hover:bg-accent disabled:opacity-40"><ChevronRight className="h-4 w-4" /></button></div></div> : null}
    </>
  )
}

function GroupDetailModal({ group, loading, exporting, onClose, onExport }: { group: GroupListDetail; loading: boolean; exporting: boolean; onClose: () => void; onExport: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3 backdrop-blur-sm sm:p-6" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div className="app-surface flex max-h-[88vh] w-full max-w-4xl flex-col overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b border-border p-4 sm:p-5">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-500/10 text-violet-400"><Users className="h-4 w-4" /></div>
          <div className="min-w-0 flex-1"><h2 className="truncate text-base font-bold text-foreground">{group.name}</h2><p className="text-[11px] text-muted-foreground">{group.contactCount} contatos extraídos</p></div>
          <button type="button" onClick={onExport} disabled={loading || exporting} className="inline-flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-xs font-semibold text-foreground transition hover:bg-accent disabled:opacity-50">{exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />} Exportar CSV</button>
          <button type="button" onClick={onClose} aria-label="Fechar" className="rounded-lg p-2 text-muted-foreground transition hover:bg-accent hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>
        <div className="overflow-auto">
          {loading ? <div className="flex min-h-48 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div> : (
            <table className="w-full min-w-[620px]"><thead><tr className="border-b border-border bg-[hsl(var(--surface-2))]">{['Nome', 'Telefone', 'Email', 'Status'].map((heading) => <th key={heading} className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{heading}</th>)}</tr></thead><tbody>{group.contacts.map((contact) => <tr key={contact.id} className="border-b border-border/40"><td className="px-4 py-3 text-xs font-medium text-foreground">{contact.name}</td><td className="px-4 py-3 text-xs text-muted-foreground">{formatPhone(contact.phone)}</td><td className="px-4 py-3 text-xs text-muted-foreground">{contact.email || '—'}</td><td className="px-4 py-3"><span className="rounded-full px-2 py-0.5 text-[9px] font-semibold" style={{ background: `${STATUS_COLOR[contact.status]}20`, color: STATUS_COLOR[contact.status] }}>{STATUS_LABEL[contact.status] || contact.status}</span></td></tr>)}</tbody></table>
          )}
        </div>
      </div>
    </div>
  )
}

function ContactModal({ selected, form, setForm, saving, onClose, onSave }: {
  selected: Contact | null
  form: { name: string; phone: string; email: string; tags: string; source: string }
  setForm: React.Dispatch<React.SetStateAction<{ name: string; phone: string; email: string; tags: string; source: string }>>
  saving: boolean
  onClose: () => void
  onSave: (event: React.FormEvent<HTMLFormElement>) => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div className="app-surface w-full max-w-md p-6">
        <div className="mb-5 flex items-center justify-between"><h2 className="text-base font-semibold text-foreground">{selected ? 'Editar contato' : 'Novo contato'}</h2><button type="button" onClick={onClose} className="rounded-lg p-1.5 transition hover:bg-accent"><X className="h-4 w-4" /></button></div>
        <form onSubmit={onSave} className="space-y-3">
          {[
            { key: 'name', label: 'Nome completo *', type: 'text', placeholder: 'Maria Silva' },
            { key: 'phone', label: 'Telefone (com DDD) *', type: 'text', placeholder: '11999998888' },
            { key: 'email', label: 'Email', type: 'email', placeholder: 'maria@email.com' },
            { key: 'tags', label: 'Tags (separe por vírgula)', type: 'text', placeholder: 'VIP, Cliente' },
            { key: 'source', label: 'Fonte', type: 'text', placeholder: 'WhatsApp, Instagram…' },
          ].map(({ key, label, type, placeholder }) => <div key={key}><label htmlFor={`contact-${key}`} className="mb-1 block text-xs font-medium text-muted-foreground">{label}</label><input id={`contact-${key}`} type={type} value={form[key as keyof typeof form]} onChange={(event) => setForm((current) => ({ ...current, [key]: event.target.value }))} placeholder={placeholder} required={key === 'name' || key === 'phone'} className="app-input py-2" /></div>)}
          <div className="flex gap-2 pt-2"><button type="button" onClick={onClose} className="flex-1 rounded-lg border border-border py-2.5 text-sm text-muted-foreground transition hover:bg-accent">Cancelar</button><button type="submit" disabled={saving} className="btn-primary flex-1 justify-center disabled:opacity-50">{saving ? 'Salvando…' : selected ? 'Salvar' : 'Criar contato'}</button></div>
        </form>
      </div>
    </div>
  )
}
