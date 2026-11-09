import { pool } from "../config/supabase.js";

// Role titles that would let an employee token pass for another identity.
const RESERVED_ROLES = new Set(["partner", "admin", "super_admin", "super admin", "superadmin", "platform_super_admin"]);

export const isReservedRole = (roleTitle) =>
  RESERVED_ROLES.has(String(roleTitle || "").trim().toLowerCase());

const quoteIdent = (name) => `"${String(name).replace(/"/g, '""')}"`;

// Staff log in with email only (no organization picker), and login searches
// every tenant — so a staff email must be unique across ALL organizations,
// both as a tenant owner (public.admin_users) and as any tenant's employee.
export const isStaffEmailTaken = async (email) => {
  const normalized = String(email || "").toLowerCase().trim();
  const owner = await pool.query("SELECT 1 FROM public.admin_users WHERE lower(email) = $1 LIMIT 1", [normalized]);
  if (owner.rows.length) return true;

  const { rows: schemas } = await pool.query(
    `SELECT DISTINCT a.tenant_schema AS s
       FROM public.admin_users a
       JOIN information_schema.tables t
         ON t.table_schema = a.tenant_schema AND t.table_name = 'employee_accounts'
      WHERE a.tenant_schema IS NOT NULL`
  );
  if (!schemas.length) return false;

  const union = schemas
    .map(({ s }) => `SELECT 1 FROM ${quoteIdent(s)}.employee_accounts WHERE lower(email) = $1`)
    .join(" UNION ALL ");
  const { rows } = await pool.query(`SELECT 1 FROM (${union}) x LIMIT 1`, [normalized]);
  return rows.length > 0;
};
