import pool from "../db.js";

function normalizeMoney(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? Number(n.toFixed(2)) : 0;
}

function computeStatus(requiredTotal, verifiedTotal) {
  const required = normalizeMoney(requiredTotal);
  const verified = normalizeMoney(verifiedTotal);

  if (required <= 0) {
    return verified > 0 ? "PARTIALLY_PAID" : "UNPAID";
  }
  if (verified <= 0) return "UNPAID";
  if (verified >= required) return "FULLY_PAID";
  return "PARTIALLY_PAID";
}

export async function recomputeCasePaymentRollup(client, caseId) {
  const db = client || pool;

  const sums = await db.query(
    `
      SELECT
        COALESCE(SUM(amount), 0)::numeric(12,2) AS required_total,
        COALESCE(
          SUM(
            CASE
              WHEN UPPER(status) IN ('VERIFIED', 'PAID_VERIFIED') THEN amount
              ELSE 0
            END
          ),
          0
        )::numeric(12,2) AS verified_total
      FROM public.client_billing
      WHERE case_id = $1
        AND UPPER(status) <> 'CANCELLED'
    `,
    [Number(caseId)]
  );

  const requiredTotal = normalizeMoney(sums.rows[0]?.required_total || 0);
  const verifiedTotal = normalizeMoney(sums.rows[0]?.verified_total || 0);
  const computedStatus = computeStatus(requiredTotal, verifiedTotal);

  const row = await db.query(
    `
      UPDATE public.client_cases
      SET payment_required_total = $2,
          payment_verified_total = $3,
          payment_status_computed = $4,
          payment_status = CASE
            WHEN payment_manual_override_status IS NOT NULL THEN payment_manual_override_status
            ELSE $4
          END,
          updated_at = NOW()
      WHERE id = $1
      RETURNING id, payment_required_total, payment_verified_total, payment_status_computed, payment_status,
                payment_manual_override_status, payment_manual_override_note, payment_manual_override_at
    `,
    [Number(caseId), requiredTotal, verifiedTotal, computedStatus]
  );

  return row.rows[0] || null;
}

export async function logCasePaymentEvent(client, payload) {
  const db = client || pool;
  const {
    caseId,
    billingId = null,
    eventType,
    actorUserId = null,
    actorRole = null,
    metadata = {},
  } = payload || {};

  await db.query(
    `
      INSERT INTO public.case_payment_events
        (case_id, billing_id, event_type, actor_user_id, actor_role, metadata)
      VALUES ($1, $2, $3, $4, $5, $6::jsonb)
    `,
    [
      Number(caseId),
      billingId ? Number(billingId) : null,
      String(eventType || "UNKNOWN"),
      actorUserId ? Number(actorUserId) : null,
      actorRole ? String(actorRole) : null,
      JSON.stringify(metadata || {}),
    ]
  );
}
