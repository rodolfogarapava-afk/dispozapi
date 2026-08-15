import { FastifyInstance } from 'fastify'
import { FinancialService } from './financial.service'

const svc = new FinancialService()

export async function financialRoutes(app: FastifyInstance) {
  const auth = { preHandler: [app.authenticate] }
  app.get('/summary', auth, async (req, rep) => rep.send(await svc.summary((req as any).user.orgId, req.query)))
  app.get('/invoices', auth, async (req, rep) => rep.send(await svc.invoices((req as any).user.orgId)))
  app.get('/revenue', auth, async (req, rep) => rep.send(await svc.revenue((req as any).user.orgId, req.query)))
}
