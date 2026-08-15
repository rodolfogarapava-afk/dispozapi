import { FastifyInstance } from 'fastify'
import { ChatbotController } from './chatbot.controller'

export async function chatbotRoutes(app: FastifyInstance) {
  const ctrl = new ChatbotController()
  const auth = { preHandler: [app.authenticate] }

  app.get('/', auth, ctrl.get.bind(ctrl))
  app.put('/', auth, ctrl.save.bind(ctrl))
  app.post('/test', auth, ctrl.test.bind(ctrl))
}
