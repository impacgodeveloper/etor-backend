import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { supabase, pool } from "../config/supabase.js";
import { tenantDb } from "../utils/tenantDb.js";
import { sendSignupNotification } from "../utils/notifyEmail.js";
import { createTenantAdmin, TenantProvisioningError } from "../utils/tenantProvisioning.js";
import { getTenantTrialSummary } from "../utils/trialManagement.js";

// admin_users holds only the super-admin account(s). Staff logins created
// via the Employees screen live in their own employee_accounts table (see
// employee.controller.js) — this keeps admin_users "admin data only" while
// still giving every role the exact same login endpoint/JWT/session shape.

const quoteIdent = (name) => `"${String(name).replace(/"/g, '""')}"`;

// Every account a login identifier could mean, in priority order: the tenant
// owner with that email, then employees whose login username matches, then
// employees whose contact email matches (people naturally type their email).
const _findLoginCandidates = async (identifier) => {
  const id = identifier.toLowerCase().trim();
  const candidates = [];

  const owner = await pool.query("SELECT * FROM public.admin_users WHERE lower(email) = $1 LIMIT 1", [id]);
  if (owner.rows[0]) candidates.push({ account: owner.rows[0], isEmployee: false });

  const { rows: schemas } = await pool.query(
    `SELECT DISTINCT a.tenant_schema AS s
       FROM public.admin_users a
       JOIN information_schema.tables t
         ON t.table_schema = a.tenant_schema AND t.table_name = 'employee_accounts'
      WHERE a.tenant_schema IS NOT NULL`
  );
  if (schemas.length) {
    const union = schemas
      .map(({ s }) =>
        `SELECT e.*, '${String(s).replace(/'/g, "''")}' AS tenant_schema_found,
                (lower(e.email) = $1) AS by_username
           FROM ${quoteIdent(s)}.employee_accounts e
          WHERE lower(e.email) = $1 OR lower(e.contact_email) = $1`)
      .join(" UNION ALL ");
    const { rows } = await pool.query(`SELECT * FROM (${union}) x ORDER BY by_username DESC`, [id]);
    for (const row of rows) {
      const { tenant_schema_found, by_username, ...employee } = row;
      candidates.push({ account: { ...employee, tenant_schema: tenant_schema_found }, isEmployee: true });
    }
  }
  return candidates;
};

// trialInfo ({is_active, trial_status, days_left}) is the ORG's state —
// same for the admin and every employee under them — so the Dashboard can
// show its "trial expired"/"suspended" popup without the API ever needing
// to block the request itself. See getTenantTrialSummary in trialManagement.js.
// The organization the account belongs to (the tenant owner's
// organization_name) — employees have no such column of their own.
const _organizationName = async (account, isEmployee) => {
  if (!isEmployee && account.organization_name) return account.organization_name;
  if (!account.tenant_schema) return null;
  const { data } = await supabase
    .from("admin_users")
    .select("organization_name")
    .eq("tenant_schema", account.tenant_schema)
    .eq("is_employee", false)
    .not("organization_name", "is", null)
    .limit(1)
    .maybeSingle();
  return data?.organization_name ?? null;
};

const _toUserResponse = (account, isEmployee, trialInfo, organizationName = null) => ({
  id: account.id,
  organization_name: organizationName,
  email: account.email,
  name: account.name,
  role: isEmployee ? account.role_title : account.role,
  is_employee: isEmployee,
  tenant_schema: account.tenant_schema,
  allowed_modules: isEmployee
      ? account.allowed_modules
      : account.allowed_modules,
  reports_to_id: isEmployee
      ? account.reports_to_id
      : null,
  is_active: trialInfo.is_active,
  trial_status: trialInfo.trial_status,
  days_left: trialInfo.days_left,
});
// POST /api/auth/login
export const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    

    if (!email || !password) {
      return res.status(400).json({ success: false, message: "Email and password are required" });
    }

    // const found = await _findAccount(email.toLowerCase().trim());
    // if (!found) {
    //   return res.status(401).json({ success: false, message: "Invalid email or password" });
    // }

    // const { account, isEmployee } = found;
    // const isValid = await bcrypt.compare(password, account.password);
    // if (!isValid) {
    //   return res.status(401).json({ success: false, message: "Invalid email or password" });
    // }
// The identifier can be an owner email, an employee username or an employee's
// contact email; the password decides between accounts sharing an identifier.
let found = null;
for (const candidate of await _findLoginCandidates(email)) {
  if (candidate.account.password && (await bcrypt.compare(password, candidate.account.password))) {
    found = candidate;
    break;
  }
}
if (!found) {
  return res.status(401).json({ success: false, message: "Invalid email or password" });
}

const { account, isEmployee } = found;
// Told only after the password checks out, so it doesn't reveal which accounts exist.
if (isEmployee && account.is_active === false) {
  return res.status(403).json({
    success: false,
    code: "ACCOUNT_DEACTIVATED",
    message: "Your login has been deactivated. Contact your administrator.",
  });
}

// No trial/suspension check here — login always succeeds once credentials
// are valid. trialInfo below is only for the Dashboard's popup.
const trialInfo = await getTenantTrialSummary(account.tenant_schema, isEmployee ? null : account);

  const token = jwt.sign(
  {
    id: account.id,
    email: account.email,
    role: isEmployee ? account.role_title : account.role,
    tenant_schema: account.tenant_schema,
    is_employee: isEmployee,
    allowed_modules: account.allowed_modules
  },
  process.env.JWT_SECRET,
  {
    expiresIn: process.env.JWT_EXPIRES_IN || "7d"
  }
);
    res.status(200).json({
      success: true,
      data: { token, user: _toUserResponse(account, isEmployee, trialInfo, await _organizationName(account, isEmployee)) },
    });
  } catch (err) {
    next(err);
  }
};

// GET /api/auth/me  (verify token + return current user)
// Look the caller up by id inside their own tenant — never by email, which
// could match an account in a different organization.
const _findAccountForToken = async (user) => {
  if (user.is_employee) {
    const { data } = await supabase
      .schema(user.tenant_schema)
      .from("employee_accounts")
      .select("*")
      .eq("id", user.id)
      .eq("is_active", true)
      .maybeSingle();
    return data ? { account: { ...data, tenant_schema: user.tenant_schema }, isEmployee: true } : null;
  }
  const { data } = await supabase
    .from("admin_users")
    .select("*")
    .eq("id", user.id)
    .eq("tenant_schema", user.tenant_schema)
    .maybeSingle();
  return data ? { account: data, isEmployee: false } : null;
};

export const getMe = async (req, res, next) => {
  try {
    const found = await _findAccountForToken(req.user);
    if (!found) {
      return res.status(404).json({ success: false, message: "User not found" });
    }
    const trialInfo = await getTenantTrialSummary(
      found.account.tenant_schema,
      found.isEmployee ? null : found.account
    );
    res.status(200).json({ success: true, data: _toUserResponse(found.account, found.isEmployee, trialInfo, await _organizationName(found.account, found.isEmployee)) });
  } catch (err) {
    next(err);
  }
};

// POST /api/auth/register
export const register = async (req, res, next) => {
  try {
    const { email, password, name, organization_name } = req.body;

    let data;
    try {
      data = await createTenantAdmin({ email, password, name, organizationName: organization_name });
    } catch (err) {
      if (err instanceof TenantProvisioningError) {
        return res.status(err.statusCode).json({ success: false, message: err.message });
      }
      throw err;
    }

    // Fire-and-forget notification to info@impacgo.com
    sendSignupNotification({ name: name.trim(), email: email.toLowerCase().trim(), organization_name, req });

    const token = jwt.sign(
      {
        id: data.id,
        email: data.email,
        role: data.role,
        tenant_schema: data.tenant_schema,
        is_employee: false,
        allowed_modules: data.allowed_modules,
      },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || "7d" }
    );

    const trialInfo = await getTenantTrialSummary(data.tenant_schema, data);

    res.status(201).json({
      success: true,
      data: { token, user: _toUserResponse(data, false, trialInfo, data?.organization_name ?? null) },
    });
  } catch (err) {
    next(err);
  }
};
