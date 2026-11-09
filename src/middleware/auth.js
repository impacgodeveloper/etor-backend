import jwt from "jsonwebtoken";
import { tenantDb } from "../utils/tenantDb.js";
import { getTenantBlock } from "../utils/tenantAccess.js";

export const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        message: "No token provided",
      });
    }

    const token = authHeader.split(" ")[1];

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    req.user = decoded;

    // Tenant Schema
    req.tenantSchema = decoded.tenant_schema;

    // Trial/suspension is enforced per tenant route by enforceTenantAccess.
    next();
  } catch (err) {
    return res.status(401).json({
      success: false,
      message: "Invalid or expired token",
    });
  }
};

const PLATFORM_ROLE = "platform_super_admin";

const hasTenant = (req, res) => {
  if (req.user?.tenant_schema) return true;
  res.status(403).json({ success: false, message: "This account is not linked to an organization" });
  return false;
};

// An employee's role claim is their free-text role title, so identity comes
// from is_employee, not from the role string.
const isPartnerToken = (user) => user?.role === "partner" && !user.is_employee;

const requireStaff = (req, res, next) => {
  const user = req.user;
  if (isPartnerToken(user) || (!user?.is_employee && user?.role === PLATFORM_ROLE)) {
    return res.status(403).json({ success: false, message: "Admin or employee access required" });
  }
  if (hasTenant(req, res)) next();
};

const requirePartner = (req, res, next) => {
  if (!isPartnerToken(req.user)) {
    return res.status(403).json({ success: false, message: "Partner access required" });
  }
  if (hasTenant(req, res)) next();
};

// Admin-app module numbers (lib/admin/core/app_modules.dart). Older employee
// rows stored module names instead of numbers, so both are accepted.
const MODULE_BY_NAME = {
  dashboard: 0, partners: 1, users: 1, cows: 1, payments: 1, layouts: 2, blocks: 2,
  plots: 3, settings: 4, requests: 5, documents: 6, sales: 7, employees: 8, travel_expenses: 9,
};
const WRITE_MODULES = [
  [/^\/api\/partners/, [1]],
  [/^\/api\/(layouts|blocks)/, [2]],
  [/^\/api\/plots/, [1, 3]],
  [/^\/api\/payments/, [1, 3]],
  [/^\/api\/cows/, [1]],
  [/^\/api\/documents/, [1, 6]],
  [/^\/api\/admin\/(requests|support)/, [5]],
  [/^\/api\/sales/, [7]],
  [/^\/api\/employees/, [8]],
  [/^\/api\/travel-expenses/, [9]],
];

const toModuleSet = (raw) =>
  new Set((Array.isArray(raw) ? raw : []).map((m) =>
    typeof m === "number" ? m : MODULE_BY_NAME[String(m).trim().toLowerCase()] ?? Number.parseInt(m, 10)
  ).filter(Number.isInteger));

// Employees: the account must still be active (checked live, not from the
// token), and writes need the module that owns the route.
const enforceEmployeeAccess = async (req, res, next) => {
  if (!req.user?.is_employee) return next();
  try {
    const { data: employee } = await tenantDb(req)
      .from("employee_accounts")
      .select("is_active, allowed_modules")
      .eq("id", req.user.id)
      .maybeSingle();
    if (!employee || employee.is_active === false) {
      return res.status(401).json({ success: false, message: "Invalid or expired token" });
    }
    if (["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
      const path = req.originalUrl.split("?")[0];
      const rule = WRITE_MODULES.find(([re]) => re.test(path));
      const granted = toModuleSet(employee.allowed_modules);
      if (rule && !rule[1].some((m) => granted.has(m))) {
        return res.status(403).json({ success: false, message: "You don't have access to this module" });
      }
    }
    next();
  } catch (err) {
    next(err);
  }
};

// Suspended or trial-expired organizations can still ask "who am I" (so the
// apps can show the right lockout screen and unlock live when reactivated),
// but every other request is refused.
const STATUS_CHECK_PATHS = new Set(["/api/auth/me", "/api/partner-auth/me"]);

const enforceTenantAccess = async (req, res, next) => {
  if (STATUS_CHECK_PATHS.has(req.originalUrl.split("?")[0])) return next();
  try {
    const block = await getTenantBlock(req.user.tenant_schema);
    if (block) return res.status(403).json({ success: false, ...block });
    next();
  } catch (err) {
    next(err);
  }
};

export const authStaff = [authenticate, requireStaff, enforceEmployeeAccess, enforceTenantAccess];
export const authPartner = [authenticate, requirePartner, enforceTenantAccess];