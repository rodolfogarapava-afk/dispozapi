import { FastifyInstance } from 'fastify'
import { AdminController } from './admin.controller'

const ctrl = new AdminController()

export async function adminRoutes(app: FastifyInstance) {
  // Toda rota admin exige token válido E super-admin de plataforma.
  const guard = { preHandler: [app.authenticate, app.requireSuperAdmin] }

  app.get('/overview', guard, ctrl.overview)
  app.get('/growth', guard, ctrl.growth)

  // organizações
  app.get('/organizations', guard, ctrl.organizations)
  app.post('/organizations', guard, ctrl.createOrganization)
  app.get('/organizations/:id', guard, ctrl.organizationDetail)
  app.patch('/organizations/:id', guard, ctrl.updateOrganization)        // assinatura (status/plano/mrr/datas)
  app.patch('/organizations/:id/rename', guard, ctrl.renameOrganization) // nome
  app.delete('/organizations/:id', guard, ctrl.deleteOrganization)       // exclui org + dados

  // dados/operação por org
  app.get('/organizations/:id/data/:kind', guard, ctrl.orgData)          // kind: contacts|campaigns|instances
  app.delete('/data/:kind/:resourceId', guard, ctrl.deleteOrgResource)

  // usuários (cross-org)
  app.post('/users', guard, ctrl.createUser)
  app.patch('/users/:id', guard, ctrl.updateUser)
  app.delete('/users/:id', guard, ctrl.deleteUser)
}
