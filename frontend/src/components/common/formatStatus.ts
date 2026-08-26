/**
 * Shared status → human-readable mapping for all entity status codes.
 * Keeps raw DB enum values (e.g. CONTRACT_PENDING_ADMIN_APPROVAL) from
 * leaking into the UI.
 */

const MAP: Record<string, string> = {
  // Case lifecycle
  DRAFT: "Draft",
  INTAKE_STARTED: "Interview Started",
  MATCHING_REVIEW: "Matching Review",
  ADVOCATE_ASSIGNED: "Advocate Assigned",
  ACCEPTED: "Accepted",
  REJECTED: "Rejected",
  MEETING_PENDING_ADMIN: "Meeting Pending Approval",
  MEETING_APPROVED: "Meeting Approved",
  CONTRACT_PENDING_SIGNATURES: "Awaiting Signatures",
  CONTRACT_PENDING_ADMIN_APPROVAL: "Awaiting Admin Approval",
  CASE_ACTIVE: "Active",

  // Meetings
  PENDING_ADMIN: "Pending Approval",
  APPROVED: "Approved",
  CANCELLED: "Cancelled",
  SCHEDULED: "Scheduled",
  HELD: "Held",
  ADJOURNED: "Adjourned",

  // Billing / vouchers / payment gates
  ISSUED_PENDING_PAYMENT: "Payment Pending",
  SENT: "Sent",
  PROOF_UPLOADED: "Proof Uploaded",
  PAYMENT_PROOF_UPLOADED: "Proof Uploaded",
  PAYMENT_REJECTED: "Payment Rejected",
  VERIFIED: "Verified",
  PAID: "Paid",
  FULLY_PAID: "Fully Paid",
  PARTIALLY_PAID: "Partially Paid",
  MANUALLY_MARKED_PAID: "Manually Marked Paid",
  PAID_VERIFIED: "Paid & Verified",
  PAYMENT_VERIFIED: "Payment Verified",
  PAYMENT_NOT_VERIFIED: "Payment Not Verified",
  PAYMENT_REQUIRED: "Payment Required",
  PAYMENT_MANUAL_OVERRIDE_SET: "Payment Manually Overridden",
  PAYMENT_OVERRIDE_CLEARED: "Payment Override Cleared",
  PAYMENT_SERVICE_PROVIDER: "Payment Service Provider",

  // Documents
  UPLOADED: "Uploaded",
  PENDING_VERIFICATION: "Pending Verification",
  NEEDS_REVIEW: "Needs Review",
  INCOMPLETE: "Incomplete",

  // Advocate verification
  VERIFICATION_PENDING: "Verification Pending",
  UNVERIFIED: "Unverified",
};

export function formatStatus(status?: string | null): string {
  const raw = String(status || "").trim();
  if (!raw) return "—";
  const key = raw.toUpperCase();
  return MAP[key] ?? raw;
}

/** Human-readable labels for AI-analysis enum values (snake_case from Gemini). */
export function formatAiEnum(kind: "domain" | "urgency" | "language", value?: string | null): string {
  const v = String(value || "").trim();
  if (!v) return "—";
  const key = v.toLowerCase();
  if (kind === "domain") {
    const domains: Record<string, string> = {
      family_law: "Family Law",
      property_law: "Property Law",
      criminal_law: "Criminal Law",
      civil_law: "Civil Law",
      labor_law: "Labor Law",
      corporate_law: "Corporate Law",
      other: "Other",
    };
    return domains[key] ?? "Other";
  }
  if (kind === "urgency") {
    const urgencies: Record<string, string> = {
      low: "Low",
      medium: "Medium",
      high: "High",
      critical: "Critical",
    };
    return urgencies[key] ?? "Medium";
  }
  const languages: Record<string, string> = {
    urdu: "Urdu",
    english: "English",
    mixed: "Mixed (Urdu & English)",
    bilingual: "Bilingual",
    ur: "Urdu",
    en: "English",
  };
  return languages[key] ?? v;
}