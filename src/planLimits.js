export const publicPlanOptions = ['starter', 'plus', 'pro', 'business'];
export const legacyPlanOptions = ['beta', 'enterprise'];
export const userPlanOptions = [...legacyPlanOptions, ...publicPlanOptions];

const planLimits = {
  starter: {
    plan: 'starter',
    label: 'Starter',
    telegramSources: 1,
    whatsappDestinations: 3,
    affiliateAutomations: 0,
    amazonAffiliate: false,
    shopeeAffiliate: false,
    dailyMessages: 100,
    historyDays: 1
  },
  plus: {
    plan: 'plus',
    label: 'Plus',
    telegramSources: 1,
    whatsappDestinations: 10,
    affiliateAutomations: 1,
    amazonAffiliate: true,
    shopeeAffiliate: false,
    dailyMessages: 500,
    historyDays: 7
  },
  pro: {
    plan: 'pro',
    label: 'Pro',
    telegramSources: 3,
    whatsappDestinations: 30,
    affiliateAutomations: 3,
    amazonAffiliate: true,
    shopeeAffiliate: true,
    dailyMessages: 2000,
    historyDays: 30
  },
  business: {
    plan: 'business',
    label: 'Business',
    telegramSources: 10,
    whatsappDestinations: 100,
    affiliateAutomations: 10,
    amazonAffiliate: true,
    shopeeAffiliate: true,
    dailyMessages: 10000,
    historyDays: 90
  }
};

const planAliases = {
  beta: {
    ...planLimits.business,
    plan: 'beta',
    label: 'Beta'
  },
  enterprise: {
    ...planLimits.business,
    plan: 'enterprise',
    label: 'Enterprise'
  }
};

export function getPlanLimits(plan) {
  const normalizedPlan = normalizePlan(plan);
  return planAliases[normalizedPlan] || planLimits[normalizedPlan] || planLimits.starter;
}

export function normalizePlan(plan) {
  const normalized = String(plan ?? '').trim().toLowerCase();
  return userPlanOptions.includes(normalized) ? normalized : 'starter';
}

export function ensurePlanCount({ plan, key, count, label }) {
  const limits = getPlanLimits(plan);
  const limit = Number(limits[key] ?? 0);

  if (count > limit) {
    throw new Error(`${label} excede o limite do plano ${limits.label}: ${count}/${limit}.`);
  }
}

export function ensurePlanFeature({ plan, key, message }) {
  const limits = getPlanLimits(plan);

  if (!limits[key]) {
    throw new Error(message || `Este recurso nao esta liberado no plano ${limits.label}.`);
  }
}
