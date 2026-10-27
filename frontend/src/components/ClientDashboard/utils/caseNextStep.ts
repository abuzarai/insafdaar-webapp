export function caseNextStep(status?: string) {
  switch (String(status || "").toUpperCase()) {
    case "DRAFT": case "INTAKE_STARTED": return "Continue your case and review the details before submitting.";
    case "MATCHING_REVIEW": return "Your case is submitted. Check the available lawyer options.";
    case "ADVOCATE_ASSIGNED": return "A lawyer is assigned. Check your agreement and the available case updates.";
    case "CONTRACT_PENDING_SIGNATURES": return "Review your agreement and complete your signature when you are ready.";
    case "CONTRACT_PENDING_ADMIN_APPROVAL": return "Your agreement is awaiting the team’s review.";
    case "CLOSED": case "RESOLVED": return "This case is closed. You can still view its available records.";
    default: return "Check your case updates, documents and schedule for any actions that need your attention.";
  }
}
