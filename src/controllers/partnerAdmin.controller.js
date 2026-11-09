import bcrypt from "bcryptjs";
import { tenantDb, publicDb } from "../utils/tenantDb.js";

const withoutSecrets = (row) => {
  if (!row) return row;
  const { password, password_hash, ...safe } = row;
  return safe;
};

// GET /api/partners
export const getAllPartners = async (req, res, next) => {
  try {
    const db = tenantDb(req);
    const { data, error } = await db
      .from("partners")
      .select("id, name, email, phone, address, joined_date, portfolio_value, profile_image_url, created_at")
      .order("created_at", { ascending: false });

    if (error) throw error;
    res.status(200).json({ success: true, count: data.length, data });
  } catch (err) {
    next(err);
  }
};

// GET /api/partners/:id
export const getPartnerById = async (req, res, next) => {
  try {
    const db = tenantDb(req);
    const { data, error } = await db
      .from("partners")
      .select("id, name, email, phone, address, joined_date, portfolio_value, profile_image_url, created_at")
      .eq("id", req.params.id)
      .single();

    if (error) throw error;
    if (!data) return res.status(404).json({ success: false, message: "Partner not found" });
    res.status(200).json({ success: true, data });
  } catch (err) {
    next(err);
  }
};

// POST /api/partners
export const createPartner = async (req, res, next) => {
  try {
    const db = tenantDb(req);

    const {
      name,
      email,
      phone,
      address,
      portfolio_value,
      profile_image_url,
      password,
    } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({
        success: false,
        message: "name, email and password are required",
      });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // partner_registry.email is the single global identity a partner logs in
    // with (the Partner app's login screen only ever asks for email —
    // there's no tenant/company selector), so reject up front if this email
    // already belongs to a DIFFERENT tenant instead of silently overwriting
    // the registry mapping and breaking that other tenant's partner's login.
    const { data: existingRegistry } = await publicDb()
      .from("partner_registry")
      .select("schema_name")
      .eq("email", normalizedEmail)
      .maybeSingle();
    if (existingRegistry && existingRegistry.schema_name !== req.tenantSchema) {
      return res.status(409).json({
        success: false,
        message: "This email is already registered as a partner under a different organization",
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    // Insert into tenant schema
    const { data, error } = await db
      .from("partners")
      .insert([
        {
          name,
          email: normalizedEmail,
          phone,
          address,
          portfolio_value: portfolio_value || 0,
          profile_image_url,
          password: hashedPassword,
        },
      ])
      .select()
      .single();

    if (error) {
      console.error("Partner insert error:", error);

      if (error.code === "23505") {
        return res.status(409).json({
          success: false,
          message: "Email already exists",
        });
      }

      throw error;
    }

    // Map the login email to this tenant. Insert (never upsert) so a race with
    // another organization can't silently take over its partner's login.
    let registryData = existingRegistry;
    if (!existingRegistry) {
      const { data: inserted, error: registryError } = await publicDb()
        .from("partner_registry")
        .insert({ email: normalizedEmail, schema_name: req.tenantSchema })
        .select()
        .single();
      if (registryError) {
        await db.from("partners").delete().eq("id", data.id);
        const taken = registryError.code === "23505";
        return res.status(taken ? 409 : 500).json({
          success: false,
          message: taken
            ? "This email is already registered as a partner under a different organization"
            : "Could not register the partner's login",
        });
      }
      registryData = inserted;
    }

    return res.status(201).json({
      success: true,
      data: withoutSecrets(data),
      registry: registryData,
    });
  } catch (err) {
    console.error("createPartner error:", err);
    next(err);
  }
};
// PUT /api/partners/:id
export const updatePartner = async (req, res, next) => {
  try {
    const db = tenantDb(req);
    const { id, created_at, password_hash, ...updates } = req.body || {};

    let oldEmail = null;
    if (updates.email) {
      const { data: existing } = await db.from("partners").select("email").eq("id", req.params.id).single();
      oldEmail = existing?.email;
      updates.email = updates.email.toLowerCase().trim();

      // Same cross-tenant collision guard as createPartner — only relevant
      // when the email is actually changing to something new.
      if (updates.email !== oldEmail) {
        const { data: existingRegistry } = await publicDb()
          .from("partner_registry")
          .select("schema_name")
          .eq("email", updates.email)
          .maybeSingle();
        if (existingRegistry && existingRegistry.schema_name !== req.tenantSchema) {
          return res.status(409).json({
            success: false,
            message: "This email is already registered as a partner under a different organization",
          });
        }
      }
    }
    if (updates.password) updates.password = await bcrypt.hash(updates.password, 10);

    const { data, error } = await db
      .from("partners")
      .update(updates)
      .eq("id", req.params.id)
      .select()
      .single();

    if (error) throw error;

    // Keep registry in sync if email changed
    if (updates.email && oldEmail && oldEmail !== updates.email) {
      await publicDb().from("partner_registry").delete().eq("email", oldEmail).eq("schema_name", req.tenantSchema);
      await publicDb().from("partner_registry").insert({ email: updates.email, schema_name: req.tenantSchema });
    }

    res.status(200).json({ success: true, data: withoutSecrets(data) });
  } catch (err) {
    next(err);
  }
};

// DELETE /api/partners/:id
export const deletePartner = async (req, res, next) => {
  try {
    const db = tenantDb(req);

    // Fetch email before deletion so we can clean up the registry
    const { data: partner } = await db.from("partners").select("email").eq("id", req.params.id).single();

    const { error } = await db.from("partners").delete().eq("id", req.params.id);
    if (error) throw error;

    // Remove from public registry
    if (partner?.email) {
      await publicDb().from("partner_registry").delete().eq("email", partner.email).eq("schema_name", req.tenantSchema);
    }

    res.status(200).json({ success: true, message: "Partner deleted" });
  } catch (err) {
    next(err);
  }
};
