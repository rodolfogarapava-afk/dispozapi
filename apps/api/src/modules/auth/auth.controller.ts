import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { AuthService } from './auth.service'
export class AuthController {
  private svc: AuthService
  constructor(private app: FastifyInstance) { this.svc = new AuthService() }
  async register(req: FastifyRequest, rep: FastifyReply) { return rep.status(201).send(await this.svc.register(req.body as any)) }
  async login(req: FastifyRequest, rep: FastifyReply) { return rep.send(await this.svc.login(req.body as any, this.app)) }
  async refresh(req: FastifyRequest, rep: FastifyReply) { return rep.send(await this.svc.refresh(req.body, this.app)) }
  async me(req: FastifyRequest, rep: FastifyReply) { return rep.send(await this.svc.me((req as any).user.sub)) }
  async forgotPassword(req: FastifyRequest, rep: FastifyReply) { await this.svc.forgotPassword((req.body as any).email); return rep.send({ message: 'Email enviado' }) }
  async updateProfile(req: FastifyRequest, rep: FastifyReply) { return rep.send(await this.svc.updateProfile((req as any).user.sub, req.body as any)) }
  async changePassword(req: FastifyRequest, rep: FastifyReply) { return rep.send(await this.svc.changePassword((req as any).user.sub, req.body as any)) }
  async updateOrganization(req: FastifyRequest, rep: FastifyReply) { return rep.send(await this.svc.updateOrganization((req as any).user.orgId, (req as any).user.role, req.body as any)) }
}
