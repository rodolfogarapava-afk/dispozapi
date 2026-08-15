import { FastifyInstance } from 'fastify'
import { CampaignService } from './campaigns.service'

const svc = new CampaignService()

export async function campaignRoutes(app: FastifyInstance) {
  const auth = { preHandler: [app.authenticate] }
  const u = (req: any) => req.user

  app.get('/', auth, async (req, rep) => rep.send(await svc.list(u(req).orgId)))
  app.get('/antispam', auth, async (req, rep) => rep.send(await svc.getAntiSpam(u(req).orgId)))
  app.patch('/antispam', auth, async (req, rep) => rep.send(await svc.saveAntiSpam(u(req).orgId, req.body as any)))
  app.post('/assets', auth, async (req, rep) => rep.status(201).send(await svc.uploadAsset(req.body as any)))
  app.get('/:id', auth, async (req, rep) => rep.send(await svc.get((req.params as any).id, u(req).orgId)))
  app.post('/', auth, async (req, rep) => rep.status(201).send(await svc.create(u(req).orgId, req.body as any)))
  app.post('/:id/start', auth, async (req, rep) => {
    const body = (req.body as any) || {}
    return rep.send(await svc.start((req.params as any).id, u(req).orgId, body.config, body.instanceId))
  })
  app.post('/:id/pause', auth, async (req, rep) => rep.send(await svc.pause((req.params as any).id, u(req).orgId)))
  app.delete('/:id', auth, async (req, rep) => rep.send(await svc.remove((req.params as any).id, u(req).orgId)))
}
