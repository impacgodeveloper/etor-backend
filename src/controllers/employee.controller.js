import bcrypt from "bcryptjs";
import { supabase } from "../config/supabase.js";

// Employees are rows in admin_users (is_employee = true) — they log in
// through the same /api/auth/login as the super admin, just with a
// restricted allowed_modules list instead of full access.

// GET /api/employees
export const getAllEmployees = async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from("admin_users")
      .select("id, email, name, role, allowed_modules, is_active, created_at")
      .eq("is_employee", true)
      .order("created_at", { ascending: false });

    if (error) throw error;
    res.status(200).json({ success: true, count: data.length, data });
  } catch (err) {
    next(err);
  }
};

// POST /api/employees
// body: { username, password, roleTitle, allowedModuleIndices }
export const createEmployee = async (req, res, next) => {
  try {
    const { username, password, roleTitle, allowedModuleIndices } = req.body;

    if (!username || !password || !roleTitle) {
      return res.status(400).json({ success: false, message: "username, password and roleTitle are required" });
    }
    if (password.length < 4) {
      return res.status(400).json({ success: false, message: "Password must be at least 4 characters" });
    }
    if (!Array.isArray(allowedModuleIndices) || allowedModuleIndices.length === 0) {
      return res.status(400).json({ success: false, message: "Select at least one module for this employee" });
    }

    const normalizedUsername = username.toLowerCase().trim();
    const password_hash = await bcrypt.hash(password, 10);

    const { data, error } = await supabase
      .from("admin_users")
      .insert([{
        email: normalizedUsername,
        password_hash,
        name: username.trim(),
        role: roleTitle,
        is_employee: true,
        allowed_modules: allowedModuleIndices,
        is_active: true,
        created_by: req.user?.id || null,
      }])
      .select("id, email, name, role, allowed_modules, is_active, created_at")
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
// body: any of { roleTitle, allowedModuleIndices, password, isActive }
export const updateEmployee = async (req, res, next) => {
  try {
    const { roleTitle, allowedModuleIndices, password, isActive } = req.body;
    const updates = {};
    if (roleTitle !== undefined) updates.role = roleTitle;
    if (allowedModuleIndices !== undefined) updates.allowed_modules = allowedModuleIndices;
    if (isActive !== undefined) updates.is_active = isActive;
    if (password) {
      if (password.length < 4) {
        return res.status(400).json({ success: false, message: "Password must be at least 4 characters" });
      }
      updates.password_hash = await bcrypt.hash(password, 10);
    }

    const { data, error } = await supabase
      .from("admin_users")
      .update(updates)
      .eq("id", req.params.id)
      .eq("is_employee", true)
      .select("id, email, name, role, allowed_modules, is_active, created_at")
      .single();

    if (error) throw error;
    if (!data) return res.status(404).json({ success: false, message: "Employee not found" });
    res.status(200).json({ success: true, data });
  } catch (err) {
    next(err);
  }
};

// DELETE /api/employees/:id
export const deleteEmployee = async (req, res, next) => {
  try {
    const { error } = await supabase
      .from("admin_users")
      .delete()
      .eq("id", req.params.id)
      .eq("is_employee", true);

    if (error) throw error;
    res.status(200).json({ success: true, message: "Employee deleted" });
  } catch (err) {
    next(err);
  }
};
