import bcrypt from "bcryptjs";
import { supabase } from "../config/supabase.js";
import { wouldCreateCycle } from "../utils/hierarchy.js";

// admin_users holds ONLY the super-admin account(s). Every staff login
// created via this controller lives in its own employee_accounts table, so
// admin_users stays "admin data only". The two tables share the same login
// endpoint (see auth.controller.js), so nothing about how a user logs in or
// how permissions are enforced in the Flutter app changes.
const EMPLOYEE_FIELDS = "id, email, name, role:role_title, allowed_modules, is_active, reports_to_id, created_at";

// Every newly created (or renamed) employee is also mirrored into
// sales_team_members so they immediately show up in the Sales module's team
// roster without being re-entered there. This is a best-effort side effect —
// it never fails the employee create/update/delete request itself.
const _mirrorTeamMemberInsert = async ({ name, roleTitle, email }) => {
  const { error } = await supabase.from("sales_team_members").insert([{
    name,
    role_title: roleTitle,
    email,
    commission_rate: 1.0,
    target: 0,
  }]);
  if (error) console.error("sales_team_members mirror insert failed:", error.message);
};

const _mirrorTeamMemberRoleUpdate = async (email, roleTitle) => {
  const { error } = await supabase.from("sales_team_members").update({ role_title: roleTitle }).eq("email", email);
  if (error) console.error("sales_team_members mirror update failed:", error.message);
};

const _mirrorTeamMemberDelete = async (email) => {
  const { error } = await supabase.from("sales_team_members").delete().eq("email", email);
  if (error) console.error("sales_team_members mirror delete failed:", error.message);
};

// Resolves whether the caller (from the JWT) is the super admin (admin_users)
// or a staff login (employee_accounts) — the two tables that together make
// up "who can log in".
const _resolveCaller = async (callerId) => {
  const { data: admin } = await supabase.from("admin_users").select("id").eq("id", callerId).maybeSingle();
  if (admin) return { id: admin.id, isEmployee: false };

  const { data: employee } = await supabase.from("employee_accounts").select("id").eq("id", callerId).maybeSingle();
  if (employee) return { id: employee.id, isEmployee: true };

  return null;
};

// GET /api/employees
export const getAllEmployees = async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from("employee_accounts")
      .select(EMPLOYEE_FIELDS)
      .order("created_at", { ascending: false });

    if (error) throw error;
    res.status(200).json({ success: true, count: data.length, data });
  } catch (err) {
    next(err);
  }
};

// POST /api/employees
export const createEmployee = async (req, res, next) => {
  try {
    const { username, password, roleTitle, allowedModuleIndices, reportsToId } = req.body;
    if (!username || !password || !roleTitle) {
      return res.status(400).json({ success: false, message: "username, password and roleTitle are required" });
    }

    // A regular employee always becomes the new hire's manager, resolved
    // from the caller's own session — never trusted from the request body.
    // Only the super admin caller gets free choice of reportsToId.
    let resolvedReportsTo = reportsToId ?? null;
    const caller = await _resolveCaller(req.user.id);
    if (caller?.isEmployee === true) resolvedReportsTo = caller.id;

    const normalizedEmail = username.toLowerCase().trim();
    const hashedPassword = await bcrypt.hash(password, 10);

    const { data, error } = await supabase
      .from("employee_accounts")
      .insert([{
        email: normalizedEmail,
        password: hashedPassword,
        name: username.trim(),
        role_title: roleTitle,
        allowed_modules: allowedModuleIndices ?? [],
        is_active: true,
        reports_to_id: resolvedReportsTo,
      }])
      .select(EMPLOYEE_FIELDS)
      .single();

    if (error) {
      if (error.code === "23505") return res.status(409).json({ success: false, message: "This username is already in use" });
      throw error;
    }

    await _mirrorTeamMemberInsert({ name: username.trim(), roleTitle, email: normalizedEmail });

    res.status(201).json({ success: true, data });
  } catch (err) {
    next(err);
  }
};

// PUT /api/employees/:id
export const updateEmployee = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { roleTitle, allowedModuleIndices, password } = req.body;

    const { data: existing, error: fetchError } = await supabase
      .from("employee_accounts").select("id, email").eq("id", id).single();
    if (fetchError || !existing) return res.status(404).json({ success: false, message: "Employee not found" });

    const updates = {};
    if (roleTitle !== undefined) updates.role_title = roleTitle;
    if (allowedModuleIndices !== undefined) updates.allowed_modules = allowedModuleIndices;
    if (password) updates.password = await bcrypt.hash(password, 10);

    if (Object.prototype.hasOwnProperty.call(req.body, "reportsToId")) {
      const reportsToId = req.body.reportsToId;
      if (reportsToId === id) {
        return res.status(400).json({ success: false, message: "An employee can't report to themselves" });
      }
      if (reportsToId) {
        const { data: allRows, error: rowsError } = await supabase.from("employee_accounts").select("id, reports_to_id");
        if (rowsError) throw rowsError;
        if (wouldCreateCycle(allRows, id, reportsToId)) {
          return res.status(400).json({ success: false, message: "That would create a reporting cycle" });
        }
      }
      updates.reports_to_id = reportsToId ?? null;
    }

    const { data, error } = await supabase
      .from("employee_accounts")
      .update(updates)
      .eq("id", id)
      .select(EMPLOYEE_FIELDS)
      .single();

    if (error) throw error;

    if (roleTitle !== undefined) await _mirrorTeamMemberRoleUpdate(existing.email, roleTitle);

    res.status(200).json({ success: true, data });
  } catch (err) {
    next(err);
  }
};

// DELETE /api/employees/:id
export const deleteEmployee = async (req, res, next) => {
  try {
    const { data: existing, error: fetchError } = await supabase
      .from("employee_accounts").select("id, email").eq("id", req.params.id).single();
    if (fetchError || !existing) return res.status(404).json({ success: false, message: "Employee not found" });

    const { error } = await supabase.from("employee_accounts").delete().eq("id", req.params.id);
    if (error) throw error;

    await _mirrorTeamMemberDelete(existing.email);

    res.status(200).json({ success: true, message: "Employee deleted" });
  } catch (err) {
    next(err);
  }
};
