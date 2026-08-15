import { FastifyInstance } from 'fastify'
import { ReportService } from './reports.service'

const svc = new ReportService()

export async function reportRoutes(app: FastifyInstance) {
  const auth = { preHandler: [app.authenticate] }
  app.get('/sales', auth, async (req, rep) => rep.send(await svc.sales((req as any).user.orgId, req.query)))
  app.get('/funnel', auth, async (req, rep) => rep.send(await svc.funnel((req as any).user.orgId)))
  app.get('/agents', auth, async (req, rep) => rep.send(await svc.agents((req as any).user.orgId, req.query)))
}
