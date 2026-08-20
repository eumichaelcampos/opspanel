export type PlanTier = "free" | "pro" | "business" | "full_free";

export type Entitlements = {
  plan: PlanTier;
  maxServers: number | null;
  maxSites: number | null;
  maxJobsPerMonth: number | null;
  maxApiKeys: number | null;
  maxMembers: number | null;
  maxMailboxes: number | null;
  maxEmailDomains: number | null;
  emailDeliveryMonthly: number | null;
  aiAssistant: boolean;
  mcpEnabled: boolean;
};

export const PLAN_ENTITLEMENTS: Record<PlanTier, Entitlements> = {
  free: {
    plan: "free",
    maxServers: 1,
    maxSites: 10,
    maxJobsPerMonth: 100,
    maxApiKeys: 1,
    maxMembers: 2,
    maxMailboxes: 0,
    maxEmailDomains: 0,
    emailDeliveryMonthly: 0,
    aiAssistant: false,
    mcpEnabled: true,
  },
  pro: {
    plan: "pro",
    maxServers: 5,
    maxSites: 100,
    maxJobsPerMonth: 5000,
    maxApiKeys: 5,
    maxMembers: 10,
    maxMailboxes: 0,
    maxEmailDomains: 0,
    emailDeliveryMonthly: 0,
    aiAssistant: true,
    mcpEnabled: true,
  },
  business: {
    plan: "business",
    maxServers: null,
    maxSites: null,
    maxJobsPerMonth: null,
    maxApiKeys: 20,
    maxMembers: null,
    maxMailboxes: 0,
    maxEmailDomains: 0,
    emailDeliveryMonthly: 0,
    aiAssistant: true,
    mcpEnabled: true,
  },
  full_free: {
    plan: "full_free",
    maxServers: null,
    maxSites: null,
    maxJobsPerMonth: null,
    maxApiKeys: null,
    maxMembers: null,
    maxMailboxes: 0,
    maxEmailDomains: 0,
    emailDeliveryMonthly: 0,
    aiAssistant: true,
    mcpEnabled: true,
  },
};

export function entitlementsForPlan(plan: PlanTier): Entitlements {
  return { ...PLAN_ENTITLEMENTS[plan] };
}

export function isUnlimited(value: number | null): boolean {
  return value === null;
}

export function isWithinLimit(current: number, limit: number | null): boolean {
  if (limit === null) return true;
  return current < limit;
}
