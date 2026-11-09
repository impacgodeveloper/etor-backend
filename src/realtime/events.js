import { pool } from "../config/supabase.js";
import { invalidateTenantBlock } from "../utils/tenantAccess.js";
import {
  publish, toPlatform, toTenantStaff, toTenantAll, toTenantPartners, toPartner,
} from "./hub.js";

// Events are invalidation signals only ("entity X changed"); clients refetch
// through the normal authorized REST endpoints, so no row data is pushed.
const TENANT_RULES = [
  [/^\/api\/layouts/, "layouts"],
  [/^\/api\/blocks/, "blocks"],
  [/^\/api\/plots/, "plots"],
  [/^\/api\/partners/, "partners"],
  [/^\/api\/documents/, "documents"],
  [/^\/api\/payments/, "payments"],
  [/^\/api\/employees/, "employees"],
  [/^\/api\/sales/, "sales"],
  [/^\/api\/travel-expenses/, "travel_expenses"],
  [/^\/api\/cows/, "cows"],
  [/^\/api\/admin\/notifications/, "admin_notifications"],
  [/^\/api\/admin\/requests\/visits/, "visits"],
  [/^\/api\/admin\/requests\/transfers/, "transfers"],
  [/^\/api\/admin\/(requests\/)?support/, "support"],
  [/^\/api\/partner\/visits/, "visits"],
  [/^\/api\/partner\/ownership-transfer/, "transfers"],
  [/^\/api\/partner\/support/, "support"],
  [/^\/api\/partner\/notifications/, "notifications"],
  [/^\/api\/partner\/documents/, "documents"],
  [/^\/api\/partner-auth\/(profile|avatar|change-password)/, "partner_profile"],
];

const ACTIONS = { POST: "create", PUT: "update", PATCH: "update", DELETE: "delete" };

const matchEntity = (path) => TENANT_RULES.find(([re]) => re.test(path))?.[1];

const tenantSchemaById = async (id) => {
  const { rows } = await pool.query(
    "SELECT tenant_schema FROM public.admin_users WHERE id::text = $1",
    [id]
  );
  return rows[0]?.tenant_schema || null;
};

export const notifyTenantStatus = (schema) => {
  invalidateTenantBlock(schema);
  if (schema) publish(toTenantAll(schema), { type: "tenant_status" });
  publish(toPlatform(), { type: "changed", entity: "tenants", action: "update", tenantSchema: schema || null });
};

const handlePlatformWrite = async (path, action) => {
  const tenantMatch = path.match(/^\/api\/platform\/tenants(?:\/([^/]+))?/);
  if (tenantMatch) {
    const schema = tenantMatch[1] ? await tenantSchemaById(tenantMatch[1]) : null;
    invalidateTenantBlock(schema);
    if (schema) publish(toTenantAll(schema), { type: "tenant_status" });
    publish(toPlatform(), { type: "changed", entity: "tenants", action, tenantSchema: schema });
    return;
  }
  if (/^\/api\/platform\/(settings|roles|notification-settings)/.test(path)) {
    publish(toPlatform(), { type: "changed", entity: "platform_settings", action, tenantSchema: null });
  }
};

// Internal staff data; partners never need to know it changed.
const STAFF_ONLY = new Set(["employees", "sales", "travel_expenses", "admin_notifications"]);

const quoteIdent = (name) => `"${String(name).replace(/"/g, '""')}"`;

const ownerOf = async (schema, table, column, id) => {
  const { rows } = await pool.query(
    `SELECT ${column} AS partner_id FROM ${quoteIdent(schema)}.${table} WHERE id::text = $1`,
    [String(id)]
  );
  return rows[0]?.partner_id || null;
};

// For staff actions aimed at one partner, find that partner so the event goes
// to them alone (other partners shouldn't even learn that something happened).
// Returns null when the change isn't about a single partner.
const targetPartner = async (req, path, schema) => {
  let m;
  if ((m = path.match(/^\/api\/admin\/(?:requests\/)?support\/([^/]+)/))) return m[1];
  if ((m = path.match(/^\/api\/admin\/requests\/visits\/([^/]+)/))) return ownerOf(schema, "visit_schedules", "partner_id", m[1]);
  if ((m = path.match(/^\/api\/admin\/requests\/transfers\/([^/]+)/))) return ownerOf(schema, "ownership_transfers", "from_partner_id", m[1]);
  if (/^\/api\/payments$/.test(path)) return req.body?.user_id || null;
  if (/^\/api\/documents$/.test(path)) return req.body?.related_user_id || null;
  return null;
};

const handleTenantWrite = async (req, path, action) => {
  const user = req.user;
  const entity = matchEntity(path);
  if (!user?.tenant_schema || !entity) return;
  const schema = user.tenant_schema;
  const event = { type: "changed", entity, action };

  if (user.role === "partner" && !user.is_employee) {
    // Partner writes stay between that partner and their organization's staff;
    // they usually also create an admin notification server-side.
    publish(toTenantStaff(schema), event);
    publish(toTenantStaff(schema), { type: "changed", entity: "admin_notifications", action: "create" });
    publish(toPartner(schema, user.id), event);
  } else if (STAFF_ONLY.has(entity)) {
    publish(toTenantStaff(schema), event);
  } else {
    publish(toTenantStaff(schema), event);
    const partnerId = await targetPartner(req, path, schema);
    publish(partnerId ? toPartner(schema, partnerId) : toTenantPartners(schema), event);
  }
  publish(toPlatform(), { type: "changed", entity: "tenant_activity", action, tenantSchema: schema });
};

export const realtimeEvents = (req, res, next) => {
  const action = ACTIONS[req.method];
  if (!action) return next();

  res.on("finish", () => {
    if (res.statusCode >= 400) return;
    const path = req.originalUrl.split("?")[0];
    if (/\/login$/.test(path)) return;

    if (path === "/api/auth/register") {
      publish(toPlatform(), { type: "changed", entity: "tenants", action: "create", tenantSchema: null });
      return;
    }
    if (path.startsWith("/api/platform/")) {
      handlePlatformWrite(path, action).catch((err) =>
        console.error("[realtime] platform event failed:", err.message)
      );
      return;
    }
    handleTenantWrite(req, path, action).catch((err) =>
      console.error("[realtime] tenant event failed:", err.message)
    );
  });
  next();
};

// Trials end on their own clock, not through an API call, so watch for trial
// deadlines passing and tell the affected organization's apps to re-check.
export const startTrialDeadlineWatcher = (intervalMs = 60_000) => {
  let lastCheck = new Date();
  setInterval(async () => {
    const now = new Date();
    try {
      const { rows } = await pool.query(
        `SELECT tenant_schema FROM public.admin_users
          WHERE tenant_schema IS NOT NULL
            AND COALESCE(is_subscribed, false) = false
            AND trial_ends_at > $1 AND trial_ends_at <= $2`,
        [lastCheck, now]
      );
      for (const { tenant_schema } of rows) notifyTenantStatus(tenant_schema);
      lastCheck = now;
    } catch (err) {
      console.error("[realtime] trial watcher failed:", err.message);
    }
  }, intervalMs);
};
