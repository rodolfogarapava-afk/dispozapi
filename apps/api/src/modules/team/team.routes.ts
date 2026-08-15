import { FastifyInstance } from 'fastify'
import { TeamService } from './team.service'

const svc = new TeamService()

export async function teamRoutes(app: FastifyInstance) {
  const auth = { preHandler: [app.authenticate] }
  const u = (req: any) => req.user

  app.get('/', auth, async (req, rep) => rep.send(await svc.list(u(req).orgId)))
  app.post('/', auth, async (req, rep) => rep.status(201).send(await svc.create(u(req).orgId, u(req).role, req.body as any)))
  app.patch('/:id', auth, async (req, rep) => rep.send(await svc.update((req.params as any).id, u(req).orgId, u(req).role, req.body as any)))
  app.delete('/:id', auth, async (req, rep) => rep.send(await svc.remove((req.params as any).id, u(req).orgId, u(req).role, u(req).sub)))
}
