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

// ── Leads ────────────────────────────────────────────────────────────────
// sales_leads has no FK to sales_team_members (same reasoning as elsewhere
// in this codebase — keeps a lead from erroring out if its agent is later
// removed) — assigned_to_name is resolved and merged in JS instead.

// GET /api/sales/leads
export const getLeads = async (req, res, next) => {
  try {
    const { data: leads, error } = await supabase.from("sales_leads").select("*").order("created_at", { ascending: false });
    if (error) throw error;

    const { data: team, error: teamError } = await supabase.from("sales_team_members").select("id, name");
    if (teamError) throw teamError;
    const nameById = new Map((team ?? []).map((t) => [t.id, t.name]));

    const leadIds = leads.map((l) => l.id);
    const notesByLead = new Map();
    if (leadIds.length > 0) {
      const { data: notes, error: notesError } = await supabase
        .from("sales_notes").select("*").in("lead_id", leadIds).order("created_at", { ascending: true });
      if (notesError) throw notesError;
      for (const n of notes) {
        const list = notesByLead.get(n.lead_id) ?? [];
        list.push(n);
        notesByLead.set(n.lead_id, list);
      }
    }

    const data = leads.map((l) => ({
      ...l,
      assigned_to_name: nameById.get(l.assigned_to_id) ?? null,
      notes: notesByLead.get(l.id) ?? [],
    }));

    res.status(200).json({ success: true, count: data.length, data });
  } catch (err) {
    next(err);
  }
};

// POST /api/sales/leads
export const createLead = async (req, res, next) => {
  try {
    const { name, phone, email, project, budget, temperature, source, assignedToId, author } = req.body;
    if (!name || !phone) {
      return res.status(400).json({ success: false, message: "name and phone are required" });
    }

    const { data: lead, error } = await supabase
      .from("sales_leads")
      .insert([{
        name,
        phone,
        email: email || null,
        project: project || null,
        budget: Number(budget) || 0,
        temperature: temperature || "new",
        source: source || "Walk-in",
        assigned_to_id: assignedToId || null,
        status: "new",
      }])
      .select("*")
      .single();
    if (error) throw error;

    let agentName = null;
    if (lead.assigned_to_id) {
      const { data: agent } = await supabase.from("sales_team_members").select("name").eq("id", lead.assigned_to_id).maybeSingle();
      agentName = agent?.name ?? null;
    }

    const { data: note, error: noteError } = await supabase
      .from("sales_notes")
      .insert([{ lead_id: lead.id, type: "note", text: `Lead created and assigned to ${agentName ?? "an agent"}.`, author: author || "Admin" }])
      .select("*")
      .single();
    if (noteError) throw noteError;

    res.status(201).json({ success: true, data: { ...lead, assigned_to_name: agentName, notes: [note] } });
  } catch (err) {
    next(err);
  }
};

// PUT /api/sales/leads/:id
export const updateLead = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { temperature, status, assignedToId, nextFollowUp } = req.body;

    const updates = {};
    if (temperature !== undefined) updates.temperature = temperature;
    if (status !== undefined) updates.status = status;
    if (Object.prototype.hasOwnProperty.call(req.body, "assignedToId")) updates.assigned_to_id = assignedToId;
    if (Object.prototype.hasOwnProperty.call(req.body, "nextFollowUp")) updates.next_follow_up = nextFollowUp;

    const { data, error } = await supabase.from("sales_leads").update(updates).eq("id", id).select("*").maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ success: false, message: "Lead not found" });

    res.status(200).json({ success: true, data });
  } catch (err) {
    next(err);
  }
};

// DELETE /api/sales/leads/:id
export const deleteLead = async (req, res, next) => {
  try {
    const { data: existing, error: fetchError } = await supabase
      .from("sales_leads").select("id").eq("id", req.params.id).maybeSingle();
    if (fetchError) throw fetchError;
    if (!existing) return res.status(404).json({ success: false, message: "Lead not found" });

    await supabase.from("sales_notes").delete().eq("lead_id", req.params.id);
    const { error } = await supabase.from("sales_leads").delete().eq("id", req.params.id);
    if (error) throw error;

    res.status(200).json({ success: true, message: "Lead deleted" });
  } catch (err) {
    next(err);
  }
};

// POST /api/sales/leads/:id/notes
export const addLeadNote = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { type, text, author } = req.body;
    if (!text) return res.status(400).json({ success: false, message: "text is required" });

    const { data, error } = await supabase
      .from("sales_notes")
      .insert([{ lead_id: id, type: type || "note", text, author: author || "Admin" }])
      .select("*")
      .single();
    if (error) throw error;

    res.status(201).json({ success: true, data });
  } catch (err) {
    next(err);
  }
};

// POST /api/sales/leads/:id/convert
export const convertLeadToBooking = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { unitNo, amount, paymentPlan, author } = req.body;
    if (!unitNo || amount === undefined || amount === null || !paymentPlan) {
      return res.status(400).json({ success: false, message: "unitNo, amount and paymentPlan are required" });
    }

    const { data: lead, error: leadError } = await supabase.from("sales_leads").select("*").eq("id", id).maybeSingle();
    if (leadError) throw leadError;
    if (!lead) return res.status(404).json({ success: false, message: "Lead not found" });

    let agentName = null;
    if (lead.assigned_to_id) {
      const { data: agent } = await supabase.from("sales_team_members").select("name").eq("id", lead.assigned_to_id).maybeSingle();
      agentName = agent?.name ?? null;
    }

    const { data: booking, error: bookingError } = await supabase
      .from("sales_bookings")
      .insert([{
        lead_id: lead.id,
        lead_name: lead.name,
        phone: lead.phone,
        project: lead.project,
        agent_id: lead.assigned_to_id,
        agent_name: agentName,
        unit_no: unitNo,
        amount: Number(amount),
        payment_plan: paymentPlan,
      }])
      .select("*")
      .single();
    if (bookingError) throw bookingError;

    const { data: updatedLead, error: updateError } = await supabase
      .from("sales_leads")
      .update({ status: "booked", next_follow_up: null })
      .eq("id", id)
      .select("*")
      .single();
    if (updateError) throw updateError;

    const { data: note, error: noteError } = await supabase
      .from("sales_notes")
      .insert([{ lead_id: id, type: "status_change", text: `Converted to booking — unit ${unitNo}, ₹${amount}.`, author: author || "Admin" }])
      .select("*")
      .single();
    if (noteError) throw noteError;

    res.status(201).json({ success: true, data: { lead: updatedLead, booking, note } });
  } catch (err) {
    next(err);
  }
};

// ── Bookings ─────────────────────────────────────────────────────────────

// GET /api/sales/bookings
export const getBookings = async (req, res, next) => {
  try {
    const { data, error } = await supabase.from("sales_bookings").select("*").order("booked_at", { ascending: false });
    if (error) throw error;
    res.status(200).json({ success: true, count: data.length, data });
  } catch (err) {
    next(err);
  }
};
