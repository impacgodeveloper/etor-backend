// import { supabase } from "../config/supabase.js";

// // GET /api/payments?user_id=xxx
// export const getAllPayments = async (req, res, next) => {
//   try {
//     let query = supabase.from("payments").select("*").order("date", { ascending: false });
//     if (req.query.user_id) query = query.eq("user_id", req.query.user_id);
//     if (req.query.plot_id) query = query.eq("plot_id", req.query.plot_id);

//     const { data, error } = await query;
//     if (error) throw error;
//     res.status(200).json({ success: true, count: data.length, data });
//   } catch (err) {
//     next(err);
//   }
// };

// // POST /api/payments
// export const createPayment = async (req, res, next) => {
//   try {
//     const { user_id, plot_id, amount, description } = req.body;
//     if (!user_id || amount === undefined) {
//       return res.status(400).json({ success: false, message: "user_id and amount are required" });
//     }

//     const { data, error } = await supabase
//       .from("payments")
//       .insert([{ user_id, plot_id, amount, description, date: new Date().toISOString() }])
//       .select()
//       .single();

//     if (error) throw error;

//     // Auto-update plot's paid_amount if plot_id provided
//     if (plot_id) {
//       const { data: plot } = await supabase
//         .from("plots").select("total_price, paid_amount").eq("id", plot_id).single();
//       if (plot) {
//         const newPaid = (Number(plot.paid_amount) || 0) + Number(amount);
//         const balance = plot.total_price - newPaid;
//         let payment_status = "Not Paid";
//         if (newPaid >= plot.total_price) payment_status = "Fully Paid";
//         else if (newPaid > 0) payment_status = "Partially Paid";

//         await supabase.from("plots")
//           .update({ paid_amount: newPaid, balance_amount: balance, payment_status })
//           .eq("id", plot_id);
//       }
//     }

//     res.status(201).json({ success: true, data });
//   } catch (err) {
//     next(err);
//   }
// };

// // DELETE /api/payments/:id
// export const deletePayment = async (req, res, next) => {
//   try {
//     const { error } = await supabase.from("payments").delete().eq("id", req.params.id);
//     if (error) throw error;
//     res.status(200).json({ success: true, message: "Payment deleted" });
//   } catch (err) {
//     next(err);
//   }
// };
import { tenantDb } from "../utils/tenantDb.js";
import { partnerInTenant, plotInTenant, unknownPartner } from "../utils/tenantRefs.js";

// GET /api/payments?user_id=xxx
export const getAllPayments = async (req, res, next) => {
  try {
    const db = tenantDb(req);

    let query = db.from("payments").select("*").order("date", { ascending: false });
    if (req.query.user_id) query = query.eq("user_id", req.query.user_id);
    if (req.query.plot_id) query = query.eq("plot_id", req.query.plot_id);

    const { data, error } = await query;
    if (error) throw error;
    res.status(200).json({ success: true, count: data.length, data });
  } catch (err) {
    next(err);
  }
};

// Adds `delta` (may be negative, for reversals) to a plot's paid amount and
// recomputes its balance and payment status.
const applyPlotPayment = async (db, plotId, delta) => {
  const { data: plot } = await db
    .from("plots").select("total_price, paid_amount").eq("id", plotId).maybeSingle();
  if (!plot) return;
  const total = Number(plot.total_price) || 0;
  const newPaid = Math.max(0, (Number(plot.paid_amount) || 0) + delta);
  let payment_status = "Not Paid";
  if (newPaid >= total && total > 0) payment_status = "Fully Paid";
  else if (newPaid > 0) payment_status = "Partial";
  await db.from("plots")
    .update({ paid_amount: newPaid, balance_amount: total - newPaid, payment_status })
    .eq("id", plotId);
};

// POST /api/payments
export const createPayment = async (req, res, next) => {
  try {
    const db = tenantDb(req);

    const { user_id, plot_id, amount, description } = req.body;
    if (!user_id || amount === undefined) {
      return res.status(400).json({ success: false, message: "user_id and amount are required" });
    }
    if (!Number.isFinite(Number(amount)) || Number(amount) === 0) {
      return res.status(400).json({ success: false, message: "amount must be a non-zero number" });
    }
    // Honour the transaction date picked in the admin UI (fall back to now).
    const parsedDate = req.body.date ? new Date(req.body.date) : null;
    const date = parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate.toISOString() : new Date().toISOString();
    if (!(await partnerInTenant(req, user_id))) return unknownPartner(res);
    if (plot_id && !(await plotInTenant(req, plot_id))) {
      return res.status(400).json({ success: false, message: "That plot does not exist in your organization" });
    }

    const { data, error } = await db
      .from("payments")
      .insert([{ user_id, plot_id, amount, description, date }])
      .select()
      .single();

    if (error) throw error;

    // Auto-update plot's paid_amount if plot_id provided
    // Sign convention (admin UI): a debit (negative amount) is money the
    // partner paid; a credit (positive) is cashback/income paid out to them.
    // Only a debit linked to a plot counts towards that plot's paid amount —
    // adding the raw signed amount drove paid_amount negative.
    if (plot_id && Number(amount) < 0) {
      await applyPlotPayment(db, plot_id, -Number(amount));
    }

    res.status(201).json({ success: true, data });
  } catch (err) {
    next(err);
  }
};

// DELETE /api/payments/:id
export const deletePayment = async (req, res, next) => {
  try {
    const db = tenantDb(req);

    const { data: removed, error } = await db
      .from("payments").delete().eq("id", req.params.id).select().maybeSingle();
    if (error) throw error;
    // Undo the payment's effect on its plot (see createPayment).
    if (removed?.plot_id && Number(removed.amount) < 0) {
      await applyPlotPayment(db, removed.plot_id, Number(removed.amount));
    }
    res.status(200).json({ success: true, message: "Payment deleted" });
  } catch (err) {
    next(err);
  }
};