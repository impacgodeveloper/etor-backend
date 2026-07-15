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
