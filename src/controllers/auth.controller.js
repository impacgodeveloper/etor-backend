import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { supabase } from "../config/supabase.js";

// admin_users holds only the super-admin account(s). Staff logins created
// via the Employees screen live in their own employee_accounts table (see
// employee.controller.js) — this keeps admin_users "admin data only" while
// still giving every role the exact same login endpoint/JWT/session shape.
const _findAccount = async (email) => {
  const { data: admin } = await supabase
    .from("admin_users")
    .select("*")
    .eq("email", email)
    .eq("is_active", true)
    .maybeSingle();
  if (admin) return { account: admin, isEmployee: false };

  const { data: employee } = await supabase
    .from("employee_accounts")
    .select("*")
    .eq("email", email)
    .eq("is_active", true)
    .maybeSingle();
  if (employee) return { account: employee, isEmployee: true };

  return null;
};

const _toUserResponse = (account, isEmployee) => ({
  id: account.id,
  email: account.email,
  name: account.name,
  role: isEmployee ? account.role_title : account.role,
  is_employee: isEmployee,
  allowed_modules: isEmployee ? account.allowed_modules : null,
  reports_to_id: isEmployee ? account.reports_to_id : null,
});

// POST /api/auth/login
export const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, message: "Email and password are required" });
    }

    const found = await _findAccount(email.toLowerCase().trim());
    if (!found) {
      return res.status(401).json({ success: false, message: "Invalid email or password" });
    }

    const { account, isEmployee } = found;
    const isValid = await bcrypt.compare(password, account.password);
    if (!isValid) {
      return res.status(401).json({ success: false, message: "Invalid email or password" });
    }

    const token = jwt.sign(
      { id: account.id, email: account.email, role: isEmployee ? account.role_title : account.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || "7d" }
    );

    res.status(200).json({
      success: true,
      data: { token, user: _toUserResponse(account, isEmployee) },
    });
  } catch (err) {
    next(err);
  }
};

// GET /api/auth/me  (verify token + return current user)
export const getMe = async (req, res, next) => {
  try {
    const found = await _findAccount(req.user.email.toLowerCase().trim());
    if (!found) {
      return res.status(404).json({ success: false, message: "User not found" });
    }
    res.status(200).json({ success: true, data: _toUserResponse(found.account, found.isEmployee) });
  } catch (err) {
    next(err);
  }
};
