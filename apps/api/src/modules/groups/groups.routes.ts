import { FastifyInstance } from 'fastify'
import { GroupsService } from './groups.service'

const service = new GroupsService()

export async function groupRoutes(app: FastifyInstance) {
  const auth = { preHandler: [app.authenticate] }
  const orgId = (req: any) => req.user.orgId

  app.get('/', auth, async (req, rep) => {
    const { instanceId, search = '' } = req.query as any
    if (!instanceId) return rep.status(400).send({ message: 'instanceId é obrigatório' })
    return rep.send(await service.list(orgId(req), instanceId, search))
  })
  app.post('/inspect', auth, async (req, rep) => rep.send(await service.inspectInvite(orgId(req), req.body as any)))
  app.post('/join', auth, async (req, rep) => rep.send(await service.join(orgId(req), req.body as any)))
  app.get('/:groupJid/participants', auth, async (req, rep) => {
    const { instanceId } = req.query as any
    const { groupJid } = req.params as any
    return rep.send(await service.participants(orgId(req), instanceId, decodeURIComponent(groupJid)))
  })
  app.post('/import', auth, async (req, rep) => rep.send(await service.importParticipants(orgId(req), req.body as any)))
}
