import { getTenantTrialSummary, TRIAL_STATUS } from "./trialManagement.js";

const TTL_MS = 30_000;
const cache = new Map();

const BLOCKED = {
  suspended: {
    code: "TENANT_SUSPENDED",
    message: "Your organization's account has been suspended. Contact info@impacgo.com to restore access.",
  },
  expired: {
    code: "TRIAL_EXPIRED",
    message: "Your trial period has ended. Contact info@impacgo.com to resume your service.",
  },
};

// Returns null when the organization may use the API, otherwise {code, message}.
export const getTenantBlock = async (tenantSchema) => {
  const hit = cache.get(tenantSchema);
  if (hit && hit.expires > Date.now()) return hit.block;

  const summary = await getTenantTrialSummary(tenantSchema);
  let block = null;
  if (!summary.is_active) block = BLOCKED.suspended;
  else if (summary.trial_status === TRIAL_STATUS.EXPIRED) block = BLOCKED.expired;

  cache.set(tenantSchema, { block, expires: Date.now() + TTL_MS });
  return block;
};

export const invalidateTenantBlock = (tenantSchema) => {
  if (tenantSchema) cache.delete(tenantSchema);
  else cache.clear();
};
