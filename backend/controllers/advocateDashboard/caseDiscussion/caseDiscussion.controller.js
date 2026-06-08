import { sendNotificationEmail } from "../../../utils/mailer.js";
import pool from "../../../db.js";
import { CASE_STATUS, transitionCaseStatus } from "../../../utils/caseLifecycle.js";

function toInt(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function parseDate(x) {
  const d = new Date(x);
  return Number.isNaN(d.getTime()) ? null : d;
}

async function ensureAssignedCase(caseId, advocateId) {
  const r = await pool.query(
    `
    SELECT id, user_id AS client_user_id, assigned_advocate_id
    FROM public.client_cases
    WHERE id=$1
    `,
    [Number(caseId)]
  );

  if (!r.rowCount) throw { status: 404, message: "Case not found" };

  if (Number(r.rows[0].assigned_advocate_id) !== Number(advocateId)) {
    throw { status: 403, message: "Forbidden" };
  }

  return {
    caseId: Number(r.rows[0].id),
    clientUserId: Number(r.rows[0].client_user_id),
  };
}

/**
 * GET /api/advocate/dashboard/case-discussion/meetings?status=APPROVED
 * Default status = APPROVED
 */
export async function listMyMeetings(req, res) {
  try {
    const advocateId = toInt(req.user?.id);
    if (!advocateId) return res.status(401).json({ error: "Unauthorized" });

    const role = String(req.user?.role || "").toUpperCase();
    if (role !== "ADVOCATE") return res.status(403).json({ error: "Forbidden" });

    const status = String(req.query.status || "APPROVED").toUpperCase();

    const r = await pool.query(
      `
      SELECT
        m.id,
        m.case_id,
        m.client_user_id,
        m.advocate_id,
        m.agenda,
        m.start_at,
        m.end_at,
        m.status,
        m.google_meet_link,
        m.created_at,
        m.updated_at,
        c.title AS case_title
      FROM public.case_meetings m
      JOIN public.client_cases c ON c.id = m.case_id
      WHERE m.advocate_id = $1
        AND m.status = $2
      ORDER BY m.start_at ASC
      `,
      [advocateId, status]
    );

    return res.json({ ok: true, meetings: r.rows });
  } catch (e) {
    console.error("listMyMeetings error:", e);
    return res.status(500).json({ error: e.message || "Internal server error" });
  }
}

/**
 * POST /api/advocate/dashboard/case-discussion/:caseId/request-meeting
 * Body: { start_at, end_at, agenda? }
 */
export async function requestMeeting(req, res) {
  const client = await pool.connect();
  try {
    const advocateId = toInt(req.user?.id);
    const role = String(req.user?.role || "").toUpperCase();

    if (!advocateId) return res.status(401).json({ error: "Unauthorized" });
    if (role !== "ADVOCATE") return res.status(403).json({ error: "Forbidden" });

    const caseId = toInt(req.params.caseId);
    const start_at = parseDate(req.body?.start_at);
    const end_at = parseDate(req.body?.end_at);
    const agenda = req.body?.agenda ? String(req.body.agenda).trim() : null;

    if (!caseId || !start_at || !end_at) {
      return res.status(400).json({ error: "caseId, start_at, end_at are required" });
    }
    if (end_at <= start_at) {
      return res.status(400).json({ error: "end_at must be after start_at" });
    }

    const info = await ensureAssignedCase(caseId, advocateId);

    await client.query("BEGIN");

    // create request (status default = PENDING_ADMIN)
    const r = await client.query(
      `
      INSERT INTO public.case_meetings
        (case_id, client_user_id, advocate_id, agenda, start_at, end_at)
      VALUES ($1,$2,$3,$4,$5,$6)
      RETURNING *
      `,
      [info.caseId, info.clientUserId, advocateId, agenda, start_at, end_at]
    );

    await transitionCaseStatus(client, {
      caseId: info.caseId,
      toStatus: CASE_STATUS.MEETING_PENDING_ADMIN,
      actorUserId: advocateId,
      actorRole: req.user?.role || "ADVOCATE",
      reason: "Advocate requested meeting approval",
      metadata: {
        meetingId: r.rows[0]?.id,
      },
    });

    await client.query("COMMIT");

    // notify admin by email
    const adminEmail = process.env.ADMIN_EMAIL;
    if (adminEmail) {
      sendNotificationEmail({
        to: adminEmail,
        subject: `Meeting Request | Case #${info.caseId}`,
        title: "Advocate Requested a Meeting",
        message: `
          <p><b>Case ID:</b> ${info.caseId}</p>
          <p><b>Start:</b> ${start_at.toISOString()}</p>
          <p><b>End:</b> ${end_at.toISOString()}</p>
          ${agenda ? `<p><b>Agenda:</b> ${agenda}</p>` : ""}
          <p>Please open Admin Dashboard → Case Discussion to schedule and approve.</p>
        `,
      }).catch(() => {});
    }

    return res.status(201).json({ ok: true, meeting: r.rows[0] });
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    console.error("requestMeeting error:", e);
    return res.status(e.status || 500).json({ error: e.message || "Internal server error" });
  } finally {
    client.release();
  }
}
