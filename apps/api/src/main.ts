import Fastify from 'fastify'
import cors from '@fastify/cors'
import jwt from '@fastify/jwt'
import rateLimit from '@fastify/rate-limit'
import websocket from '@fastify/websocket'
import { authenticate } from './common/middleware/auth.middleware'
import { requireSuperAdmin } from './common/middleware/admin.middleware'
import { errorHandler } from './common/middleware/error.handler'
import { connections } from './common/ws-connections'

import { authRoutes } from './modules/auth/auth.routes'
import { contactRoutes } from './modules/contacts/contacts.routes'
import { pipelineRoutes } from './modules/pipeline/pipeline.routes'
import { whatsappRoutes } from './modules/whatsapp/whatsapp.routes'
import { campaignRoutes } from './modules/campaigns/campaigns.routes'
import { chatbotRoutes } from './modules/chatbot/chatbot.routes'
import { reportRoutes } from './modules/reports/reports.routes'
import { financialRoutes } from './modules/financial/financial.routes'
import { teamRoutes } from './modules/team/team.routes'
import { dashboardRoutes } from './modules/dashboard/dashboard.routes'
import { webhookRoutes } from './modules/webhooks/webhooks.routes'
import { adminRoutes } from './modules/admin/admin.routes'
import { groupRoutes } from './modules/groups/groups.routes'

// bodyLimit 25MB: uploads de mídia (foto/doc/áudio) trafegam como base64 no JSON.
const app = Fastify({
  logger: { level: process.env.NODE_ENV === 'production' ? 'warn' : 'info' },
  bodyLimit: 25 * 1024 * 1024,
})

async function bootstrap() {
  // CORS multi-origin: FRONTEND_URL é uma lista CSV. O header
  // Access-Control-Allow-Origin precisa refletir UM único origin (o da requisição),
  // não a string inteira — senão o navegador rejeita com erro de network.
  const allowedOrigins = (process.env.FRONTEND_URL || 'http://localhost:3000')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean)

  // Plugins
  await app.register(cors, {
    origin: (origin, cb) => {
      // Sem origin (curl, server-to-server) ou origin permitido → libera.
      if (!origin || allowedOrigins.includes(origin)) return cb(null, true)
      cb(null, false)
    },
    credentials: true,
  })

  await app.register(jwt, { secret: process.env.JWT_SECRET || 'dev_secret_change_in_production' })

  await app.register(rateLimit, { max: 1000, timeWindow: '1 minute' })

  await app.register(websocket)

  app.get('/ws', { websocket: true }, (socket: any, req) => {
    const token = (req.query as any).token
    if (!token) { socket.close(); return }
    try {
      const payload = app.jwt.verify(token) as any
      const orgId = payload.orgId
      if (!connections.has(orgId)) connections.set(orgId, new Set())
      connections.get(orgId)!.add(socket)
      socket.send(JSON.stringify({ event: 'connected' }))
      socket.on('close', () => connections.get(orgId)?.delete(socket))
    } catch {
      socket.close()
    }
  })

  // Decorator global de autenticação
  app.decorate('authenticate', authenticate)
  app.decorate('requireSuperAdmin', requireSuperAdmin)

  // Error handler global
  app.setErrorHandler(errorHandler)

  // Preflight health
  app.get('/health', async () => ({ status: 'ok', version: '1.0.0', timestamp: new Date().toISOString() }))

  // Rotas
  await app.register(authRoutes,      { prefix: '/auth' })
  await app.register(contactRoutes,   { prefix: '/contacts' })
  await app.register(pipelineRoutes,  { prefix: '/pipeline' })
  await app.register(whatsappRoutes,  { prefix: '/whatsapp' })
  await app.register(campaignRoutes,  { prefix: '/campaigns' })
  await app.register(groupRoutes,     { prefix: '/groups' })
  await app.register(chatbotRoutes,   { prefix: '/chatbot' })
  await app.register(reportRoutes,    { prefix: '/reports' })
  await app.register(financialRoutes, { prefix: '/financial' })
  await app.register(teamRoutes,      { prefix: '/team' })
  await app.register(dashboardRoutes, { prefix: '/dashboard' })
  await app.register(webhookRoutes,   { prefix: '/webhooks' })
  await app.register(adminRoutes,      { prefix: '/admin' })

  await app.listen({ port: Number(process.env.PORT || 3001), host: '0.0.0.0' })
  console.log(`🚀 API rodando na porta ${process.env.PORT || 3001}`)
}

bootstrap().catch((err) => { console.error(err); process.exit(1) })
