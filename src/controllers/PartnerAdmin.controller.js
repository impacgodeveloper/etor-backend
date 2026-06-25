import { supabase } from "../config/supabase.js";

// GET /api/partners
export const getAllPartners = async (req, res, next) => {
  try {
    const { data, error } = await supabase
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
    const { data, error } = await supabase
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
    const { name, email, phone, address, portfolio_value, profile_image_url, password } = req.body;
    if (!name || !email) {
      return res.status(400).json({ success: false, message: "name and email are required" });
    }

    const { data, error } = await supabase
      .from("partners")
      .insert([{
        name, email: email.toLowerCase().trim(), phone, address,
        portfolio_value: portfolio_value || 0,
        profile_image_url, password,
      }])
      .select()
      .single();

    if (error) {
      if (error.code === "23505") return res.status(409).json({ success: false, message: "Email already exists" });
      throw error;
    }
    res.status(201).json({ success: true, data });
  } catch (err) {
    next(err);
  }
};

// PUT /api/partners/:id
export const updatePartner = async (req, res, next) => {
  try {
    const updates = { ...req.body };
    if (updates.email) updates.email = updates.email.toLowerCase().trim();

    const { data, error } = await supabase
      .from("partners")
      .update(updates)
      .eq("id", req.params.id)
      .select()
      .single();

    if (error) throw error;
    res.status(200).json({ success: true, data });
  } catch (err) {
    next(err);
  }
};

// DELETE /api/partners/:id
export const deletePartner = async (req, res, next) => {
  try {
    const { error } = await supabase.from("partners").delete().eq("id", req.params.id);
    if (error) throw error;
    res.status(200).json({ success: true, message: "Partner deleted" });
  } catch (err) {
    next(err);
  }
};
