import { FastifyRequest, FastifyReply } from 'fastify'
import { ContactService } from './contacts.service'
const svc = new ContactService()
export class ContactController {
  async list(req: FastifyRequest, rep: FastifyReply) { return rep.send(await svc.list((req as any).user.orgId, req.query)) }
  async groupLists(req: FastifyRequest, rep: FastifyReply) { return rep.send(await svc.groupLists((req as any).user.orgId)) }
  async groupList(req: FastifyRequest, rep: FastifyReply) { return rep.send(await svc.groupList(decodeURIComponent((req.params as any).groupId), (req as any).user.orgId)) }
  async removeGroupList(req: FastifyRequest, rep: FastifyReply) { return rep.send(await svc.removeGroupList(decodeURIComponent((req.params as any).groupId), (req as any).user.orgId)) }
  async create(req: FastifyRequest, rep: FastifyReply) { return rep.status(201).send(await svc.create((req as any).user.orgId, req.body)) }
  async bulkImport(req: FastifyRequest, rep: FastifyReply) {
    const body = (req.body as any) || {}
    return rep.send(await svc.bulkImport((req as any).user.orgId, body.contacts || [], {
      consentConfirmed: body.consentConfirmed,
      consentSource: body.consentSource,
      source: body.source,
      groupList: body.groupList,
    }))
  }
  async findOne(req: FastifyRequest, rep: FastifyReply) { return rep.send(await svc.findOne((req.params as any).id, (req as any).user.orgId)) }
  async update(req: FastifyRequest, rep: FastifyReply) { return rep.send(await svc.update((req.params as any).id, (req as any).user.orgId, req.body)) }
  async remove(req: FastifyRequest, rep: FastifyReply) { return rep.send(await svc.remove((req.params as any).id, (req as any).user.orgId)) }
}
