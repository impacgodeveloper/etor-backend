import mime from "mime-types";
import { supabase } from "../config/supabase.js";
import { getDirectReportIds } from "../utils/hierarchy.js";

const BUCKET = "receipts";
// employee_id always refers to a row in employee_accounts — admin_users is
// admin-only and doesn't submit/own travel expenses.
const EXPENSE_SELECT = "*, employee_accounts:employee_id(name, role_title)";

const mapExpense = (row) => ({
  ...row,
  employee_name: row.employee_accounts?.name || "Unknown",
  employee_role: row.employee_accounts?.role_title || "",
  employee_accounts: undefined,
});

// True if the caller (from the JWT) is the super admin, i.e. their id is an
// admin_users row rather than an employee_accounts row.
const _isCallerSuperAdmin = async (callerId) => {
  const { data } = await supabase.from("admin_users").select("id").eq("id", callerId).maybeSingle();
  return !!data;
};

// GET /api/travel-expenses/mine
export const getMyExpenses = async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from("travel_expenses")
      .select(EXPENSE_SELECT)
      .eq("employee_id", req.user.id)
      .order("created_at", { ascending: false });
    if (error) throw error;
    res.status(200).json({ success: true, count: data.length, data: data.map(mapExpense) });
  } catch (err) {
    next(err);
  }
};

// GET /api/travel-expenses/team
export const getTeamExpenses = async (req, res, next) => {
  try {
    const { data: rows, error: rowsError } = await supabase.from("employee_accounts").select("id, reports_to_id");
    if (rowsError) throw rowsError;
    const reportIds = getDirectReportIds(rows, req.user.id);

    if (reportIds.length === 0) {
      return res.status(200).json({ success: true, count: 0, data: [] });
    }

    const { data, error } = await supabase
      .from("travel_expenses")
      .select(EXPENSE_SELECT)
      .in("employee_id", reportIds)
      .order("created_at", { ascending: false });
    if (error) throw error;
    res.status(200).json({ success: true, count: data.length, data: data.map(mapExpense) });
  } catch (err) {
    next(err);
  }
};

// GET /api/travel-expenses (super admin only)
export const getAllExpenses = async (req, res, next) => {
  try {
    if (!(await _isCallerSuperAdmin(req.user.id))) {
      return res.status(403).json({ success: false, message: "Only the super admin can view all expenses" });
    }

    const { data, error } = await supabase
      .from("travel_expenses")
      .select(EXPENSE_SELECT)
      .order("created_at", { ascending: false });
    if (error) throw error;
    res.status(200).json({ success: true, count: data.length, data: data.map(mapExpense) });
  } catch (err) {
    next(err);
  }
};

// POST /api/travel-expenses (multipart/form-data, file optional)
export const createExpense = async (req, res, next) => {
  try {
    const {
      tripPurpose, travelDateFrom, travelDateTo, fromLocation, toLocation,
      modeOfTravel, category, amount, currency, paidBy, description,
    } = req.body;

    if (!tripPurpose || !travelDateFrom || !fromLocation || !toLocation || !modeOfTravel || !category || !amount || !paidBy) {
      return res.status(400).json({
        success: false,
        message: "tripPurpose, travelDateFrom, fromLocation, toLocation, modeOfTravel, category, amount and paidBy are required",
      });
    }
    if (!["company", "employee"].includes(paidBy)) {
      return res.status(400).json({ success: false, message: "paidBy must be 'company' or 'employee'" });
    }

    let receipt_url = null;
    let receipt_file_name = null;
    if (req.file) {
      const filePath = `${Date.now()}_${req.file.originalname.replace(/\s+/g, "_")}`;
      const contentType = mime.lookup(req.file.originalname) || req.file.mimetype;
      const { error: uploadError } = await supabase.storage
        .from(BUCKET)
        .upload(filePath, req.file.buffer, { contentType, upsert: false });
      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(filePath);
      receipt_url = urlData.publicUrl;
      receipt_file_name = req.file.originalname;
    }

    const { data, error } = await supabase
      .from("travel_expenses")
      .insert([{
        employee_id: req.user.id,
        trip_purpose: tripPurpose,
        travel_date_from: travelDateFrom,
        travel_date_to: travelDateTo || null,
        from_location: fromLocation,
        to_location: toLocation,
        mode_of_travel: modeOfTravel,
        category,
        amount: Number(amount),
        currency: currency || "INR",
        paid_by: paidBy,
        description: description || null,
        receipt_url,
        receipt_file_name,
        status: "pending",
      }])
      .select(EXPENSE_SELECT)
      .single();

    if (error) throw error;
    res.status(201).json({ success: true, data: mapExpense(data) });
  } catch (err) {
    next(err);
  }
};

// Shared authorization check for approve/reject/reimburse: caller must be
// the expense owner's direct manager (reports_to_id), or the super admin.
const _resolveExpenseAndAuthorize = async (req) => {
  const { data: expense, error: expenseError } = await supabase
    .from("travel_expenses").select("*").eq("id", req.params.id).single();
  if (expenseError || !expense) return { error: { status: 404, message: "Expense not found" } };

  const { data: owner } = await supabase
    .from("employee_accounts").select("reports_to_id").eq("id", expense.employee_id).maybeSingle();
  const isSuperAdmin = await _isCallerSuperAdmin(req.user.id);
  const isDirectManager = owner?.reports_to_id === req.user.id;
  if (!isSuperAdmin && !isDirectManager) {
    return { error: { status: 403, message: "You are not authorized to act on this expense" } };
  }
  return { expense };
};

// PATCH /api/travel-expenses/:id/status
export const updateExpenseStatus = async (req, res, next) => {
  try {
    const { status, admin_note } = req.body;
    if (!["approved", "rejected"].includes(status)) {
      return res.status(400).json({ success: false, message: "status must be 'approved' or 'rejected'" });
    }

    const { expense, error: authError } = await _resolveExpenseAndAuthorize(req);
    if (authError) return res.status(authError.status).json({ success: false, message: authError.message });

    if (expense.status !== "pending") {
      return res.status(400).json({ success: false, message: "Only pending expenses can be approved or rejected" });
    }

    const updates = {
      status,
      ...(admin_note ? { admin_note } : {}),
      ...(status === "approved" ? { approved_at: new Date().toISOString() } : { rejected_at: new Date().toISOString() }),
    };

    const { data, error } = await supabase
      .from("travel_expenses")
      .update(updates)
      .eq("id", req.params.id)
      .select(EXPENSE_SELECT)
      .single();
    if (error) throw error;
    res.status(200).json({ success: true, data: mapExpense(data) });
  } catch (err) {
    next(err);
  }
};

// PATCH /api/travel-expenses/:id/reimburse
export const reimburseExpense = async (req, res, next) => {
  try {
    const { reimbursement_note } = req.body;

    const { expense, error: authError } = await _resolveExpenseAndAuthorize(req);
    if (authError) return res.status(authError.status).json({ success: false, message: authError.message });

    if (expense.status !== "approved" || expense.paid_by !== "employee") {
      return res.status(400).json({ success: false, message: "Only approved, employee-paid expenses can be reimbursed" });
    }

    const { data, error } = await supabase
      .from("travel_expenses")
      .update({
        status: "reimbursed",
        reimbursed_at: new Date().toISOString(),
        ...(reimbursement_note ? { reimbursement_note } : {}),
      })
      .eq("id", req.params.id)
      .select(EXPENSE_SELECT)
      .single();
    if (error) throw error;
    res.status(200).json({ success: true, data: mapExpense(data) });
  } catch (err) {
    next(err);
  }
};

// DELETE /api/travel-expenses/:id
export const deleteExpense = async (req, res, next) => {
  try {
    const { data: expense, error: fetchError } = await supabase
      .from("travel_expenses").select("employee_id, status, receipt_url").eq("id", req.params.id).single();
    if (fetchError || !expense) return res.status(404).json({ success: false, message: "Expense not found" });

    const isSuperAdmin = await _isCallerSuperAdmin(req.user.id);
    const isOwner = expense.employee_id === req.user.id;
    if (!isSuperAdmin && !isOwner) {
      return res.status(403).json({ success: false, message: "You are not authorized to delete this expense" });
    }
    if (expense.status !== "pending") {
      return res.status(400).json({ success: false, message: "Only pending expenses can be deleted" });
    }

    if (expense.receipt_url) {
      const parts = expense.receipt_url.split(`/${BUCKET}/`);
      if (parts.length > 1) await supabase.storage.from(BUCKET).remove([parts[1]]);
    }

    const { error } = await supabase.from("travel_expenses").delete().eq("id", req.params.id);
    if (error) throw error;
    res.status(200).json({ success: true, message: "Expense deleted" });
  } catch (err) {
    next(err);
  }
};
