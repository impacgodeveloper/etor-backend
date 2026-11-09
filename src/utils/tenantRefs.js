import { tenantDb } from "./tenantDb.js";

// Tenant tables are cloned with LIKE ... INCLUDING ALL, which does not copy
// foreign keys, so ids taken from a request body must be checked by hand.
export const partnerInTenant = async (req, partnerId) => {
  if (!partnerId) return false;
  const { data } = await tenantDb(req).from("partners").select("id").eq("id", partnerId).maybeSingle();
  return !!data;
};

export const plotInTenant = async (req, plotId) => {
  if (!plotId) return false;
  const { data } = await tenantDb(req).from("plots").select("id").eq("id", plotId).maybeSingle();
  return !!data;
};

export const unknownPartner = (res) =>
  res.status(400).json({ success: false, message: "That partner does not exist in your organization" });
