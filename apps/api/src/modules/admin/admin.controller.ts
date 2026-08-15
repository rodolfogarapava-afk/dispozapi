import { FastifyRequest, FastifyReply } from 'fastify'
import { AdminService } from './admin.service'

const svc = new AdminService()

export class AdminController {
  async overview(_req: FastifyRequest, rep: FastifyReply) { return rep.send(await svc.overview()) }
  async organizations(req: FastifyRequest, rep: FastifyReply) { return rep.send(await svc.organizations(req.query)) }
  async organizationDetail(req: FastifyRequest, rep: FastifyReply) { return rep.send(await svc.organizationDetail((req.params as any).id)) }
  async updateOrganization(req: FastifyRequest, rep: FastifyReply) { return rep.send(await svc.updateOrganization((req.params as any).id, req.body)) }
  async growth(req: FastifyRequest, rep: FastifyReply) { return rep.send(await svc.growth(req.query)) }

  // usuários
  async createUser(req: FastifyRequest, rep: FastifyReply) { return rep.status(201).send(await svc.createUser(req.body as any)) }
  async updateUser(req: FastifyRequest, rep: FastifyReply) { return rep.send(await svc.updateUser((req.params as any).id, req.body)) }
  async deleteUser(req: FastifyRequest, rep: FastifyReply) { return rep.send(await svc.deleteUser((req.params as any).id)) }

  // organização
  async createOrganization(req: FastifyRequest, rep: FastifyReply) { return rep.status(201).send(await svc.createOrganization(req.body as any)) }
  async renameOrganization(req: FastifyRequest, rep: FastifyReply) { return rep.send(await svc.renameOrganization((req.params as any).id, req.body as any)) }
  async deleteOrganization(req: FastifyRequest, rep: FastifyReply) { return rep.send(await svc.deleteOrganization((req.params as any).id)) }

  // dados/operação
  async orgData(req: FastifyRequest, rep: FastifyReply) {
    const { id, kind } = req.params as any
    return rep.send(await svc.orgData(id, kind, req.query))
  }
  async deleteOrgResource(req: FastifyRequest, rep: FastifyReply) {
    const { kind, resourceId } = req.params as any
    return rep.send(await svc.deleteOrgResource(kind, resourceId))
  }
}
