import { supabase } from "../config/supabase.js";
import { wouldCreateCycle } from "../utils/hierarchy.js";

// sales_team_members lives only in Supabase (no definition in database/schema.sql
// — same as documented at schema.sql's employee_accounts mirror comment).
// select("*") rather than an explicit column list so any column already on
// the live table (e.g. admin_user_id, reports_to_id) is always returned
// without this file needing to know every column name up front.
const TEAM_SELECT = "*";

// GET /api/sales/team
export const getTeam = async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from("sales_team_members")
      .select(TEAM_SELECT)
      .order("created_at", { ascending: false });
    if (error) throw error;
    res.status(200).json({ success: true, count: data.length, data });
  } catch (err) {
    next(err);
  }
};

// POST /api/sales/team
export const addTeamMember = async (req, res, next) => {
  try {
    const { name, roleTitle, branch, email, phone, commissionRate, target, reportsToId } = req.body;
    if (!name || !roleTitle) {
      return res.status(400).json({ success: false, message: "name and roleTitle are required" });
    }

    const { data, error } = await supabase
      .from("sales_team_members")
      .insert([{
        name,
        role_title: roleTitle,
        branch: branch || null,
        email: email || null,
        phone: phone || null,
        commission_rate: commissionRate ?? 1.0,
        target: target ?? 0,
        reports_to_id: reportsToId ?? null,
      }])
      .select(TEAM_SELECT)
      .single();

    if (error) throw error;
    res.status(201).json({ success: true, data });
  } catch (err) {
    next(err);
  }
};

// PUT /api/sales/team/:id
export const updateTeamMember = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { target, commissionRate, reportsToId } = req.body;

    const updates = {};
    if (target !== undefined) updates.target = target;
    if (commissionRate !== undefined) updates.commission_rate = commissionRate;

    if (Object.prototype.hasOwnProperty.call(req.body, "reportsToId")) {
      if (reportsToId === id) {
        return res.status(400).json({ success: false, message: "An agent can't report to themselves" });
      }
      if (reportsToId) {
        const { data: allRows, error: rowsError } = await supabase.from("sales_team_members").select("id, reports_to_id");
        if (rowsError) throw rowsError;
        if (wouldCreateCycle(allRows, id, reportsToId)) {
          return res.status(400).json({ success: false, message: "That would create a reporting cycle" });
        }
      }
      updates.reports_to_id = reportsToId ?? null;
    }

    const { data, error } = await supabase
      .from("sales_team_members")
      .update(updates)
      .eq("id", id)
      .select(TEAM_SELECT)
      .single();

    if (error) throw error;
    if (!data) return res.status(404).json({ success: false, message: "Team member not found" });
    res.status(200).json({ success: true, data });
  } catch (err) {
    next(err);
  }
};

// DELETE /api/sales/team/:id
export const deleteTeamMember = async (req, res, next) => {
  try {
    const { data: existing, error: fetchError } = await supabase
      .from("sales_team_members").select("id").eq("id", req.params.id).maybeSingle();
    if (fetchError) throw fetchError;
    if (!existing) return res.status(404).json({ success: false, message: "Team member not found" });

    const { error } = await supabase.from("sales_team_members").delete().eq("id", req.params.id);
    if (error) throw error;
    res.status(200).json({ success: true, message: "Team member deleted" });
  } catch (err) {
    next(err);
  }
};
