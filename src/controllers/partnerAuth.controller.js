// import bcrypt from "bcryptjs";
// import jwt from "jsonwebtoken";
// import { supabase } from "../config/supabase.js";

// const AVATAR_BUCKET = "avatars";

// // POST /api/partner-auth/login
// export const partnerLogin = async (req, res, next) => {
//   try {
//     const { email, password } = req.body;
//     if (!email || !password) {
//       return res.status(400).json({ success: false, message: "Email and password are required" });
//     }

//     const { data: partner, error } = await supabase
//       .from("partners")
//       .select("*")
//       .eq("email", email.toLowerCase().trim())
//       .eq("is_active", true)
//       .single();

//     if (error || !partner) {
//       return res.status(401).json({ success: false, message: "Invalid email or password" });
//     }

//     let isValid = false;
//     if (partner.password_hash) {
//       isValid = await bcrypt.compare(password, partner.password_hash);
//     } else if (partner.password) {
//       isValid = (partner.password === password);
//     }

//     if (!isValid) {
//       return res.status(401).json({ success: false, message: "Invalid email or password" });
//     }

//     const token = jwt.sign(
//       { id: partner.id, email: partner.email, role: "partner" },
//       process.env.JWT_SECRET,
//       { expiresIn: process.env.JWT_EXPIRES_IN || "30d" }
//     );

//     res.status(200).json({
//       success: true,
//       data: { token, user: _toProfileResponse(partner) },
//     });
//   } catch (err) {
//     next(err);
//   }
// };

// // GET /api/partner-auth/me
// export const getPartnerMe = async (req, res, next) => {
//   try {
//     const { data: partner, error } = await supabase
//       .from("partners").select("*").eq("id", req.user.id).single();

//     if (error || !partner) {
//       return res.status(404).json({ success: false, message: "Partner not found" });
//     }
//     res.status(200).json({ success: true, data: _toProfileResponse(partner) });
//   } catch (err) {
//     next(err);
//   }
// };

// // PUT /api/partner-auth/profile
// export const updatePartnerProfile = async (req, res, next) => {
//   try {
//     const allowed = [
//       "phone", "address", "city", "state", "pin_code",
//       "profile_image_url", "date_of_birth"
//     ];
//     const updates = {};
//     for (const k of allowed) {
//       if (req.body[k] !== undefined) updates[k] = req.body[k];
//     }

//     if (Object.keys(updates).length === 0) {
//       return res.status(400).json({ success: false, message: "No valid fields to update" });
//     }

//     const { data, error } = await supabase
//       .from("partners").update(updates).eq("id", req.user.id).select().single();

//     if (error) throw error;
//     res.status(200).json({ success: true, data: _toProfileResponse(data) });
//   } catch (err) {
//     next(err);
//   }
// };

// // POST /api/partner-auth/change-password
// export const changePartnerPassword = async (req, res, next) => {
//   try {
//     const { current_password, new_password } = req.body;
//     if (!current_password || !new_password) {
//       return res.status(400).json({ success: false, message: "current_password and new_password are required" });
//     }
//     if (new_password.length < 6) {
//       return res.status(400).json({ success: false, message: "New password must be at least 6 characters" });
//     }

//     const { data: partner, error: fetchErr } = await supabase
//       .from("partners").select("password_hash, password").eq("id", req.user.id).single();
//     if (fetchErr) throw fetchErr;

//     let valid = false;
//     if (partner.password_hash) {
//       valid = await bcrypt.compare(current_password, partner.password_hash);
//     } else if (partner.password) {
//       valid = partner.password === current_password;
//     }
//     if (!valid) return res.status(401).json({ success: false, message: "Current password incorrect" });

//     const newHash = await bcrypt.hash(new_password, 10);
//     const { error } = await supabase
//       .from("partners").update({ password_hash: newHash, password: null }).eq("id", req.user.id);
//     if (error) throw error;

//     res.status(200).json({ success: true, message: "Password updated" });
//   } catch (err) {
//     next(err);
//   }
// };

// // ════════════════════════════════════════════════════════════════════════════
// // POST /api/partner-auth/avatar   (multipart/form-data with "file" field)
// // Uploads avatar to Supabase Storage, updates partners.profile_image_url
// // ════════════════════════════════════════════════════════════════════════════
// // ════════════════════════════════════════════════════════════════════════════
// // POST /api/partner-auth/avatar   (multipart/form-data with "file" field)
// // ════════════════════════════════════════════════════════════════════════════
// export const uploadAvatar = async (req, res, next) => {
//   try {
//     if (!req.file) {
//       return res.status(400).json({ success: false, message: "file is required" });
//     }

//     // Validate file size (5MB max)
//     if (req.file.size > 5 * 1024 * 1024) {
//       return res.status(400).json({ success: false, message: "Image must be smaller than 5MB" });
//     }

//     // Determine extension + MIME from filename (Flutter Web sometimes sends octet-stream)
//     const originalName = req.file.originalname || "avatar.jpg";
//     const ext = (originalName.split(".").pop() || "jpg").toLowerCase();

//     const validExts = ["jpg", "jpeg", "png", "gif", "webp", "heic", "heif"];
//     if (!validExts.includes(ext)) {
//       return res.status(400).json({
//         success: false,
//         message: `Only image files are allowed (jpg, png, gif, webp). Got: .${ext}`,
//       });
//     }

//     // Map extension to proper MIME type
//     const mimeMap = {
//       jpg:  "image/jpeg",
//       jpeg: "image/jpeg",
//       png:  "image/png",
//       gif:  "image/gif",
//       webp: "image/webp",
//       heic: "image/heic",
//       heif: "image/heif",
//     };
//     const contentType = mimeMap[ext] || req.file.mimetype || "image/jpeg";

//     const partnerId = req.user.id;

//     // 1) Delete old avatar from storage (if exists)
//     const { data: existing } = await supabase
//       .from("partners").select("profile_image_url").eq("id", partnerId).single();

//     if (existing?.profile_image_url) {
//       const parts = existing.profile_image_url.split(`/${AVATAR_BUCKET}/`);
//       if (parts.length > 1) {
//         await supabase.storage.from(AVATAR_BUCKET).remove([parts[1]]);
//       }
//     }

//     // 2) Upload new avatar
//     const filePath = `${partnerId}/${Date.now()}.${ext}`;

//     const { error: uploadError } = await supabase.storage
//       .from(AVATAR_BUCKET)
//       .upload(filePath, req.file.buffer, {
//         contentType,
//         upsert: true,
//       });

//     if (uploadError) throw uploadError;

//     // 3) Get public URL
//     const { data: urlData } = supabase.storage.from(AVATAR_BUCKET).getPublicUrl(filePath);

//     // 4) Update partners table
//     const { data, error } = await supabase
//       .from("partners")
//       .update({ profile_image_url: urlData.publicUrl })
//       .eq("id", partnerId)
//       .select()
//       .single();

//     if (error) throw error;

//     res.status(200).json({
//       success: true,
//       message: "Avatar updated successfully",
//       data: _toProfileResponse(data),
//     });
//   } catch (err) {
//     console.error("uploadAvatar error:", err);
//     next(err);
//   }
// };

// // DELETE /api/partner-auth/avatar  — resets profile_image_url to null
// export const deleteAvatar = async (req, res, next) => {
//   try {
//     const partnerId = req.user.id;

//     const { data: existing } = await supabase
//       .from("partners").select("profile_image_url").eq("id", partnerId).single();

//     if (existing?.profile_image_url) {
//       const parts = existing.profile_image_url.split(`/${AVATAR_BUCKET}/`);
//       if (parts.length > 1) {
//         await supabase.storage.from(AVATAR_BUCKET).remove([parts[1]]);
//       }
//     }

//     const { data, error } = await supabase
//       .from("partners")
//       .update({ profile_image_url: null })
//       .eq("id", partnerId)
//       .select()
//       .single();

//     if (error) throw error;
//     res.status(200).json({ success: true, data: _toProfileResponse(data) });
//   } catch (err) {
//     next(err);
//   }
// };

// function _toProfileResponse(p) {
//   return {
//     id: p.id,
//     full_name: p.name,
//     email: p.email,
//     phone: p.phone || "",
//     avatar_url: p.profile_image_url,
//     date_of_birth: p.date_of_birth,
//     partner_id: p.partner_code || "",
//     member_since: p.member_since || "",
//     tier: p.tier || "Standard",
//     address: p.address,
//     city: p.city,
//     state: p.state,
//     country: p.country,
//     pin_code: p.pin_code,
//     kyc_status: p.kyc_status || "pending",
//     aadhaar_masked: p.aadhaar_masked,
//     pan_number: p.pan_number,
//     passport_status: p.passport_status,
//     bank_name: p.bank_name,
//     account_number_masked: p.account_number_masked,
//     ifsc_code: p.ifsc_code,
//     portfolio_value: p.portfolio_value || 0,
//   };
// }
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { supabase } from "../config/supabase.js";
const AVATAR_BUCKET = "avatars";
export const partnerLogin = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, message: "Email and password are required" });
    }

    const { data: partner, error } = await supabase
      .from("partners")
      .select("*")
      .eq("email", email.toLowerCase().trim())
      .eq("is_active", true)
      .single();

    if (error || !partner) {
      return res.status(401).json({ success: false, message: "Invalid email or password" });
    }

    const isBcryptHash = partner.password && partner.password.startsWith('$2');
    let isValid;
    if (isBcryptHash) {
      isValid = await bcrypt.compare(password, partner.password);
    } else {
      isValid = (partner.password === password);
      if (isValid) {
        const hashed = await bcrypt.hash(password, 10);
        await supabase.from('partners').update({ password: hashed }).eq('id', partner.id);
      }
    }

    if (!isValid) {
      return res.status(401).json({ success: false, message: "Invalid email or password" });
    }

    const token = jwt.sign(
      { id: partner.id, email: partner.email, role: "partner" },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || "30d" }
    );

    res.status(200).json({
      success: true,
      data: { token, user: _toProfileResponse(partner) },
    });
  } catch (err) {
    next(err);
  }
};

export const getPartnerMe = async (req, res, next) => {
  try {
    const { data: partner, error } = await supabase
      .from("partners").select("*").eq("id", req.user.id).single();

    if (error || !partner) {
      return res.status(404).json({ success: false, message: "Partner not found" });
    }
    res.status(200).json({ success: true, data: _toProfileResponse(partner) });
  } catch (err) {
    next(err);
  }
};

export const updatePartnerProfile = async (req, res, next) => {
  try {
    const allowed = [
      "phone", "address", "city", "state", "pin_code",
      "profile_image_url", "date_of_birth"
    ];
    const updates = {};
    for (const k of allowed) {
      if (req.body[k] !== undefined) updates[k] = req.body[k];
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ success: false, message: "No valid fields to update" });
    }

    const { data, error } = await supabase
      .from("partners").update(updates).eq("id", req.user.id).select().single();

    if (error) throw error;
    res.status(200).json({ success: true, data: _toProfileResponse(data) });
  } catch (err) {
    next(err);
  }
};

export const changePartnerPassword = async (req, res, next) => {
  try {
    const { current_password, new_password } = req.body;
    if (!current_password || !new_password) {
      return res.status(400).json({ success: false, message: "current_password and new_password are required" });
    }
    if (new_password.length < 6) {
      return res.status(400).json({ success: false, message: "New password must be at least 6 characters" });
    }

    const { data: partner, error: fetchErr } = await supabase
      .from("partners").select("password").eq("id", req.user.id).single();
    if (fetchErr) throw fetchErr;

    if (partner.password !== current_password) {
      return res.status(401).json({ success: false, message: "Current password incorrect" });
    }

    const { error } = await supabase
      .from("partners").update({ password: new_password }).eq("id", req.user.id);
    if (error) throw error;

    res.status(200).json({ success: true, message: "Password updated" });
  } catch (err) {
    next(err);
  }
};

export const uploadAvatar = async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: "file is required" });
    }

    if (req.file.size > 5 * 1024 * 1024) {
      return res.status(400).json({ success: false, message: "Image must be smaller than 5MB" });
    }

    const originalName = req.file.originalname || "avatar.jpg";
    const ext = (originalName.split(".").pop() || "jpg").toLowerCase();

    const validExts = ["jpg", "jpeg", "png", "gif", "webp", "heic", "heif"];
    if (!validExts.includes(ext)) {
      return res.status(400).json({
        success: false,
        message: `Only image files are allowed (jpg, png, gif, webp). Got: .${ext}`,
      });
    }

    const mimeMap = {
      jpg:  "image/jpeg",
      jpeg: "image/jpeg",
      png:  "image/png",
      gif:  "image/gif",
      webp: "image/webp",
      heic: "image/heic",
      heif: "image/heif",
    };
    const contentType = mimeMap[ext] || req.file.mimetype || "image/jpeg";

    const partnerId = req.user.id;

    const { data: existing } = await supabase
      .from("partners").select("profile_image_url").eq("id", partnerId).single();

    if (existing?.profile_image_url) {
      const parts = existing.profile_image_url.split(`/${AVATAR_BUCKET}/`);
      if (parts.length > 1) {
        await supabase.storage.from(AVATAR_BUCKET).remove([parts[1]]);
      }
    }

    const filePath = `${partnerId}/${Date.now()}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from(AVATAR_BUCKET)
      .upload(filePath, req.file.buffer, {
        contentType,
        upsert: true,
      });

    if (uploadError) throw uploadError;

    const { data: urlData } = supabase.storage.from(AVATAR_BUCKET).getPublicUrl(filePath);

    const { data, error } = await supabase
      .from("partners")
      .update({ profile_image_url: urlData.publicUrl })
      .eq("id", partnerId)
      .select()
      .single();

    if (error) throw error;

    res.status(200).json({
      success: true,
      message: "Avatar updated successfully",
      data: _toProfileResponse(data),
    });
  } catch (err) {
    console.error("uploadAvatar error:", err);
    next(err);
  }
};

export const deleteAvatar = async (req, res, next) => {
  try {
    const partnerId = req.user.id;

    const { data: existing } = await supabase
      .from("partners").select("profile_image_url").eq("id", partnerId).single();

    if (existing?.profile_image_url) {
      const parts = existing.profile_image_url.split(`/${AVATAR_BUCKET}/`);
      if (parts.length > 1) {
        await supabase.storage.from(AVATAR_BUCKET).remove([parts[1]]);
      }
    }

    const { data, error } = await supabase
      .from("partners")
      .update({ profile_image_url: null })
      .eq("id", partnerId)
      .select()
      .single();

    if (error) throw error;
    res.status(200).json({ success: true, data: _toProfileResponse(data) });
  } catch (err) {
    next(err);
  }
};

function _toProfileResponse(p) {
  return {
    id: p.id,
    full_name: p.name,
    email: p.email,
    phone: p.phone || "",
    avatar_url: p.profile_image_url,
    date_of_birth: p.date_of_birth,
    partner_id: p.partner_code || "",
    member_since: p.member_since || "",
    tier: p.tier || "Standard",
    address: p.address,
    city: p.city,
    state: p.state,
    country: p.country,
    pin_code: p.pin_code,
    kyc_status: p.kyc_status || "pending",
    aadhaar_masked: p.aadhaar_masked,
    pan_number: p.pan_number,
    passport_status: p.passport_status,
    bank_name: p.bank_name,
    account_number_masked: p.account_number_masked,
    ifsc_code: p.ifsc_code,
    portfolio_value: p.portfolio_value || 0,
  };
}