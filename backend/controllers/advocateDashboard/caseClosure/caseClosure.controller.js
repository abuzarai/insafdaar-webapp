import pool from "../../../db.js";

function toInt(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function requireAdvocate(req, res) {
  const advocateId = toInt(req.user?.id);
  if (!advocateId) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }
  return advocateId;
}

async function assertAssigned(client, advocateId, caseId) {
  // Your schema uses assigned_advocate_id (based on earlier logs)
  const r = await client.query(
    `
    SELECT c.id, c.title, c.status, c.user_id AS client_user_id, c.assigned_advocate_id
    FROM public.client_cases c
    WHERE c.id=$1
    LIMIT 1
    `,
    [caseId]
  );

  if (r.rowCount === 0) return { ok: false, status: 404, payload: { error: "Case not found" } };

  const row = r.rows[0];

  if (Number(row.assigned_advocate_id) !== Number(advocateId)) {
    return { ok: false, status: 403, payload: { error: "Not assigned to this case" } };
  }

  return { ok: true, row };
}

function assertCaseActiveStatus(caseStatus) {
  const status = String(caseStatus || "").toUpperCase();
  if (status !== "CASE_ACTIVE") {
    return {
      ok: false,
      status: 409,
      payload: {
        error: "CASE_NOT_ACTIVE",
        message: `Case closure is only allowed for CASE_ACTIVE cases. Current status: ${status || "UNKNOWN"}`,
        currentStatus: status || null,
      },
    };
  }
  return { ok: true };
}

/**
 * GET /api/advocate/dashboard/case-closure/cases
 * Returns all cases assigned to logged-in advocate (for dropdown)
 */
export async function getClosableCases(req, res) {
  const advocateId = requireAdvocate(req, res);
  if (!advocateId) return;

  try {
    const q = await pool.query(
      `
      SELECT id, title, status
      FROM public.client_cases
      WHERE assigned_advocate_id=$1
        AND status = 'CASE_ACTIVE'
      ORDER BY id DESC
      `,
      [advocateId]
    );

    return res.json({ ok: true, cases: q.rows });
  } catch (e) {
    console.error("getClosableCases error:", e);
    return res.status(500).json({ error: "Internal server error" });
  }
}

/**
 * GET /api/advocate/dashboard/case-closure/cases/:caseId
 * Returns closure report if it exists
 */
export async function getCaseClosureReport(req, res) {
  const advocateId = requireAdvocate(req, res);
  if (!advocateId) return;

  const caseId = toInt(req.params.caseId);
  if (!caseId) return res.status(400).json({ error: "Invalid caseId" });

  const client = await pool.connect();
  try {
    const owned = await assertAssigned(client, advocateId, caseId);
    if (!owned.ok) return res.status(owned.status).json(owned.payload);

    const activeCheck = assertCaseActiveStatus(owned.row.status);
    if (!activeCheck.ok) return res.status(activeCheck.status).json(activeCheck.payload);

    const r = await client.query(
      `
      SELECT *
      FROM public.case_closure_reports
      WHERE case_id=$1 AND advocate_id=$2
      LIMIT 1
      `,
      [caseId, advocateId]
    );

    return res.json({ ok: true, case: owned.row, report: r.rows[0] || null });
  } catch (e) {
    console.error("getCaseClosureReport error:", e);
    return res.status(500).json({ error: "Internal server error" });
  } finally {
    client.release();
  }
}

/**
 * POST /api/advocate/dashboard/case-closure/cases/:caseId
 * Create or update closure report (UPSERT by case_id unique)
 */
export async function upsertCaseClosureReport(req, res) {
  const advocateId = requireAdvocate(req, res);
  if (!advocateId) return;

  const caseId = toInt(req.params.caseId);
  if (!caseId) return res.status(400).json({ error: "Invalid caseId" });

  const {
    outcome,
    court_name,
    judge_name,
    judgment_date,
    case_trial_result,
    court_final_order,
    final_remarks,
  } = req.body || {};

  if (!outcome || !case_trial_result || !court_final_order || !final_remarks) {
    return res.status(400).json({
      error: "Missing required fields",
      required: ["outcome", "case_trial_result", "court_final_order", "final_remarks"],
    });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const owned = await assertAssigned(client, advocateId, caseId);
    if (!owned.ok) {
      await client.query("ROLLBACK");
      return res.status(owned.status).json(owned.payload);
    }

    const activeCheck = assertCaseActiveStatus(owned.row.status);
    if (!activeCheck.ok) {
      await client.query("ROLLBACK");
      return res.status(activeCheck.status).json(activeCheck.payload);
    }

    const up = await client.query(
      `
      INSERT INTO public.case_closure_reports
        (case_id, advocate_id, outcome, court_name, judge_name, judgment_date,
         case_trial_result, court_final_order, final_remarks)
      VALUES
        ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      ON CONFLICT (case_id)
      DO UPDATE SET
        advocate_id = EXCLUDED.advocate_id,
        outcome = EXCLUDED.outcome,
        court_name = EXCLUDED.court_name,
        judge_name = EXCLUDED.judge_name,
        judgment_date = EXCLUDED.judgment_date,
        case_trial_result = EXCLUDED.case_trial_result,
        court_final_order = EXCLUDED.court_final_order,
        final_remarks = EXCLUDED.final_remarks,
        updated_at = now()
      RETURNING *
      `,
      [
        caseId,
        advocateId,
        String(outcome).toUpperCase(),
        court_name || null,
        judge_name || null,
        judgment_date || null,
        case_trial_result,
        court_final_order,
        final_remarks,
      ]
    );

    // OPTIONAL: set case status to CLOSED if your enum/check allows it.
    // If your client_cases.status does NOT allow 'CLOSED', comment this out.
    // await client.query(
    //   `UPDATE public.client_cases SET status='CLOSED', updated_at=NOW() WHERE id=$1`,
    //   [caseId]
    // );

    await client.query("COMMIT");
    return res.json({ ok: true, report: up.rows[0] });
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("upsertCaseClosureReport error:", e);
    return res.status(500).json({ error: "Internal server error" });
  } finally {
    client.release();
  }
}
