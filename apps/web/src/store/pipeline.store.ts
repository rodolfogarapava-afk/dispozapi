import { create } from 'zustand'
import { api } from '@/lib/api'

export interface Deal {
  id: string; title: string; value: number; status: string
  stageId: string; contact: { id: string; name: string; phone: string }
  assignedTo?: { id: string; name: string; avatar?: string }
  notes?: string; expectedAt?: string; createdAt: string
}
export interface Stage { id: string; name: string; color: string; order: number; deals: Deal[] }
export interface Pipeline { id: string; name: string; stages: Stage[] }

interface PipelineState {
  pipelines: Pipeline[]
  activePipeline: Pipeline | null
  isLoading: boolean
  fetch: () => Promise<void>
  setActive: (id: string) => void
  moveDeal: (dealId: string, toStageId: string) => Promise<void>
  createDeal: (data: any) => Promise<void>
  deleteDeal: (id: string) => Promise<void>
}

export const usePipelineStore = create<PipelineState>((set, get) => ({
  pipelines: [],
  activePipeline: null,
  isLoading: false,

  fetch: async () => {
    set({ isLoading: true })
    const { data } = await api.get('/pipeline')
    set({ pipelines: data, activePipeline: data[0] || null, isLoading: false })
  },

  setActive: (id) => {
    const p = get().pipelines.find(p => p.id === id) || null
    set({ activePipeline: p })
  },

  moveDeal: async (dealId, toStageId) => {
    // Otimista: mover localmente primeiro
    set(state => {
      if (!state.activePipeline) return state
      const stages = state.activePipeline.stages.map(stage => ({
        ...stage,
        deals: stage.deals.filter(d => d.id !== dealId)
      }))
      const deal = state.activePipeline.stages.flatMap(s => s.deals).find(d => d.id === dealId)
      if (!deal) return state
      const updatedStages = stages.map(stage =>
        stage.id === toStageId ? { ...stage, deals: [...stage.deals, { ...deal, stageId: toStageId }] } : stage
      )
      return { activePipeline: { ...state.activePipeline, stages: updatedStages } }
    })
    await api.patch(`/pipeline/deals/${dealId}/move`, { stageId: toStageId })
  },

  createDeal: async (data) => {
    await api.post('/pipeline/deals', data)
    await get().fetch()
  },

  deleteDeal: async (id) => {
    await api.delete(`/pipeline/deals/${id}`)
    await get().fetch()
  },
}))
