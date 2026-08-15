import { FastifyInstance } from 'fastify'
import { DashboardService } from './dashboard.service'

const svc = new DashboardService()

export async function dashboardRoutes(app: FastifyInstance) {
  app.get('/', { preHandler: [app.authenticate] }, async (req, rep) =>
    rep.send(await svc.overview((req as any).user.orgId))
  )
}
