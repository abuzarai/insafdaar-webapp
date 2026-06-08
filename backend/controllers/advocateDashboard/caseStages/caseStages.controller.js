import pool from "../../../db.js";
import { notifyClient } from "../../../utils/notify.js";
import { sendNotificationEmail } from "../../../utils/mailer.js";

const STAGES = [
  "INTAKE",
  "RESEARCH",
  "CASE_SUMMARY",
  "CLIENT_VALIDATION",
  "DIGITAL_DOCS",
  "LITIGATION_STRATEGY",
  "FILING_SUBMISSION",
  "NOTICES_SUMMONS",
  "REPLIES_MAINTAINABILITY",
  "ISSUES_FRAMING",
  "EVIDENCE",
  "CROSS_EXAMINATION",
  "FINAL_ARGUMENTS",
  "JUDGMENT",
  "EXECUTION",
];

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

function normalizeStage(s) {
  return String(s || "").trim().toUpperCase();
}

/**
 * Checks that:
 * - case exists
 * - case is assigned to this advocate (assigned_advocate_id)
 * Returns case + client identity for notifications/emails
 */
async function assertAdvocateAssignedToCase(client, advocateId, caseId) {
  // ✅ IMPORTANT: match your schema (your db logs show assigned_advocate_id & user_id exist)
  const q = `
    SELECT
      c.id,
      c.status,
      c.user_id AS client_user_id,
      c.assigned_advocate_id,
      u.email AS client_email,
      COALESCE(u.name, u.email) AS client_name
    FROM public.client_cases c
    JOIN public.users u ON u.id = c.user_id
    WHERE c.id = $1 AND c.assigned_advocate_id = $2
    LIMIT 1
  `;

  const r = await client.query(q, [caseId, advocateId]);

  if (r.rowCount === 0) {
    // Could be "not found" OR "not assigned". Keep it safe.
    return { ok: false, status: 403, payload: { error: "Case not found or not assigned to this advocate" } };
  }

  return { ok: true, row: r.rows[0] };
}

function assertCaseActiveStatus(caseStatus) {
  const status = String(caseStatus || "").toUpperCase();
  if (status !== "CASE_ACTIVE") {
    return {
      ok: false,
      status: 409,
      payload: {
        error: "CASE_NOT_ACTIVE",
        message: `Case must be CASE_ACTIVE before stage tracking. Current status: ${status || "UNKNOWN"}`,
        currentStatus: status || null,
      },
    };
  }
  return { ok: true };
}

/**
 * GET /api/advocate/dashboard/cases/:caseId/stages
 * Returns stage list + computed current stage + completion history
 */
export async function getCaseStages(req, res) {
  const advocateId = requireAdvocate(req, res);
  if (!advocateId) return;

  try {
    const caseId = toInt(req.params.caseId);
    if (!caseId) return res.status(400).json({ error: "Invalid caseId" });

    const client = await pool.connect();
    try {
      const owned = await assertAdvocateAssignedToCase(client, advocateId, caseId);
      if (!owned.ok) return res.status(owned.status).json(owned.payload);

      const activeCheck = assertCaseActiveStatus(owned.row.status);
      if (!activeCheck.ok) return res.status(activeCheck.status).json(activeCheck.payload);

      const progress = await client.query(
        `
        SELECT completed_stage, completed_at, completed_by_advocate_id, note
        FROM public.case_stage_progress
        WHERE case_id=$1
        ORDER BY completed_at ASC
        `,
        [caseId]
      );

      const completed = progress.rows.map((x) => String(x.completed_stage).toUpperCase());
      const lastCompletedStage = completed.length ? completed[completed.length - 1] : null;

      // ✅ We do NOT depend on client_cases.current_stage (may not exist).
      // Compute "current stage" from progress history.
      let currentStage = null;

      if (!lastCompletedStage) currentStage = STAGES[0];
      else {
        const idx = STAGES.indexOf(lastCompletedStage);
        currentStage = idx >= 0 && idx < STAGES.length - 1 ? STAGES[idx + 1] : STAGES[STAGES.length - 1];
      }

      return res.json({
        ok: true,
        stages: STAGES,
        current_stage: currentStage,
        completed_stages: completed,
        history: progress.rows,
      });
    } finally {
      client.release();
    }
  } catch (e) {
    console.error("getCaseStages error:", e);
    return res.status(500).json({ error: "Internal server error" });
  }
}

/**
 * POST /api/advocate/dashboard/cases/:caseId/stages/complete
 * Body: { stage: "EVIDENCE", note?: "..." }
 * Marks stage as completed and notifies client + emails client.
 *
 * NOTE:
 * We DO NOT require client_cases.current_stage column.
 * If you DO have it, we update it safely inside try/catch.
 */
export async function completeCaseStage(req, res) {
  const advocateId = requireAdvocate(req, res);
  if (!advocateId) return;

  const client = await pool.connect();
  try {
    const caseId = toInt(req.params.caseId);
    if (!caseId) return res.status(400).json({ error: "Invalid caseId" });

    const stage = normalizeStage(req.body?.stage);
    const note = req.body?.note ? String(req.body.note).trim() : null;

    if (!STAGES.includes(stage)) {
      return res.status(400).json({ error: "Invalid stage" });
    }

    await client.query("BEGIN");

    const owned = await assertAdvocateAssignedToCase(client, advocateId, caseId);
    if (!owned.ok) {
      await client.query("ROLLBACK");
      return res.status(owned.status).json(owned.payload);
    }

    const activeCheck = assertCaseActiveStatus(owned.row.status);
    if (!activeCheck.ok) {
      await client.query("ROLLBACK");
      return res.status(activeCheck.status).json(activeCheck.payload);
    }

    // prevent duplicate completion
    const already = await client.query(
      `
      SELECT 1 FROM public.case_stage_progress
      WHERE case_id=$1 AND UPPER(completed_stage)=UPPER($2)
      LIMIT 1
      `,
      [caseId, stage]
    );
    if (already.rowCount > 0) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Stage already completed" });
    }

    // enforce no skipping (must complete expected stage only)
    const history = await client.query(
      `
      SELECT completed_stage
      FROM public.case_stage_progress
      WHERE case_id=$1
      ORDER BY completed_at ASC
      `,
      [caseId]
    );

    const completed = history.rows.map((x) => String(x.completed_stage).toUpperCase());
    const last = completed.length ? completed[completed.length - 1] : null;

    const expected = !last
      ? STAGES[0]
      : STAGES[Math.min(STAGES.indexOf(last) + 1, STAGES.length - 1)];

    if (stage !== expected) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        error: "INVALID_STAGE_ORDER",
        message: `You must complete "${expected}" before "${stage}".`,
      });
    }

    // insert progress row
    await client.query(
      `
      INSERT INTO public.case_stage_progress
        (case_id, completed_stage, completed_by_advocate_id, note)
      VALUES ($1,$2,$3,$4)
      `,
      [caseId, stage, advocateId, note]
    );

    // compute next stage
    const idx = STAGES.indexOf(stage);
    const nextStage =
      idx >= 0 && idx < STAGES.length - 1 ? STAGES[idx + 1] : STAGES[STAGES.length - 1];

    // ✅ If your schema has current_stage column, keep update; if not, don't crash.
    // If current_stage column doesn't exist, this will throw 42703 -> catch and ignore.
    try {
      await client.query(
        `
        UPDATE public.client_cases
        SET current_stage=$2, updated_at=NOW()
        WHERE id=$1
        `,
        [caseId, nextStage]
      );
    } catch (stageUpdateErr) {
      // ignore missing column errors
      console.warn("client_cases.current_stage update skipped:", stageUpdateErr?.code || stageUpdateErr?.message);
    }

    await client.query("COMMIT");

    // ✅ notify client in-app
    try {
      await notifyClient({
        userId: owned.row.client_user_id,
        title: "Case Stage Completed",
        message: `Stage completed: ${stage.replace(/_/g, " ")}${note ? `\nNote: ${note}` : ""}`,
        type: "CASE_STAGE",
        priority: "HIGH",
      });
    } catch (nErr) {
      console.error("notifyClient failed:", nErr);
    }

    // ✅ email client
    try {
      const clientEmail = owned.row.client_email;
      if (clientEmail) {
        await sendNotificationEmail({
          to: clientEmail,
          subject: `Stage completed: ${stage.replace(/_/g, " ")}`,
          title: "Your case has progressed",
          message: `
            <p>Your case has moved forward.</p>
            <p><b>Completed stage:</b> ${stage.replace(/_/g, " ")}</p>
            ${note ? `<p><b>Note from advocate:</b> ${note}</p>` : ""}
            <p>You can log in to your dashboard to view updated details.</p>
          `,
        });
      }
    } catch (mailErr) {
      console.error("Client email failed:", mailErr);
    }

    return res.json({ ok: true, completed_stage: stage, current_stage: nextStage });
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    console.error("completeCaseStage error:", e);
    return res.status(500).json({ error: "Internal server error" });
  } finally {
    client.release();
  }
}
