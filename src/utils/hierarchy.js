import { supabase } from "../config/supabase.js";

// Walks up the reports_to_id chain from `startId` and returns true if
// `targetId` is anywhere in that chain — i.e. assigning `startId` to report
// to `targetId` would create a cycle (someone ending up reporting to their
// own subordinate). Capped at 100 hops as a corrupt-data safety net.
export async function wouldCreateCycle(table, targetId, startId) {
  let currentId = startId;
  for (let hops = 0; currentId && hops < 100; hops++) {
    if (currentId === targetId) return true;
    const { data } = await supabase.from(table).select("reports_to_id").eq("id", currentId).single();
    currentId = data?.reports_to_id || null;
  }
  return false;
}

// Pure helpers over an already-fetched admin_users row array (each row at
// least {id, reports_to_id}). Mirrors EmployeesProvider.wouldCreateHierarchyCycle
// on the Flutter side and test/support/fake_backend.dart's _wouldCreateCycle,
// so behavior stays identical between the fake test backend and this one.
export const wouldCreateHierarchyCycle = (rows, employeeId, proposedManagerId) => {
  if (!proposedManagerId) return false;
  if (proposedManagerId === employeeId) return true;
  const byId = new Map(rows.map((r) => [r.id, r]));
  let currentId = proposedManagerId;
  const visited = new Set();
  while (currentId && !visited.has(currentId)) {
    if (currentId === employeeId) return true;
    visited.add(currentId);
    currentId = byId.get(currentId)?.reports_to_id ?? null;
  }
  return false;
};

export const getDirectReportIds = (rows, managerId) =>
  rows.filter((r) => r.reports_to_id === managerId).map((r) => r.id);
