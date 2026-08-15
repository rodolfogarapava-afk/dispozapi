export type PlanCode = 'FREE' | 'STARTER' | 'PRO' | 'ENTERPRISE'

export interface PlanDefinition {
  code: PlanCode
  name: string
  price: number
  maxInstances: number
  maxActiveCampaigns: number
  maxTeamUsers: number
}

export const PLAN_DEFINITIONS: Record<PlanCode, PlanDefinition> = {
  FREE: {
    code: 'FREE',
    name: 'Teste interno',
    price: 0,
    maxInstances: 1,
    maxActiveCampaigns: 1,
    maxTeamUsers: 2,
  },
  STARTER: {
    code: 'STARTER',
    name: 'Shark Essencial',
    price: 97,
    maxInstances: 3,
    maxActiveCampaigns: 1,
    maxTeamUsers: 5,
  },
  PRO: {
    code: 'PRO',
    name: 'Shark Pro',
    price: 147,
    maxInstances: 5,
    maxActiveCampaigns: 3,
    maxTeamUsers: 15,
  },
  ENTERPRISE: {
    code: 'ENTERPRISE',
    name: 'Shark Black',
    price: 247,
    maxInstances: 10,
    maxActiveCampaigns: 10,
    maxTeamUsers: 50,
  },
}

export function getPlanDefinition(value: unknown): PlanDefinition {
  const code = String(value || 'FREE').toUpperCase() as PlanCode
  return PLAN_DEFINITIONS[code] || PLAN_DEFINITIONS.FREE
}

export function planLimitMessage(plan: PlanDefinition, resource: string, limit: number) {
  return `O plano ${plan.name} permite até ${limit} ${resource}. Altere o plano no painel administrativo para ampliar o limite.`
}
