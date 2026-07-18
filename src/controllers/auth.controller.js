import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { supabase } from "../config/supabase.js";
import { tenantDb } from "../utils/tenantDb.js";

// admin_users holds only the super-admin account(s). Staff logins created
// via the Employees screen live in their own employee_accounts table (see
// employee.controller.js) — this keeps admin_users "admin data only" while
//still giving every role the exact same login endpoint/JWT/session shape.
// const _findAccount = async (email) => {
//   const { data: admin, error: error} = await supabase
//     .from("admin_users")
//     .select("*")
//     .eq("email", email)
//     .eq("is_active", true)
//     .maybeSingle();
//   if (admin) return { account: admin, isEmployee: false };


// console.log("Admin Query Data:", admin);
// console.log("Admin Query Error:", error);

//   // const { data: employee } = await supabase
//   //   .from("employee_accounts")
//   //   .select("*")
//   //   .eq("email", email)
//   //   .eq("is_active", true)
//   //   .maybeSingle();
//   // if (employee) return { account: employee, isEmployee: true };

//   // return null;
//   try {
//   const db = supabase.schema(req.tenantSchema); // or any tenant schema string

//   const { data: employee, error } = await db
//     .from("employee_accounts")
//     .select("*")
//     .eq("email", email)
//     .eq("is_active", true)
//     .maybeSingle();

//   if (error) {
//     console.error("Employee query error:", error);
//     return null;
//   }

//   if (employee) {
//     return {
//       account: employee,
//       isEmployee: true,
//     };
//   }

//   return null;
// } catch (err) {
//   console.error("Employee lookup exception:", err);
//   return null;
// }
// };
const _findAccount = async (email) => {
  // Check global admin first
  const { data: admin } = await supabase
    .from("admin_users")
    .select("*")
    .eq("email", email)
    .eq("is_active", true)
    .maybeSingle();

  if (admin) {
    return {
      account: admin,
      isEmployee: false,
    };
  }

  // Get all tenant schemas
  const { data: tenants, error } = await supabase
    .from("admin_users")
    .select("tenant_schema")
    .not("tenant_schema", "is", null);

  if (error) {
    console.error(error);
    return null;
  }

  // Search every tenant
  for (const tenant of tenants) {
    try {
      const db = supabase.schema(tenant.tenant_schema);

      const { data: employee, error } = await db
        .from("employee_accounts")
        .select("*")
        .eq("email", email)
        .eq("is_active", true)
        .maybeSingle();

      if (error) {
        console.error(`Error in schema ${tenant.tenant_schema}:`, error);
        continue;
      }

      if (employee) {
        employee.tenant_schema = tenant.tenant_schema;

        return {
          account: employee,
          isEmployee: true,
        };
      }
    } catch (err) {
      console.error(`Schema ${tenant.tenant_schema} failed:`, err);
    }
  }

  return null;
};

const _toUserResponse = (account, isEmployee) => ({
  id: account.id,
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
const found = await _findAccount(email.toLowerCase().trim());

console.log("=================================");
console.log("Login email:", email);
console.log("Found account:", found);

if (!found) {
  console.log("❌ User not found");
  return res.status(401).json({
    success: false,
    message: "Invalid email or password",
  });
}

const { account, isEmployee } = found;

console.log("Stored hash:", account.password);

const isValid = await bcrypt.compare(password, account.password);

console.log("Password valid:", isValid);

if (!isValid) {
  console.log("❌ Password mismatch");
  return res.status(401).json({
    success: false,
    message: "Invalid email or password",
  });
}

console.log("✅ Login successful");
console.log("=================================");
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
