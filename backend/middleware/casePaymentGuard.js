import pool from "../db.js";

function normalizeCaseId(raw) {
  if (raw === undefined || raw === null) return null;

  const s = String(raw).trim();

  // If numeric already
  if (/^\d+$/.test(s)) return Number(s);

  // If "CASE-001" or any mixed text -> extract digits
  const digits = s.match(/\d+/g)?.join("") || "";
  const num = Number(digits);

  return Number.isFinite(num) && num > 0 ? num : null;
}

/**
 * Blocks case details unless payment proof is VERIFIED (or invoice status PAID).
 * Usage: router.get("/details", authMiddleware, requirePaidCase, handler)
 */
export async function requirePaidCase(req, res, next) {
  try {
    const userId = req.user.id;

    const rawCaseId =
      req.query.caseId ||
      req.body?.caseId ||
      req.params?.caseId;

    const caseId = normalizeCaseId(rawCaseId);

    if (!caseId) return res.status(400).json({ error: "caseId is required" });

    // verify ownership
    const c = await pool.query(
      `SELECT id FROM public.client_cases WHERE id=$1 AND user_id=$2`,
      [caseId, userId]
    );
    if (c.rows.length === 0) return res.status(404).json({ error: "Case not found" });

    // check latest invoice/payment verification
    const inv = await pool.query(
      `
      SELECT id, status, payment_proof_status
      FROM public.case_invoices
      WHERE case_id=$1
      ORDER BY created_at DESC
      LIMIT 1
      `,
      [caseId]
    );

    if (inv.rows.length === 0) {
      return res.status(403).json({
        error: "BILLING_NOT_GENERATED",
        message: "Billing not generated yet. Please wait or contact support.",
      });
    }

    const row = inv.rows[0];

    const ok =
      row.payment_proof_status === "VERIFIED" ||
      row.status === "PAID" ||
      row.status === "VERIFIED"; // optional safety

    if (!ok) {
      return res.status(403).json({
        error: "PAYMENT_NOT_VERIFIED",
        message: "Payment not verified yet. Please upload proof and wait for admin verification.",
      });
    }

    next();
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
