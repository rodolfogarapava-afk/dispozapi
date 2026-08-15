import { FastifyInstance } from 'fastify'
import { PipelineController } from './pipeline.controller'

export async function pipelineRoutes(app: FastifyInstance) {
  const ctrl = new PipelineController()
  const auth = { preHandler: [app.authenticate] }

  // Pipelines
  app.get('/',           auth, ctrl.listPipelines.bind(ctrl))
  app.post('/',          auth, ctrl.createPipeline.bind(ctrl))
  app.patch('/:id',      auth, ctrl.updatePipeline.bind(ctrl))
  app.delete('/:id',     auth, ctrl.deletePipeline.bind(ctrl))
  app.post('/reevaluate', auth, ctrl.reevaluatePipeline.bind(ctrl))
  app.post('/clean-inactive', auth, ctrl.cleanInactive.bind(ctrl))

  // Stages
  app.get('/:id/stages',        auth, ctrl.listStages.bind(ctrl))
  app.post('/:id/stages',       auth, ctrl.createStage.bind(ctrl))
  app.patch('/stages/:stageId', auth, ctrl.updateStage.bind(ctrl))
  app.delete('/stages/:stageId',auth, ctrl.deleteStage.bind(ctrl))

  // Deals
  app.get('/deals',            auth, ctrl.listDeals.bind(ctrl))
  app.post('/deals',           auth, ctrl.createDeal.bind(ctrl))
  app.get('/deals/:id',        auth, ctrl.getDeal.bind(ctrl))
  app.patch('/deals/:id',      auth, ctrl.updateDeal.bind(ctrl))
  app.patch('/deals/:id/move', auth, ctrl.moveDeal.bind(ctrl))
  app.delete('/deals/:id',     auth, ctrl.deleteDeal.bind(ctrl))
}
