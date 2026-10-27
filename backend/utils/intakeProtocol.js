export function matchesAcceptedIntake(accepted, snapshot) {
  return !!accepted && snapshot?.intakeRevisionId === accepted.revisionId && snapshot?.intakeContentHash === accepted.contentHash;
}

export function rejectLegacyIntake(res, caseRow) {
  if (caseRow?.intake_protocol !== "live_v2") return false;
  res.status(409).json({ error: "Use the reviewed intake lifecycle", code: "INTAKE_V2_ROUTE_REQUIRED" });
  return true;
}
