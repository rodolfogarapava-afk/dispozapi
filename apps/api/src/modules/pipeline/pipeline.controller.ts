import { FastifyRequest, FastifyReply } from 'fastify'
import { PipelineService } from './pipeline.service'
const svc = new PipelineService()

export class PipelineController {
  private orgId(req: FastifyRequest) { return (req as any).user.orgId }

  async listPipelines(req: FastifyRequest, rep: FastifyReply) { return rep.send(await svc.listPipelines(this.orgId(req))) }
  async createPipeline(req: FastifyRequest, rep: FastifyReply) { return rep.status(201).send(await svc.createPipeline(this.orgId(req), req.body as any)) }
  async updatePipeline(req: FastifyRequest, rep: FastifyReply) { return rep.send(await svc.updatePipeline((req.params as any).id, this.orgId(req), req.body as any)) }
  async deletePipeline(req: FastifyRequest, rep: FastifyReply) { return rep.send(await svc.deletePipeline((req.params as any).id, this.orgId(req))) }
  async reevaluatePipeline(req: FastifyRequest, rep: FastifyReply) { return rep.send(await svc.reevaluatePipeline(this.orgId(req), { apply: (req.body as any)?.apply === true })) }
  async cleanInactive(req: FastifyRequest, rep: FastifyReply) { const b = req.body as any; return rep.send(await svc.cleanInactive(this.orgId(req), { apply: b?.apply === true, hours: b?.hours })) }

  async listStages(req: FastifyRequest, rep: FastifyReply) { return rep.send(await svc.listStages((req.params as any).id, this.orgId(req))) }
  async createStage(req: FastifyRequest, rep: FastifyReply) { return rep.status(201).send(await svc.createStage((req.params as any).id, this.orgId(req), req.body as any)) }
  async updateStage(req: FastifyRequest, rep: FastifyReply) { return rep.send(await svc.updateStage((req.params as any).stageId, req.body as any)) }
  async deleteStage(req: FastifyRequest, rep: FastifyReply) { return rep.send(await svc.deleteStage((req.params as any).stageId)) }

  async listDeals(req: FastifyRequest, rep: FastifyReply) { return rep.send(await svc.listDeals(this.orgId(req), req.query)) }
  async createDeal(req: FastifyRequest, rep: FastifyReply) { return rep.status(201).send(await svc.createDeal(this.orgId(req), req.body as any)) }
  async getDeal(req: FastifyRequest, rep: FastifyReply) { return rep.send(await svc.getDeal((req.params as any).id, this.orgId(req))) }
  async updateDeal(req: FastifyRequest, rep: FastifyReply) { return rep.send(await svc.updateDeal((req.params as any).id, this.orgId(req), req.body)) }
  async moveDeal(req: FastifyRequest, rep: FastifyReply) { return rep.send(await svc.moveDeal((req.params as any).id, this.orgId(req), req.body as any)) }
  async deleteDeal(req: FastifyRequest, rep: FastifyReply) { return rep.send(await svc.deleteDeal((req.params as any).id, this.orgId(req))) }
}
