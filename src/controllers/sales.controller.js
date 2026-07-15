// import { supabase } from "../config/supabase.js";
// import { wouldCreateCycle } from "../utils/hierarchy.js";

// // ============================================================
// // SALES TEAM
// // ============================================================

// // GET /api/sales/team
// export const getAllTeamMembers = async (req, res, next) => {
//   try {
//     const { data, error } = await supabase
//       .from("sales_team_members")
//       .select("*")
//       .order("created_at", { ascending: true });
//     if (error) throw error;
//     res.status(200).json({ success: true, count: data.length, data });
//   } catch (err) {
//     next(err);
//   }
// };

// // POST /api/sales/team
// export const createTeamMember = async (req, res, next) => {
//   try {
//     const { name, roleTitle, branch, email, phone, commissionRate, target, reportsToId } = req.body;
//     if (!name || !roleTitle) {
//       return res.status(400).json({ success: false, message: "name and roleTitle are required" });
//     }

//     const { data, error } = await supabase
//       .from("sales_team_members")
//       .insert([{
//         name,
//         role_title: roleTitle,
//         branch: branch || null,
//         email: email || null,
//         phone: phone || null,
//         commission_rate: commissionRate ?? 1.0,
//         target: target ?? 0,
//         reports_to_id: reportsToId || null,
//       }])
//       .select()
//       .single();

//     if (error) throw error;
//     res.status(201).json({ success: true, data });
//   } catch (err) {
//     next(err);
//   }
// };

// // PUT /api/sales/team/:id
// export const updateTeamMember = async (req, res, next) => {
//   try {
//     const { target, commissionRate, roleTitle, branch, phone, email, reportsToId } = req.body;
//     const updates = {};
//     if (target !== undefined) updates.target = target;
//     if (commissionRate !== undefined) updates.commission_rate = commissionRate;
//     if (roleTitle !== undefined) updates.role_title = roleTitle;
//     if (branch !== undefined) updates.branch = branch;
//     if (phone !== undefined) updates.phone = phone;
//     if (email !== undefined) updates.email = email;

//     if (reportsToId !== undefined) {
//       if (reportsToId === req.params.id) {
//         return res.status(400).json({ success: false, message: "An agent can't report to themselves" });
//       }
//       if (reportsToId && (await wouldCreateCycle("sales_team_members", req.params.id, reportsToId))) {
//         return res.status(400).json({ success: false, message: "That would create a reporting cycle" });
//       }
//       updates.reports_to_id = reportsToId || null;
//     }

//     const { data, error } = await supabase
//       .from("sales_team_members")
//       .update(updates)
//       .eq("id", req.params.id)
//       .select()
//       .single();

//     if (error) throw error;
//     if (!data) return res.status(404).json({ success: false, message: "Team member not found" });
//     res.status(200).json({ success: true, data });
//   } catch (err) {
//     next(err);
//   }
// };

// // DELETE /api/sales/team/:id
// export const deleteTeamMember = async (req, res, next) => {
//   try {
//     const { error } = await supabase.from("sales_team_members").delete().eq("id", req.params.id);
//     if (error) throw error;
//     res.status(200).json({ success: true, message: "Team member deleted" });
//   } catch (err) {
//     next(err);
//   }
// };

// // ============================================================
// // SALES LEADS
// // ============================================================

// // GET /api/sales/leads  (each lead comes back with its notes + the
// // assigned agent's name, assembled in application code rather than
// // relying on PostgREST embed syntax)
// export const getAllLeads = async (req, res, next) => {
//   try {
//     const [{ data: leads, error: leadsError }, { data: notes, error: notesError }, { data: team, error: teamError }] = await Promise.all([
//       supabase.from("sales_leads").select("*").order("created_at", { ascending: false }),
//       supabase.from("sales_notes").select("*").order("created_at", { ascending: true }),
//       supabase.from("sales_team_members").select("id, name"),
//     ]);
//     if (leadsError) throw leadsError;
//     if (notesError) throw notesError;
//     if (teamError) throw teamError;

//     const teamNameById = Object.fromEntries(team.map((t) => [t.id, t.name]));
//     const notesByLead = {};
//     for (const n of notes) {
//       (notesByLead[n.lead_id] ||= []).push(n);
//     }

//     const data = leads.map((l) => ({
//       ...l,
//       assigned_to_name: l.assigned_to_id ? teamNameById[l.assigned_to_id] || null : null,
//       notes: notesByLead[l.id] || [],
//     }));

//     res.status(200).json({ success: true, count: data.length, data });
//   } catch (err) {
//     next(err);
//   }
// };

// // POST /api/sales/leads
// // body: { name, phone, email, project, budget, temperature, source, assignedToId, author }
// export const createLead = async (req, res, next) => {
//   try {
//     const { name, phone, email, project, budget, temperature, source, assignedToId, author } = req.body;
//     if (!name || !phone || !assignedToId) {
//       return res.status(400).json({ success: false, message: "name, phone and assignedToId are required" });
//     }

//     const { data: lead, error } = await supabase
//       .from("sales_leads")
//       .insert([{
//         name,
//         phone,
//         email: email || null,
//         project: project || null,
//         budget: budget || 0,
//         temperature: temperature || "new",
//         source: source || "Walk-in",
//         status: "new",
//         assigned_to_id: assignedToId,
//       }])
//       .select()
//       .single();
//     if (error) throw error;

//     const { data: agent } = await supabase.from("sales_team_members").select("name").eq("id", assignedToId).single();

//     const { data: note, error: noteError } = await supabase
//       .from("sales_notes")
//       .insert([{
//         lead_id: lead.id,
//         type: "note",
//         text: `Lead created and assigned to ${agent?.name || "an agent"}.`,
//         author: author || "Admin",
//       }])
//       .select()
//       .single();
//     if (noteError) throw noteError;

//     res.status(201).json({ success: true, data: { ...lead, assigned_to_name: agent?.name || null, notes: [note] } });
//   } catch (err) {
//     next(err);
//   }
// };

// // PUT /api/sales/leads/:id
// // Plain field update — the caller (Flutter side) is responsible for also
// // calling POST .../notes with a human-readable activity message when a
// // status/assignment/follow-up change should be logged, same as before.
// // body: any of { temperature, status, assignedToId, nextFollowUp }
// export const updateLead = async (req, res, next) => {
//   try {
//     const { temperature, status, assignedToId, nextFollowUp } = req.body;
//     const updates = {};
//     if (temperature !== undefined) updates.temperature = temperature;
//     if (status !== undefined) updates.status = status;
//     if (assignedToId !== undefined) updates.assigned_to_id = assignedToId;
//     if (nextFollowUp !== undefined) updates.next_follow_up = nextFollowUp; // ISO string or null

//     const { data, error } = await supabase
//       .from("sales_leads")
//       .update(updates)
//       .eq("id", req.params.id)
//       .select()
//       .single();

//     if (error) throw error;
//     if (!data) return res.status(404).json({ success: false, message: "Lead not found" });
//     res.status(200).json({ success: true, data });
//   } catch (err) {
//     next(err);
//   }
// };

// // DELETE /api/sales/leads/:id  (notes cascade via ON DELETE CASCADE)
// export const deleteLead = async (req, res, next) => {
//   try {
//     const { error } = await supabase.from("sales_leads").delete().eq("id", req.params.id);
//     if (error) throw error;
//     res.status(200).json({ success: true, message: "Lead deleted" });
//   } catch (err) {
//     next(err);
//   }
// };

// // POST /api/sales/leads/:id/notes
// // body: { type, text, author }
// export const addLeadNote = async (req, res, next) => {
//   try {
//     const { type, text, author } = req.body;
//     if (!type || !text) {
//       return res.status(400).json({ success: false, message: "type and text are required" });
//     }

//     const { data, error } = await supabase
//       .from("sales_notes")
//       .insert([{ lead_id: req.params.id, type, text, author: author || "Admin" }])
//       .select()
//       .single();

//     if (error) throw error;
//     res.status(201).json({ success: true, data });
//   } catch (err) {
//     next(err);
//   }
// };

// // POST /api/sales/leads/:id/convert
// // body: { unitNo, amount, paymentPlan, author }
// // Creates the booking record, marks the lead booked, and logs the
// // conversion as an activity note — all three pieces returned together.
// export const convertLeadToBooking = async (req, res, next) => {
//   try {
//     const { unitNo, amount, paymentPlan, author } = req.body;
//     if (!unitNo || amount === undefined || amount === null) {
//       return res.status(400).json({ success: false, message: "unitNo and amount are required" });
//     }

//     const { data: lead, error: leadError } = await supabase
//       .from("sales_leads")
//       .select("*")
//       .eq("id", req.params.id)
//       .single();
//     if (leadError || !lead) return res.status(404).json({ success: false, message: "Lead not found" });

//     let agentName = null;
//     if (lead.assigned_to_id) {
//       const { data: agent } = await supabase
//         .from("sales_team_members")
//         .select("name")
//         .eq("id", lead.assigned_to_id)
//         .single();
//       agentName = agent?.name || null;
//     }

//     const { data: booking, error: bookingError } = await supabase
//       .from("sales_bookings")
//       .insert([{
//         lead_id: lead.id,
//         lead_name: lead.name,
//         phone: lead.phone,
//         project: lead.project,
//         agent_id: lead.assigned_to_id,
//         agent_name: agentName,
//         unit_no: unitNo,
//         amount,
//         payment_plan: paymentPlan || null,
//       }])
//       .select()
//       .single();
//     if (bookingError) throw bookingError;

//     const { data: updatedLead, error: updateError } = await supabase
//       .from("sales_leads")
//       .update({ status: "booked", next_follow_up: null })
//       .eq("id", lead.id)
//       .select()
//       .single();
//     if (updateError) throw updateError;

//     const { data: note, error: noteError } = await supabase
//       .from("sales_notes")
//       .insert([{
//         lead_id: lead.id,
//         type: "status_change",
//         text: `Converted to booking — unit ${unitNo}, ₹${amount}.`,
//         author: author || "Admin",
//       }])
//       .select()
//       .single();
//     if (noteError) throw noteError;

//     res.status(201).json({ success: true, data: { lead: updatedLead, booking, note } });
//   } catch (err) {
//     next(err);
//   }
// };

// // ============================================================
// // SALES BOOKINGS
// // ============================================================

// // GET /api/sales/bookings
// export const getAllBookings = async (req, res, next) => {
//   try {
//     const { data, error } = await supabase
//       .from("sales_bookings")
//       .select("*")
//       .order("booked_at", { ascending: false });
//     if (error) throw error;
//     res.status(200).json({ success: true, count: data.length, data });
//   } catch (err) {
//     next(err);
//   }
// };
import { supabase } from "../config/supabase.js";
import { ADMIN_ROLE, ROLE_HIERARCHY, getDirectReportIds, wouldCreateCycle } from "../utils/hierarchy.js";

// ── Caller identity + hierarchy scope ───────────────────────────────────
// Every login is either the super admin (admin_users, unrestricted) or a
// staff login (employee_accounts). Staff holding one of the six ranked
// titles (President > Vice President > Branch Manager > Sales Manager >
// Sales Executive > Sales Associates) are scoped to their own
// reports_to_id subtree in sales_team_members — matched to their own row
// by email, since sales_team_members isn't FK'd to employee_accounts (every
// employee is mirrored into it by email when created; see
// employee.controller.js). Any other role title (legacy free text, "Others")
// stays unrestricted — the same "no rule applies" behavior already used for
// employee-creation permissions in hierarchy.js.
const _resolveCaller = async (callerId) => {
  const { data: admin } = await supabase.from("admin_users").select("id").eq("id", callerId).maybeSingle();
  if (admin) return { isAdmin: true, role: ADMIN_ROLE, email: null };

  const { data: employee } = await supabase
    .from("employee_accounts")
    .select("id, email, role_title")
    .eq("id", callerId)
    .maybeSingle();
  if (employee) return { isAdmin: false, role: employee.role_title, email: employee.email };

  return null;
};

// Returns null for "unrestricted" (sees/acts on every record), or
// { selfId, allowed } where `allowed` is a Set of sales_team_members ids —
// the caller's own row plus everyone under them, any number of levels down.
// An empty Set means a ranked-role caller with no sales_team_members row of
// their own yet, so they see/can act on nothing.
const _resolveScope = async (caller) => {
  if (caller.isAdmin || !ROLE_HIERARCHY.includes(caller.role)) return null;

  const { data: rows, error } = await supabase.from("sales_team_members").select("id, reports_to_id, email");
  if (error) throw error;

  const self = rows.find((r) => (r.email || "").toLowerCase() === (caller.email || "").toLowerCase());
  if (!self) return { selfId: null, allowed: new Set() };

  const allowed = new Set([self.id]);
  const queue = [self.id];
  while (queue.length) {
    const current = queue.shift();
    for (const childId of getDirectReportIds(rows, current)) {
      if (!allowed.has(childId)) {
        allowed.add(childId);
        queue.push(childId);
      }
    }
  }
  return { selfId: self.id, allowed };
};

const _scopeError = (res) =>
  res.status(403).json({ success: false, message: "You don't have access to this sales record." });

// ============================================================
// SALES TEAM
// ============================================================

// GET /api/sales/team
export const getAllTeamMembers = async (req, res, next) => {
  try {
    const caller = await _resolveCaller(req.user.id);
    const scope = await _resolveScope(caller);

    let query = supabase.from("sales_team_members").select("*").order("created_at", { ascending: true });
    if (scope) {
      if (scope.allowed.size === 0) return res.status(200).json({ success: true, count: 0, data: [] });
      query = query.in("id", [...scope.allowed]);
    }

    const { data, error } = await query;
    if (error) throw error;
    res.status(200).json({ success: true, count: data.length, data });
  } catch (err) {
    next(err);
  }
};

// POST /api/sales/team
export const createTeamMember = async (req, res, next) => {
  try {
    const { name, roleTitle, branch, email, phone, commissionRate, target, reportsToId } = req.body;
    if (!name || !roleTitle) {
      return res.status(400).json({ success: false, message: "name and roleTitle are required" });
    }

    const caller = await _resolveCaller(req.user.id);
    const scope = await _resolveScope(caller);

    let resolvedReportsTo = reportsToId || null;
    if (scope) {
      if (scope.allowed.size === 0) return _scopeError(res);
      if (resolvedReportsTo) {
        if (!scope.allowed.has(resolvedReportsTo)) return _scopeError(res);
      } else {
        // Ranked roles can only add people under themselves — default to
        // reporting straight to the caller instead of a new top-of-chain agent.
        resolvedReportsTo = scope.selfId;
      }
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
        reports_to_id: resolvedReportsTo,
      }])
      .select()
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
    const caller = await _resolveCaller(req.user.id);
    const scope = await _resolveScope(caller);
    if (scope && !scope.allowed.has(id)) return _scopeError(res);

    const { target, commissionRate, roleTitle, branch, phone, email, reportsToId } = req.body;
    const updates = {};
    if (target !== undefined) updates.target = target;
    if (commissionRate !== undefined) updates.commission_rate = commissionRate;
    if (roleTitle !== undefined) updates.role_title = roleTitle;
    if (branch !== undefined) updates.branch = branch;
    if (phone !== undefined) updates.phone = phone;
    if (email !== undefined) updates.email = email;

    if (reportsToId !== undefined) {
      if (reportsToId === id) {
        return res.status(400).json({ success: false, message: "An agent can't report to themselves" });
      }
      if (scope) {
        // Restricted callers must keep this member inside their own subtree —
        // no detaching to top-of-chain, no moving under someone outside it.
        if (!reportsToId || !scope.allowed.has(reportsToId)) return _scopeError(res);
      }
      if (reportsToId) {
        const { data: allRows, error: rowsError } = await supabase.from("sales_team_members").select("id, reports_to_id");
        if (rowsError) throw rowsError;
        if (wouldCreateCycle(allRows, id, reportsToId)) {
          return res.status(400).json({ success: false, message: "That would create a reporting cycle" });
        }
      }
      updates.reports_to_id = reportsToId || null;
    }

    const { data, error } = await supabase
      .from("sales_team_members")
      .update(updates)
      .eq("id", id)
      .select()
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
    const { id } = req.params;
    const caller = await _resolveCaller(req.user.id);
    const scope = await _resolveScope(caller);
    if (scope && !scope.allowed.has(id)) return _scopeError(res);

    const { error } = await supabase.from("sales_team_members").delete().eq("id", id);
    if (error) throw error;
    res.status(200).json({ success: true, message: "Team member deleted" });
  } catch (err) {
    next(err);
  }
};

// ============================================================
// SALES LEADS
// ============================================================

// GET /api/sales/leads  (each lead comes back with its notes + the
// assigned agent's name, assembled in application code rather than
// relying on PostgREST embed syntax)
export const getAllLeads = async (req, res, next) => {
  try {
    const caller = await _resolveCaller(req.user.id);
    const scope = await _resolveScope(caller);
    if (scope && scope.allowed.size === 0) return res.status(200).json({ success: true, count: 0, data: [] });

    let leadsQuery = supabase.from("sales_leads").select("*").order("created_at", { ascending: false });
    if (scope) leadsQuery = leadsQuery.in("assigned_to_id", [...scope.allowed]);

    const [{ data: leads, error: leadsError }, { data: notes, error: notesError }, { data: team, error: teamError }] = await Promise.all([
      leadsQuery,
      supabase.from("sales_notes").select("*").order("created_at", { ascending: true }),
      supabase.from("sales_team_members").select("id, name"),
    ]);
    if (leadsError) throw leadsError;
    if (notesError) throw notesError;
    if (teamError) throw teamError;

    const teamNameById = Object.fromEntries(team.map((t) => [t.id, t.name]));
    const notesByLead = {};
    for (const n of notes) {
      (notesByLead[n.lead_id] ||= []).push(n);
    }

    const data = leads.map((l) => ({
      ...l,
      assigned_to_name: l.assigned_to_id ? teamNameById[l.assigned_to_id] || null : null,
      notes: notesByLead[l.id] || [],
    }));

    res.status(200).json({ success: true, count: data.length, data });
  } catch (err) {
    next(err);
  }
};

// POST /api/sales/leads
// body: { name, phone, email, project, budget, temperature, source, assignedToId, author }
export const createLead = async (req, res, next) => {
  try {
    const { name, phone, email, project, budget, temperature, source, assignedToId, author } = req.body;
    if (!name || !phone || !assignedToId) {
      return res.status(400).json({ success: false, message: "name, phone and assignedToId are required" });
    }

    const caller = await _resolveCaller(req.user.id);
    const scope = await _resolveScope(caller);
    if (scope && !scope.allowed.has(assignedToId)) return _scopeError(res);

    const { data: lead, error } = await supabase
      .from("sales_leads")
      .insert([{
        name,
        phone,
        email: email || null,
        project: project || null,
        budget: budget || 0,
        temperature: temperature || "new",
        source: source || "Walk-in",
        status: "new",
        assigned_to_id: assignedToId,
      }])
      .select()
      .single();
    if (error) throw error;

    const { data: agent } = await supabase.from("sales_team_members").select("name").eq("id", assignedToId).single();

    const { data: note, error: noteError } = await supabase
      .from("sales_notes")
      .insert([{
        lead_id: lead.id,
        type: "note",
        text: `Lead created and assigned to ${agent?.name || "an agent"}.`,
        author: author || "Admin",
      }])
      .select()
      .single();
    if (noteError) throw noteError;

    res.status(201).json({ success: true, data: { ...lead, assigned_to_name: agent?.name || null, notes: [note] } });
  } catch (err) {
    next(err);
  }
};

// PUT /api/sales/leads/:id
// Plain field update — the caller (Flutter side) is responsible for also
// calling POST .../notes with a human-readable activity message when a
// status/assignment/follow-up change should be logged, same as before.
// body: any of { temperature, status, assignedToId, nextFollowUp }
export const updateLead = async (req, res, next) => {
  try {
    const { id } = req.params;
    const caller = await _resolveCaller(req.user.id);
    const scope = await _resolveScope(caller);

    const { data: existing, error: fetchError } = await supabase
      .from("sales_leads").select("id, assigned_to_id").eq("id", id).single();
    if (fetchError || !existing) return res.status(404).json({ success: false, message: "Lead not found" });
    if (scope && !scope.allowed.has(existing.assigned_to_id)) return _scopeError(res);

    const { temperature, status, assignedToId, nextFollowUp } = req.body;
    const updates = {};
    if (temperature !== undefined) updates.temperature = temperature;
    if (status !== undefined) updates.status = status;
    if (assignedToId !== undefined) {
      if (scope && !scope.allowed.has(assignedToId)) return _scopeError(res);
      updates.assigned_to_id = assignedToId;
    }
    if (nextFollowUp !== undefined) updates.next_follow_up = nextFollowUp; // ISO string or null

    const { data, error } = await supabase
      .from("sales_leads")
      .update(updates)
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;
    if (!data) return res.status(404).json({ success: false, message: "Lead not found" });
    res.status(200).json({ success: true, data });
  } catch (err) {
    next(err);
  }
};

// DELETE /api/sales/leads/:id  (notes cascade via ON DELETE CASCADE)
export const deleteLead = async (req, res, next) => {
  try {
    const { id } = req.params;
    const caller = await _resolveCaller(req.user.id);
    const scope = await _resolveScope(caller);

    const { data: existing, error: fetchError } = await supabase
      .from("sales_leads").select("id, assigned_to_id").eq("id", id).single();
    if (fetchError || !existing) return res.status(404).json({ success: false, message: "Lead not found" });
    if (scope && !scope.allowed.has(existing.assigned_to_id)) return _scopeError(res);

    const { error } = await supabase.from("sales_leads").delete().eq("id", id);
    if (error) throw error;
    res.status(200).json({ success: true, message: "Lead deleted" });
  } catch (err) {
    next(err);
  }
};

// POST /api/sales/leads/:id/notes
// body: { type, text, author }
export const addLeadNote = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { type, text, author } = req.body;
    if (!type || !text) {
      return res.status(400).json({ success: false, message: "type and text are required" });
    }

    const caller = await _resolveCaller(req.user.id);
    const scope = await _resolveScope(caller);

    const { data: lead, error: fetchError } = await supabase
      .from("sales_leads").select("id, assigned_to_id").eq("id", id).single();
    if (fetchError || !lead) return res.status(404).json({ success: false, message: "Lead not found" });
    if (scope && !scope.allowed.has(lead.assigned_to_id)) return _scopeError(res);

    const { data, error } = await supabase
      .from("sales_notes")
      .insert([{ lead_id: id, type, text, author: author || "Admin" }])
      .select()
      .single();

    if (error) throw error;
    res.status(201).json({ success: true, data });
  } catch (err) {
    next(err);
  }
};

// POST /api/sales/leads/:id/convert
// body: { unitNo, amount, paymentPlan, author }
// Creates the booking record, marks the lead booked, and logs the
// conversion as an activity note — all three pieces returned together.
export const convertLeadToBooking = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { unitNo, amount, paymentPlan, author } = req.body;
    if (!unitNo || amount === undefined || amount === null) {
      return res.status(400).json({ success: false, message: "unitNo and amount are required" });
    }

    const caller = await _resolveCaller(req.user.id);
    const scope = await _resolveScope(caller);

    const { data: lead, error: leadError } = await supabase
      .from("sales_leads")
      .select("*")
      .eq("id", id)
      .single();
    if (leadError || !lead) return res.status(404).json({ success: false, message: "Lead not found" });
    if (scope && !scope.allowed.has(lead.assigned_to_id)) return _scopeError(res);

    let agentName = null;
    if (lead.assigned_to_id) {
      const { data: agent } = await supabase
        .from("sales_team_members")
        .select("name")
        .eq("id", lead.assigned_to_id)
        .single();
      agentName = agent?.name || null;
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
        amount,
        payment_plan: paymentPlan || null,
      }])
      .select()
      .single();
    if (bookingError) throw bookingError;

    const { data: updatedLead, error: updateError } = await supabase
      .from("sales_leads")
      .update({ status: "booked", next_follow_up: null })
      .eq("id", lead.id)
      .select()
      .single();
    if (updateError) throw updateError;

    const { data: note, error: noteError } = await supabase
      .from("sales_notes")
      .insert([{
        lead_id: lead.id,
        type: "status_change",
        text: `Converted to booking — unit ${unitNo}, ₹${amount}.`,
        author: author || "Admin",
      }])
      .select()
      .single();
    if (noteError) throw noteError;

    res.status(201).json({ success: true, data: { lead: updatedLead, booking, note } });
  } catch (err) {
    next(err);
  }
};

// ============================================================
// SALES BOOKINGS
// ============================================================

// GET /api/sales/bookings
export const getAllBookings = async (req, res, next) => {
  try {
    const caller = await _resolveCaller(req.user.id);
    const scope = await _resolveScope(caller);

    let query = supabase.from("sales_bookings").select("*").order("booked_at", { ascending: false });
    if (scope) {
      if (scope.allowed.size === 0) return res.status(200).json({ success: true, count: 0, data: [] });
      query = query.in("agent_id", [...scope.allowed]);
    }

    const { data, error } = await query;
    if (error) throw error;
    res.status(200).json({ success: true, count: data.length, data });
  } catch (err) {
    next(err);
  }
};

