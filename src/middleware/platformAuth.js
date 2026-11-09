// Guards every /api/platform/* route. Deliberately separate from
// src/middleware/auth.js's `authenticate` — that one gates access on a
// TENANT's trial/subscription state (isTenantExpired). Platform Super
// Admin sessions must NEVER be subject to any tenant's trial state, so
// this middleware doesn't call isTenantExpired at all: a platform admin
// stays able to log in and manage tenants regardless of any tenant's
// trial having expired.
import jwt from "jsonwebtoken";
import { pool } from "../config/supabase.js";

export const PLATFORM_ROLE = "platform_super_admin";

// Tenant tokens share the JWT secret, and an employee's role claim is their
// free-text role title — so the role claim alone can't prove platform access.
// A platform token must carry no tenant and belong to an active platform_admins row.
export const isPlatformAdminToken = async (decoded) => {
  if (decoded?.role !== PLATFORM_ROLE || decoded.tenant_schema || decoded.is_employee) return false;
  const { rows } = await pool.query(
    "SELECT 1 FROM public.platform_admins WHERE id::text = $1 AND is_active = true",
    [String(decoded.id)]
  );
  return rows.length === 1;
};

export const authenticatePlatform = async (req, res, next) => {
  let decoded;
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ success: false, message: "No token provided" });
    }
    decoded = jwt.verify(authHeader.split(" ")[1], process.env.JWT_SECRET);
  } catch (err) {
    return res.status(401).json({ success: false, message: "Invalid or expired token" });
  }

  try {
    if (!(await isPlatformAdminToken(decoded))) {
      return res.status(403).json({ success: false, message: "Platform admin access required" });
    }
    req.platformAdmin = decoded;
    next();
  } catch (err) {
    next(err);
  }
};
