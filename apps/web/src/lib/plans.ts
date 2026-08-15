export type PlanCode = 'FREE' | 'STARTER' | 'PRO' | 'ENTERPRISE'

export interface PlanDefinition {
  code: PlanCode
  name: string
  price: number
  maxInstances: number
  maxActiveCampaigns: number
  maxTeamUsers: number
  featured?: boolean
}

export const PLANS: Record<PlanCode, PlanDefinition> = {
  FREE: { code: 'FREE', name: 'Teste interno', price: 0, maxInstances: 1, maxActiveCampaigns: 1, maxTeamUsers: 2 },
  STARTER: { code: 'STARTER', name: 'DisparoX Essencial', price: 97, maxInstances: 3, maxActiveCampaigns: 1, maxTeamUsers: 5 },
  PRO: { code: 'PRO', name: 'DisparoX Pro', price: 147, maxInstances: 5, maxActiveCampaigns: 3, maxTeamUsers: 15, featured: true },
  ENTERPRISE: { code: 'ENTERPRISE', name: 'DisparoX Black', price: 247, maxInstances: 10, maxActiveCampaigns: 10, maxTeamUsers: 50 },
}

export const PUBLIC_PLANS = [PLANS.STARTER, PLANS.PRO, PLANS.ENTERPRISE]

export function getPlan(value?: string | null) {
  const code = String(value || 'FREE').toUpperCase() as PlanCode
  return PLANS[code] || PLANS.FREE
}

export function formatPlanPrice(value: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(value)
}
