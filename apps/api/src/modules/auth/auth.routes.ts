import { FastifyInstance } from 'fastify'
import { AuthController } from './auth.controller'

export async function authRoutes(app: FastifyInstance) {
  const ctrl = new AuthController(app)
  app.post('/register', ctrl.register.bind(ctrl))
  app.post('/login', ctrl.login.bind(ctrl))
  app.post('/refresh', ctrl.refresh.bind(ctrl))
  app.get('/me', { preHandler: [app.authenticate] }, ctrl.me.bind(ctrl))
  app.post('/forgot-password', ctrl.forgotPassword.bind(ctrl))
  app.patch('/profile', { preHandler: [app.authenticate] }, ctrl.updateProfile.bind(ctrl))
  app.patch('/password', { preHandler: [app.authenticate] }, ctrl.changePassword.bind(ctrl))
  app.patch('/organization', { preHandler: [app.authenticate] }, ctrl.updateOrganization.bind(ctrl))
}
