import bcrypt from "bcryptjs";
import { supabase } from "../config/supabase.js";
import { wouldCreateHierarchyCycle } from "../utils/hierarchy.js";

const EMPLOYEE_FIELDS = "id, email, name, role, allowed_modules, is_active, reports_to_id, created_at";

// GET /api/employees
export const getAllEmployees = async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from("admin_users")
      .select(EMPLOYEE_FIELDS)
      .eq("is_employee", true)
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
    // Only a super admin caller gets free choice of reportsToId.
    let resolvedReportsTo = reportsToId ?? null;
    const { data: caller } = await supabase
      .from("admin_users").select("id, is_employee").eq("id", req.user.id).single();
    if (caller?.is_employee === true) resolvedReportsTo = caller.id;

    const hashedPassword = await bcrypt.hash(password, 10);

    const { data, error } = await supabase
      .from("admin_users")
      .insert([{
        email: username.toLowerCase().trim(),
        password: hashedPassword,
        name: username.trim(),
        role: roleTitle,
        is_employee: true,
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
      .from("admin_users").select("id").eq("id", id).eq("is_employee", true).single();
    if (fetchError || !existing) return res.status(404).json({ success: false, message: "Employee not found" });

    const updates = {};
    if (roleTitle !== undefined) updates.role = roleTitle;
    if (allowedModuleIndices !== undefined) updates.allowed_modules = allowedModuleIndices;
    if (password) updates.password = await bcrypt.hash(password, 10);

    if (Object.prototype.hasOwnProperty.call(req.body, "reportsToId")) {
      const reportsToId = req.body.reportsToId;
      if (reportsToId === id) {
        return res.status(400).json({ success: false, message: "An employee can't report to themselves" });
      }
      if (reportsToId) {
        const { data: allRows, error: rowsError } = await supabase.from("admin_users").select("id, reports_to_id");
        if (rowsError) throw rowsError;
        if (wouldCreateHierarchyCycle(allRows, id, reportsToId)) {
          return res.status(400).json({ success: false, message: "That would create a reporting cycle" });
        }
      }
      updates.reports_to_id = reportsToId ?? null;
    }

    const { data, error } = await supabase
      .from("admin_users")
      .update(updates)
      .eq("id", id)
      .select(EMPLOYEE_FIELDS)
      .single();

    if (error) throw error;
    res.status(200).json({ success: true, data });
  } catch (err) {
    next(err);
  }
};

// DELETE /api/employees/:id
export const deleteEmployee = async (req, res, next) => {
  try {
    const { data: existing, error: fetchError } = await supabase
      .from("admin_users").select("id").eq("id", req.params.id).eq("is_employee", true).single();
    if (fetchError || !existing) return res.status(404).json({ success: false, message: "Employee not found" });

    const { error } = await supabase.from("admin_users").delete().eq("id", req.params.id);
    if (error) throw error;
    res.status(200).json({ success: true, message: "Employee deleted" });
  } catch (err) {
    next(err);
  }
};
