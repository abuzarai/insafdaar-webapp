import pool from "../../../db.js";
import { notifyClient } from "../../../utils/notify.js";
import { sendNotificationEmail } from "../../../utils/mailer.js";

function toInt(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function requireAdvocate(req, res) {
  const advocateId = toInt(req.user?.id);
  const role = String(req.user?.role || "").toLowerCase();
  if (!advocateId || role !== "advocate") {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }
  return advocateId;
}

async function getCaseAssignment(client, caseId, advocateId) {
  // IMPORTANT: Your client_cases uses assigned_advocate_id (from your earlier logs)
  const r = await client.query(
    `
    SELECT
      c.id,
      c.title,
      c.status,
      c.user_id AS client_user_id,
      c.assigned_advocate_id,
      u.email AS client_email,
      u.name  AS client_name
    FROM public.client_cases c
    JOIN public.users u ON u.id = c.user_id
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

async function getHearingOwnership(client, hearingId, advocateId) {
  const r = await client.query(
    `
    SELECT
      h.*,
      c.title AS case_title,
      c.status AS case_status,
      c.user_id AS client_user_id,
      u.email AS client_email,
      u.name AS client_name
    FROM public.case_hearings h
    JOIN public.client_cases c ON c.id = h.case_id
    JOIN public.users u ON u.id = c.user_id
    WHERE h.id=$1
    LIMIT 1
    `,
    [hearingId]
  );

  if (r.rowCount === 0) return { ok: false, status: 404, payload: { error: "Hearing not found" } };

  const row = r.rows[0];
  if (Number(row.advocate_id) !== Number(advocateId)) {
    return { ok: false, status: 403, payload: { error: "Not your hearing" } };
  }

  return { ok: true, row };
}

function isValidStatus(s) {
  return ["SCHEDULED", "HELD", "ADJOURNED", "CANCELLED"].includes(String(s || "").toUpperCase());
}

function isValidDraftType(s) {
  return ["PETITION", "REPLY", "APPLICATION", "ARGUMENTS", "OTHER"].includes(String(s || "").toUpperCase());
}

function isValidAddedBy(s) {
  return ["ADVOCATE", "CLIENT"].includes(String(s || "").toUpperCase());
}

function assertCaseActiveStatus(caseStatus) {
  const status = String(caseStatus || "").toUpperCase();
  if (status !== "CASE_ACTIVE") {
    return {
      ok: false,
      status: 409,
      payload: {
        error: "CASE_NOT_ACTIVE",
        message: `Case must be CASE_ACTIVE to proceed with hearings. Current status: ${status || "UNKNOWN"}`,
        currentStatus: status || null,
      },
    };
  }
  return { ok: true };
}

/**
 * GET /api/advocate/dashboard/hearings/cases
 * returns cases assigned to this advocate
 */
export async function listMyCasesForHearings(req, res) {
  const advocateId = requireAdvocate(req, res);
  if (!advocateId) return;

  try {
    const r = await pool.query(
      `
      SELECT id, title, status, created_at
      FROM public.client_cases
      WHERE assigned_advocate_id = $1
        AND status = 'CASE_ACTIVE'
      ORDER BY id DESC
      `,
      [advocateId]
    );

    return res.json({ ok: true, cases: r.rows });
  } catch (e) {
    console.error("listMyCasesForHearings error:", e);
    return res.status(500).json({ error: "Internal server error" });
  }
}

/**
 * GET /api/advocate/dashboard/hearings/cases/:caseId
 * list hearings + joined logs
 */
export async function listCaseHearings(req, res) {
  const advocateId = requireAdvocate(req, res);
  if (!advocateId) return;

  const caseId = toInt(req.params.caseId);
  if (!caseId) return res.status(400).json({ error: "Invalid caseId" });

  const client = await pool.connect();
  try {
    const owned = await getCaseAssignment(client, caseId, advocateId);
    if (!owned.ok) return res.status(owned.status).json(owned.payload);

    const activeCheck = assertCaseActiveStatus(owned.row.status);
    if (!activeCheck.ok) return res.status(activeCheck.status).json(activeCheck.payload);

    const hearings = await client.query(
      `
      SELECT
        h.*,
        a.client_present,
        a.respondent_present,
        a.client_note,
        a.advocate_note,
        p.court_statement,
        p.outcome_summary,
        p.next_hearing_at
      FROM public.case_hearings h
      LEFT JOIN public.case_hearing_attendance a ON a.hearing_id = h.id
      LEFT JOIN public.case_hearing_proceedings p ON p.hearing_id = h.id
      WHERE h.case_id = $1 AND h.advocate_id = $2
      ORDER BY h.hearing_at DESC
      `,
      [caseId, advocateId]
    );

    return res.json({ ok: true, case: owned.row, hearings: hearings.rows });
  } catch (e) {
    console.error("listCaseHearings error:", e);
    return res.status(500).json({ error: "Internal server error" });
  } finally {
    client.release();
  }
}

/**
 * POST /api/advocate/dashboard/hearings/cases/:caseId
 * Schedule a new hearing (prevents multiple upcoming scheduled hearings by default)
 */
export async function createHearing(req, res) {
  const advocateId = requireAdvocate(req, res);
  if (!advocateId) return;

  const caseId = toInt(req.params.caseId);
  if (!caseId) return res.status(400).json({ error: "Invalid caseId" });

  const hearingAt = req.body?.hearing_at ? new Date(req.body.hearing_at) : null;
  if (!hearingAt || Number.isNaN(hearingAt.getTime())) {
    return res.status(400).json({ error: "Invalid hearing_at" });
  }

  const court_name = req.body?.court_name ? String(req.body.court_name).trim() : null;
  const courtroom = req.body?.courtroom ? String(req.body.courtroom).trim() : null;
  const purpose = req.body?.purpose ? String(req.body.purpose).trim() : null;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const owned = await getCaseAssignment(client, caseId, advocateId);
    if (!owned.ok) {
      await client.query("ROLLBACK");
      return res.status(owned.status).json(owned.payload);
    }

    const activeCheck = assertCaseActiveStatus(owned.row.status);
    if (!activeCheck.ok) {
      await client.query("ROLLBACK");
      return res.status(activeCheck.status).json(activeCheck.payload);
    }

    // Recommended: block multiple upcoming scheduled hearings
    const existing = await client.query(
      `
      SELECT 1
      FROM public.case_hearings
      WHERE case_id=$1 AND advocate_id=$2
        AND status='SCHEDULED'
        AND hearing_at >= NOW()
      LIMIT 1
      `,
      [caseId, advocateId]
    );

    if (existing.rowCount > 0) {
      await client.query("ROLLBACK");
      return res.status(409).json({
        error: "UPCOMING_HEARING_EXISTS",
        message: "An upcoming scheduled hearing already exists for this case.",
      });
    }

    const ins = await client.query(
      `
      INSERT INTO public.case_hearings
        (case_id, advocate_id, hearing_at, court_name, courtroom, purpose)
      VALUES ($1,$2,$3,$4,$5,$6)
      RETURNING *
      `,
      [caseId, advocateId, hearingAt.toISOString(), court_name, courtroom, purpose]
    );

    await client.query("COMMIT");

    // optional: notify client in-app (not email, because cron will do reminders)
    try {
      await notifyClient({
        userId: owned.row.client_user_id,
        title: "📅 Court Hearing Scheduled",
        message: `A hearing has been scheduled on ${hearingAt.toLocaleString("en-GB", { timeZone: "Asia/Karachi" })}.`,
        type: "CASE",
        priority: "HIGH",
      });
    } catch {}

    return res.json({ ok: true, hearing: ins.rows[0] });
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    console.error("createHearing error:", e);
    return res.status(500).json({ error: "Internal server error" });
  } finally {
    client.release();
  }
}

/**
 * PATCH /api/advocate/dashboard/hearings/:hearingId/status
 * Updates hearing status
 */
export async function updateHearingStatusAndLogs(req, res) {
  const advocateId = requireAdvocate(req, res);
  if (!advocateId) return;

  const hearingId = toInt(req.params.hearingId);
  if (!hearingId) return res.status(400).json({ error: "Invalid hearingId" });

  const status = String(req.body?.status || "").toUpperCase();
  if (!isValidStatus(status)) return res.status(400).json({ error: "Invalid status" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const owned = await getHearingOwnership(client, hearingId, advocateId);
    if (!owned.ok) {
      await client.query("ROLLBACK");
      return res.status(owned.status).json(owned.payload);
    }

    const activeCheck = assertCaseActiveStatus(owned.row.case_status);
    if (!activeCheck.ok) {
      await client.query("ROLLBACK");
      return res.status(activeCheck.status).json(activeCheck.payload);
    }

    await client.query(
      `
      UPDATE public.case_hearings
      SET status=$2, updated_at=NOW()
      WHERE id=$1
      `,
      [hearingId, status]
    );

    await client.query("COMMIT");
    return res.json({ ok: true });
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    console.error("updateHearingStatusAndLogs error:", e);
    return res.status(500).json({ error: "Internal server error" });
  } finally {
    client.release();
  }
}

/**
 * PUT /api/advocate/dashboard/hearings/:hearingId/attendance
 * upsert attendance record
 */
export async function upsertAttendance(req, res) {
  const advocateId = requireAdvocate(req, res);
  if (!advocateId) return;

  const hearingId = toInt(req.params.hearingId);
  if (!hearingId) return res.status(400).json({ error: "Invalid hearingId" });

  const client_present = typeof req.body?.client_present === "boolean" ? req.body.client_present : null;
  const respondent_present = typeof req.body?.respondent_present === "boolean" ? req.body.respondent_present : null;
  const client_note = req.body?.client_note ? String(req.body.client_note).trim() : null;
  const advocate_note = req.body?.advocate_note ? String(req.body.advocate_note).trim() : null;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const owned = await getHearingOwnership(client, hearingId, advocateId);
    if (!owned.ok) {
      await client.query("ROLLBACK");
      return res.status(owned.status).json(owned.payload);
    }

    const activeCheck = assertCaseActiveStatus(owned.row.case_status);
    if (!activeCheck.ok) {
      await client.query("ROLLBACK");
      return res.status(activeCheck.status).json(activeCheck.payload);
    }

    const up = await client.query(
      `
      INSERT INTO public.case_hearing_attendance
        (hearing_id, client_present, respondent_present, client_note, advocate_note)
      VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT (hearing_id)
      DO UPDATE SET
        client_present=EXCLUDED.client_present,
        respondent_present=EXCLUDED.respondent_present,
        client_note=EXCLUDED.client_note,
        advocate_note=EXCLUDED.advocate_note,
        updated_at=NOW()
      RETURNING *
      `,
      [hearingId, client_present, respondent_present, client_note, advocate_note]
    );

    await client.query("COMMIT");
    return res.json({ ok: true, attendance: up.rows[0] });
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    console.error("upsertAttendance error:", e);
    return res.status(500).json({ error: "Internal server error" });
  } finally {
    client.release();
  }
}

/**
 * PUT /api/advocate/dashboard/hearings/:hearingId/proceedings
 * upsert proceedings + auto-create next hearing if next_hearing_at provided
 */
export async function upsertProceedings(req, res) {
  const advocateId = requireAdvocate(req, res);
  if (!advocateId) return;

  const hearingId = toInt(req.params.hearingId);
  if (!hearingId) return res.status(400).json({ error: "Invalid hearingId" });

  const court_statement = req.body?.court_statement ? String(req.body.court_statement).trim() : "";
  if (!court_statement) return res.status(400).json({ error: "court_statement is required" });

  const outcome_summary = req.body?.outcome_summary ? String(req.body.outcome_summary).trim() : null;

  const nextHearingAt = req.body?.next_hearing_at ? new Date(req.body.next_hearing_at) : null;
  if (req.body?.next_hearing_at && (!nextHearingAt || Number.isNaN(nextHearingAt.getTime()))) {
    return res.status(400).json({ error: "Invalid next_hearing_at" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const owned = await getHearingOwnership(client, hearingId, advocateId);
    if (!owned.ok) {
      await client.query("ROLLBACK");
      return res.status(owned.status).json(owned.payload);
    }

    const activeCheck = assertCaseActiveStatus(owned.row.case_status);
    if (!activeCheck.ok) {
      await client.query("ROLLBACK");
      return res.status(activeCheck.status).json(activeCheck.payload);
    }

    // Upsert proceedings
    const pr = await client.query(
      `
      INSERT INTO public.case_hearing_proceedings
        (hearing_id, court_statement, outcome_summary, next_hearing_at)
      VALUES ($1,$2,$3,$4)
      ON CONFLICT (hearing_id)
      DO UPDATE SET
        court_statement=EXCLUDED.court_statement,
        outcome_summary=EXCLUDED.outcome_summary,
        next_hearing_at=EXCLUDED.next_hearing_at,
        updated_at=NOW()
      RETURNING *
      `,
      [hearingId, court_statement, outcome_summary, nextHearingAt ? nextHearingAt.toISOString() : null]
    );

    // If next hearing date exists -> create new hearing cycle (if no upcoming scheduled exists)
    let createdNext = null;

    if (nextHearingAt) {
      // block multiple upcoming scheduled hearings
      const exists = await client.query(
        `
        SELECT 1
        FROM public.case_hearings
        WHERE case_id=$1 AND advocate_id=$2
          AND status='SCHEDULED'
          AND hearing_at >= NOW()
        LIMIT 1
        `,
        [owned.row.case_id, advocateId]
      );

      if (exists.rowCount === 0) {
        const ins = await client.query(
          `
          INSERT INTO public.case_hearings
            (case_id, advocate_id, hearing_at, court_name)
          VALUES ($1,$2,$3,$4)
          RETURNING *
          `,
          [
            owned.row.case_id,
            advocateId,
            nextHearingAt.toISOString(),
            owned.row.court_name || null,
          ]
        );
        createdNext = ins.rows[0];
      }
    }

    await client.query("COMMIT");

    // notify client (in-app + optional email instant)
    try {
      await notifyClient({
        userId: owned.row.client_user_id,
        title: "📌 Hearing Update",
        message: `Court proceedings updated.${nextHearingAt ? ` Next hearing: ${nextHearingAt.toLocaleString("en-GB", { timeZone: "Asia/Karachi" })}` : ""}`,
        type: "CASE",
        priority: "HIGH",
      });
    } catch {}

    // optional immediate email (reminder cron will still handle 24h/6h)
    try {
      if (owned.row.client_email) {
        await sendNotificationEmail({
          to: owned.row.client_email,
          subject: `Court hearing update | Case #${owned.row.case_id}`,
          title: "Court hearing update",
          message: `
            <p>Hi ${owned.row.client_name || "Client"},</p>
            <p><b>Proceedings updated.</b></p>
            <p>${court_statement.replace(/\n/g, "<br/>")}</p>
            ${
              nextHearingAt
                ? `<p><b>Next hearing:</b> ${nextHearingAt.toLocaleString("en-GB", { timeZone: "Asia/Karachi" })}</p>`
                : ""
            }
          `,
        });
      }
    } catch {}

    return res.json({ ok: true, proceedings: pr.rows[0], next_hearing: createdNext });
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    console.error("upsertProceedings error:", e);
    return res.status(500).json({ error: "Internal server error" });
  } finally {
    client.release();
  }
}

/**
 * POST /api/advocate/dashboard/hearings/:hearingId/evidence
 */
export async function addEvidence(req, res) {
  const advocateId = requireAdvocate(req, res);
  if (!advocateId) return;

  const hearingId = toInt(req.params.hearingId);
  if (!hearingId) return res.status(400).json({ error: "Invalid hearingId" });

  const title = req.body?.title ? String(req.body.title).trim() : "";
  if (!title) return res.status(400).json({ error: "title is required" });

  const description = req.body?.description ? String(req.body.description).trim() : null;
  const file_url = req.body?.file_url ? String(req.body.file_url).trim() : null;

  const added_by = req.body?.added_by ? String(req.body.added_by).toUpperCase() : "ADVOCATE";
  if (!isValidAddedBy(added_by)) return res.status(400).json({ error: "Invalid added_by" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const owned = await getHearingOwnership(client, hearingId, advocateId);
    if (!owned.ok) {
      await client.query("ROLLBACK");
      return res.status(owned.status).json(owned.payload);
    }

    const activeCheck = assertCaseActiveStatus(owned.row.case_status);
    if (!activeCheck.ok) {
      await client.query("ROLLBACK");
      return res.status(activeCheck.status).json(activeCheck.payload);
    }

    const ins = await client.query(
      `
      INSERT INTO public.case_hearing_evidence
        (hearing_id, title, description, file_url, added_by)
      VALUES ($1,$2,$3,$4,$5)
      RETURNING *
      `,
      [hearingId, title, description, file_url, added_by]
    );

    await client.query("COMMIT");
    return res.json({ ok: true, evidence: ins.rows[0] });
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    console.error("addEvidence error:", e);
    return res.status(500).json({ error: "Internal server error" });
  } finally {
    client.release();
  }
}

export async function listEvidence(req, res) {
  const advocateId = requireAdvocate(req, res);
  if (!advocateId) return;

  const hearingId = toInt(req.params.hearingId);
  if (!hearingId) return res.status(400).json({ error: "Invalid hearingId" });

  const client = await pool.connect();
  try {
    const owned = await getHearingOwnership(client, hearingId, advocateId);
    if (!owned.ok) return res.status(owned.status).json(owned.payload);

    const activeCheck = assertCaseActiveStatus(owned.row.case_status);
    if (!activeCheck.ok) return res.status(activeCheck.status).json(activeCheck.payload);

    const r = await client.query(
      `
      SELECT *
      FROM public.case_hearing_evidence
      WHERE hearing_id=$1
      ORDER BY id DESC
      `,
      [hearingId]
    );

    return res.json({ ok: true, evidence: r.rows });
  } catch (e) {
    console.error("listEvidence error:", e);
    return res.status(500).json({ error: "Internal server error" });
  } finally {
    client.release();
  }
}

/**
 * POST /api/advocate/dashboard/hearings/:hearingId/drafts
 */
export async function addDraft(req, res) {
  const advocateId = requireAdvocate(req, res);
  if (!advocateId) return;

  const hearingId = toInt(req.params.hearingId);
  if (!hearingId) return res.status(400).json({ error: "Invalid hearingId" });

  const draft_type = req.body?.draft_type ? String(req.body.draft_type).toUpperCase() : "";
  if (!isValidDraftType(draft_type)) return res.status(400).json({ error: "Invalid draft_type" });

  const content = req.body?.content ? String(req.body.content).trim() : "";
  if (!content) return res.status(400).json({ error: "content is required" });

  const file_url = req.body?.file_url ? String(req.body.file_url).trim() : null;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const owned = await getHearingOwnership(client, hearingId, advocateId);
    if (!owned.ok) {
      await client.query("ROLLBACK");
      return res.status(owned.status).json(owned.payload);
    }

    const ins = await client.query(
      `
      INSERT INTO public.case_hearing_drafts
        (hearing_id, draft_type, content, file_url)
      VALUES ($1,$2,$3,$4)
      RETURNING *
      `,
      [hearingId, draft_type, content, file_url]
    );

    await client.query("COMMIT");
    return res.json({ ok: true, draft: ins.rows[0] });
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    console.error("addDraft error:", e);
    return res.status(500).json({ error: "Internal server error" });
  } finally {
    client.release();
  }
}

export async function listDrafts(req, res) {
  const advocateId = requireAdvocate(req, res);
  if (!advocateId) return;

  const hearingId = toInt(req.params.hearingId);
  if (!hearingId) return res.status(400).json({ error: "Invalid hearingId" });

  const client = await pool.connect();
  try {
    const owned = await getHearingOwnership(client, hearingId, advocateId);
    if (!owned.ok) return res.status(owned.status).json(owned.payload);

    const activeCheck = assertCaseActiveStatus(owned.row.case_status);
    if (!activeCheck.ok) return res.status(activeCheck.status).json(activeCheck.payload);

    const r = await client.query(
      `
      SELECT *
      FROM public.case_hearing_drafts
      WHERE hearing_id=$1
      ORDER BY id DESC
      `,
      [hearingId]
    );

    return res.json({ ok: true, drafts: r.rows });
  } catch (e) {
    console.error("listDrafts error:", e);
    return res.status(500).json({ error: "Internal server error" });
  } finally {
    client.release();
  }
}
