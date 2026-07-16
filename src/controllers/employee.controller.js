import bcrypt from "bcryptjs";
import { supabase } from "../config/supabase.js";
import { ADMIN_ROLE, canCreateRole, getRequiredManagerRole, wouldCreateCycle } from "../utils/hierarchy.js";

// admin_users holds ONLY the super-admin account(s). Every staff login
// created via this controller lives in its own employee_accounts table, so
// admin_users stays "admin data only". The two tables share the same login
// endpoint (see auth.controller.js), so nothing about how a user logs in or
// how permissions are enforced in the Flutter app changes.
const EMPLOYEE_FIELDS = "id, email, name, role:role_title, allowed_modules, is_active, reports_to_id, created_at, contact_email, phone_number";

// Every newly created (or renamed) employee is also mirrored into
// sales_team_members so they immediately show up in the Sales module's team
// roster without being re-entered there. This is a best-effort side effect —
// it never fails the employee create/update/delete request itself.
const _mirrorTeamMemberInsert = async ({
  name,
  roleTitle,
  email,
  phone,
  reportsToId,
}) => {
  let salesReportsToId = null;

  if (reportsToId) {
    const { data: managerEmployee } = await supabase
      .from("employee_accounts")
      .select("email")
      .eq("id", reportsToId)
      .single();

    if (managerEmployee) {
      const { data: managerSales } = await supabase
        .from("sales_team_members")
        .select("id")
        .eq("email", managerEmployee.email)
        .single();

      salesReportsToId = managerSales?.id ?? null;
    }
  }

  const { error } = await supabase.from("sales_team_members").insert([
    {
      name,
      role_title: roleTitle,
      email,
      phone,
      commission_rate: 1.0,
      target: 0,
      reports_to_id: salesReportsToId,
    },
  ]);

  if (error) {
    console.error(
      "sales_team_members mirror insert failed:",
      error.message
    );
  }
};

const _mirrorTeamMemberRoleUpdate = async (email, roleTitle) => {
  const { error } = await supabase.from("sales_team_members").update({ role_title: roleTitle }).eq("email", email);
  if (error) console.error("sales_team_members mirror update failed:", error.message);
};

const _mirrorTeamMemberPhoneUpdate = async (email, phone) => {
  const { error } = await supabase
    .from("sales_team_members")
    .update({
      phone,
    })
    .eq("email", email);

  if (error) {
    console.error(
      "sales_team_members phone update failed:",
      error.message
    );
  }
};

const _mirrorTeamMemberReportsToUpdate = async (
  employeeEmail,
  managerEmployeeId,
) => {
  let salesReportsToId = null;

  if (managerEmployeeId) {
    const { data: managerEmployee } = await supabase
      .from("employee_accounts")
      .select("email")
      .eq("id", managerEmployeeId)
      .single();

    if (managerEmployee) {
      const { data: managerSales } = await supabase
        .from("sales_team_members")
        .select("id")
        .eq("email", managerEmployee.email)
        .single();

      salesReportsToId = managerSales?.id ?? null;
    }
  }

  const { error } = await supabase
    .from("sales_team_members")
    .update({
      reports_to_id: salesReportsToId,
    })
    .eq("email", employeeEmail);

  if (error) {
    console.error(
      "sales_team_members reports_to update failed:",
      error.message
    );
  }
};

const _mirrorTeamMemberDelete = async (email) => {
  const { error } = await supabase.from("sales_team_members").delete().eq("email", email);
  if (error) console.error("sales_team_members mirror delete failed:", error.message);
};

// Resolves whether the caller (from the JWT) is the super admin (admin_users)
// or a staff login (employee_accounts) — the two tables that together make
// up "who can log in". `role` is ADMIN_ROLE for the super admin, or the
// employee's own role_title — used to enforce the hierarchy rules below.
const _resolveCaller = async (callerId) => {
  const { data: admin } = await supabase.from("admin_users").select("id").eq("id", callerId).maybeSingle();
  if (admin) return { id: admin.id, isEmployee: false, role: ADMIN_ROLE };

  const { data: employee } = await supabase.from("employee_accounts").select("id, role_title").eq("id", callerId).maybeSingle();
  if (employee) return { id: employee.id, isEmployee: true, role: employee.role_title };

  return null;
};

// Looks up a candidate manager's own role, used to confirm they hold
// exactly the role required by the hierarchy (e.g. a Sales Manager must
// report to a Branch Manager, not just anyone).
const _findEmployeeRole = async (id) => {
  const { data } = await supabase.from("employee_accounts").select("id, role_title").eq("id", id).maybeSingle();
  return data ?? null;
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
    const { username, password, roleTitle, allowedModuleIndices, reportsToId, contactEmail, phoneNumber } = req.body;
    if (!username || !password || !roleTitle || !contactEmail || !phoneNumber) {
      return res.status(400).json({ success: false, message: "username, password, roleTitle, contactEmail and phoneNumber are required" });
    }

    const caller = await _resolveCaller(req.user.id);
    let resolvedReportsTo = reportsToId ?? null;

    // Strict hierarchy roles (President > Vice President > Branch Manager >
    // Sales Manager > Sales Executive > Sales Associates) must report to
    // someone holding exactly the role above them, and only a role that
    // outranks the target may create it. Anything else (e.g. "Others") keeps
    // the original, unrestricted behavior below.
    const requiredManagerRole = getRequiredManagerRole(roleTitle);
    if (requiredManagerRole) {
      if (caller?.isEmployee === true && !canCreateRole(caller.role, roleTitle)) {
        return res.status(403).json({ success: false, message: `Your role isn't authorized to create a ${roleTitle}.` });
      }

      if (requiredManagerRole === ADMIN_ROLE) {
        // President reports directly to the super admin, not another
        // employee row — ignore any reportsToId sent for this role.
        resolvedReportsTo = null;
      } else if (caller?.isEmployee === true && caller.role === requiredManagerRole) {
        // The caller already holds the required manager role for this hire
        // — resolved from their own session, never trusted from the body.
        resolvedReportsTo = caller.id;
      } else {
        const manager = resolvedReportsTo ? await _findEmployeeRole(resolvedReportsTo) : null;
        if (!manager || manager.role_title !== requiredManagerRole) {
          return res.status(400).json({
            success: false,
            message: `A ${roleTitle} must report to a ${requiredManagerRole}.`,
          });
        }
      }
    } else if (caller?.isEmployee === true) {
      // Unchanged legacy behavior for roles outside the strict hierarchy: a
      // regular employee always becomes the new hire's manager, resolved
      // from the caller's own session — never trusted from the request
      // body. Only the super admin caller gets free choice of reportsToId.
      resolvedReportsTo = caller.id;
    }

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
        contact_email: contactEmail.trim(),
        phone_number: phoneNumber.trim(),
      }])
      .select(EMPLOYEE_FIELDS)
      .single();

    if (error) {
      if (error.code === "23505") return res.status(409).json({ success: false, message: "This username is already in use" });
      throw error;
    }

    await _mirrorTeamMemberInsert({
      name: username.trim(),
      roleTitle,
      email: normalizedEmail,
      phone: phoneNumber.trim(),
      reportsToId: resolvedReportsTo,
    });

    res.status(201).json({ success: true, data });
  } catch (err) {
    next(err);
  }
};

// PUT /api/employees/:id
export const updateEmployee = async (req, res, next) => {
  try {
    const { id } = req.params;
    const {
      roleTitle,
      allowedModuleIndices,
      password,
      phoneNumber,
    } = req.body;

    const { data: existing, error: fetchError } = await supabase
      .from("employee_accounts").select("id, email, role_title, reports_to_id").eq("id", id).single();
    if (fetchError || !existing) return res.status(404).json({ success: false, message: "Employee not found" });

    const updates = {};
    if (roleTitle !== undefined) updates.role_title = roleTitle;
    if (allowedModuleIndices !== undefined) updates.allowed_modules = allowedModuleIndices;
    if (password) updates.password = await bcrypt.hash(password, 10);
    if (phoneNumber !== undefined) {
      updates.phone_number = phoneNumber.trim();
    }

    const touchesReportsTo = Object.prototype.hasOwnProperty.call(req.body, "reportsToId");
    if (touchesReportsTo) {
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

    // Same strict-hierarchy rule as createEmployee: whenever the resulting
    // role (existing, or the one this request is changing it to) is one of
    // the six ranked roles, its manager (existing, or the one this request
    // is changing it to) must hold exactly the role above it.
    const effectiveRole = roleTitle !== undefined ? roleTitle : existing.role_title;
    const requiredManagerRole = getRequiredManagerRole(effectiveRole);
    if (requiredManagerRole && (touchesReportsTo || roleTitle !== undefined)) {
      const effectiveReportsTo = touchesReportsTo ? (req.body.reportsToId ?? null) : existing.reports_to_id;
      if (requiredManagerRole === ADMIN_ROLE) {
        if (effectiveReportsTo) {
          return res.status(400).json({
            success: false,
            message: `A ${effectiveRole} must report directly to the admin, not another employee.`,
          });
        }
      } else {
        const manager = effectiveReportsTo ? await _findEmployeeRole(effectiveReportsTo) : null;
        if (!manager || manager.role_title !== requiredManagerRole) {
          return res.status(400).json({
            success: false,
            message: `A ${effectiveRole} must report to a ${requiredManagerRole}.`,
          });
        }
      }
    }

    const { data, error } = await supabase
      .from("employee_accounts")
      .update(updates)
      .eq("id", id)
      .select(EMPLOYEE_FIELDS)
      .single();

    if (error) throw error;

    if (touchesReportsTo) {
      await _mirrorTeamMemberReportsToUpdate(
        existing.email,
        req.body.reportsToId ?? null,
      );
    }

    if (roleTitle !== undefined) {
      await _mirrorTeamMemberRoleUpdate(existing.email, roleTitle);
    }

    if (phoneNumber !== undefined) {
      await _mirrorTeamMemberPhoneUpdate(
        existing.email,
        phoneNumber.trim(),
      );
    }

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
