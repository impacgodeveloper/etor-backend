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
