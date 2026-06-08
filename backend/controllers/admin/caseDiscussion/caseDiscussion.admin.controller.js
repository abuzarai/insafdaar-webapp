import pool from "../../../db.js";
import { sendNotificationEmail } from "../../../utils/mailer.js";
import { CASE_STATUS, transitionCaseStatus } from "../../../utils/caseLifecycle.js";

function toInt(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function isValidMeetLink(url) {
  if (!url) return false;
  const s = String(url).trim();
  // allow meet.google.com links (simple validation)
  return /^https?:\/\/meet\.google\.com\/[a-zA-Z0-9-]+/i.test(s);
}

/**
 * GET /api/admin/case-discussion/meeting-requests?status=PENDING_ADMIN
 * Default status = PENDING_ADMIN
 */
export async function adminListMeetingRequests(req, res) {
  try {
    const status = String(req.query.status || "PENDING_ADMIN").toUpperCase();

    const r = await pool.query(
      `
      SELECT
        m.*,
        c.title AS case_title,
        cu.name AS client_name,
        cu.email AS client_email,
        au.name AS advocate_name,
        au.email AS advocate_email
      FROM public.case_meetings m
      JOIN public.client_cases c ON c.id = m.case_id
      JOIN public.users cu ON cu.id = m.client_user_id
      JOIN public.users au ON au.id = m.advocate_id
      WHERE m.status = $1
      ORDER BY m.created_at DESC
      `,
      [status]
    );

    return res.json({ ok: true, meetings: r.rows });
  } catch (e) {
    console.error("adminListMeetingRequests error:", e);
    return res.status(500).json({ error: e.message || "Internal server error" });
  }
}

/**
 * PATCH /api/admin/case-discussion/meeting-requests/:meetingId/approve
 * Body:
 *  - google_meet_link (required)  <-- admin creates/schedules meeting then pastes link
 *  - google_event_id (optional)
 *  - admin_note (optional)
 */
export async function adminApproveMeetingRequest(req, res) {
  const client = await pool.connect();
  try {
    const meetingId = toInt(req.params.meetingId);
    if (!meetingId) return res.status(400).json({ error: "Invalid meetingId" });

    const meetLink = String(req.body?.google_meet_link || "").trim();
    const eventId = req.body?.google_event_id ? String(req.body.google_event_id).trim() : null;
    const adminNote = req.body?.admin_note ? String(req.body.admin_note).trim() : null;

    if (!isValidMeetLink(meetLink)) {
      return res.status(400).json({ error: "google_meet_link must be a valid https://meet.google.com/... link" });
    }

    await client.query("BEGIN");

    // lock row
    const mR = await client.query(
      `SELECT * FROM public.case_meetings WHERE id=$1 FOR UPDATE`,
      [meetingId]
    );
    if (!mR.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Meeting request not found" });
    }

    const m = mR.rows[0];
    if (String(m.status).toUpperCase() !== "PENDING_ADMIN") {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Only PENDING_ADMIN requests can be approved" });
    }

    // update request
    const upd = await client.query(
      `
      UPDATE public.case_meetings
      SET
        status='APPROVED',
        google_meet_link=$2,
        google_event_id=$3,
        admin_note=$4,
        approved_at=NOW(),
        updated_at=NOW()
      WHERE id=$1
      RETURNING *
      `,
      [meetingId, meetLink, eventId, adminNote]
    );

    await transitionCaseStatus(client, {
      caseId: m.case_id,
      toStatus: CASE_STATUS.MEETING_APPROVED,
      actorUserId: req.user?.id || null,
      actorRole: req.user?.role || "ADMIN",
      reason: "Admin approved meeting request",
      metadata: {
        meetingId,
        googleMeetLink: meetLink,
      },
    });

    // get client + advocate details for emails
    const peopleR = await client.query(
      `
      SELECT
        c.id AS case_id,
        c.title AS case_title,
        cu.name AS client_name,
        cu.email AS client_email,
        au.name AS advocate_name,
        au.email AS advocate_email
      FROM public.client_cases c
      JOIN public.users cu ON cu.id = c.user_id
      JOIN public.users au ON au.id = c.assigned_advocate_id
      WHERE c.id=$1
      `,
      [m.case_id]
    );

    await client.query("COMMIT");

    const people = peopleR.rows?.[0] || {};
    const clientEmail = people.client_email;
    const advocateEmail = people.advocate_email;

    const startStr = new Date(m.start_at).toLocaleString("en-GB", { timeZone: "Asia/Karachi" });
    const endStr = new Date(m.end_at).toLocaleString("en-GB", { timeZone: "Asia/Karachi" });

    const subject = `✅ Meeting Confirmed | Case #${m.case_id}`;

    // ✅ Emails (best-effort)
    if (clientEmail) {
      sendNotificationEmail({
        to: clientEmail,
        subject,
        title: "Meeting Confirmed ✅",
        message: `
          <p>Hi ${people.client_name || "Client"},</p>
          <p>Your meeting has been confirmed for <b>Case #${m.case_id}</b>.</p>
          <p><b>Start:</b> ${startStr}</p>
          <p><b>End:</b> ${endStr}</p>
          <p><b>Meet Link:</b> <a href="${meetLink}" target="_blank" rel="noreferrer">${meetLink}</a></p>
          ${m.agenda ? `<p><b>Agenda:</b> ${m.agenda}</p>` : ""}
          ${adminNote ? `<p><b>Admin Note:</b> ${adminNote}</p>` : ""}
        `,
      }).catch(() => {});
    }

    if (advocateEmail) {
      sendNotificationEmail({
        to: advocateEmail,
        subject,
        title: "Meeting Approved ✅",
        message: `
          <p>Hi ${people.advocate_name || "Advocate"},</p>
          <p>Your meeting request has been approved for <b>Case #${m.case_id}</b>.</p>
          <p><b>Start:</b> ${startStr}</p>
          <p><b>End:</b> ${endStr}</p>
          <p><b>Meet Link:</b> <a href="${meetLink}" target="_blank" rel="noreferrer">${meetLink}</a></p>
          ${m.agenda ? `<p><b>Agenda:</b> ${m.agenda}</p>` : ""}
          ${adminNote ? `<p><b>Admin Note:</b> ${adminNote}</p>` : ""}
        `,
      }).catch(() => {});
    }

    return res.json({ ok: true, meeting: upd.rows[0] });
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch {}
    console.error("adminApproveMeetingRequest error:", e);
    return res.status(500).json({ error: e.message || "Internal server error" });
  } finally {
    client.release();
  }
}

/**
 * PATCH /api/admin/case-discussion/meeting-requests/:meetingId/reject
 * Body: { admin_note (required) }
 */
export async function adminRejectMeetingRequest(req, res) {
  const client = await pool.connect();
  try {
    const meetingId = toInt(req.params.meetingId);
    if (!meetingId) return res.status(400).json({ error: "Invalid meetingId" });

    const adminNote = String(req.body?.admin_note || "").trim();
    if (!adminNote) return res.status(400).json({ error: "admin_note is required" });

    await client.query("BEGIN");

    const currentR = await client.query(
      `
      SELECT id, case_id
      FROM public.case_meetings
      WHERE id=$1 AND status='PENDING_ADMIN'
      FOR UPDATE
      `,
      [meetingId]
    );

    if (!currentR.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Meeting request not found or not pending" });
    }

    const r = await client.query(
      `
      UPDATE public.case_meetings
      SET status='REJECTED',
          admin_note=$2,
          updated_at=NOW()
      WHERE id=$1 AND status='PENDING_ADMIN'
      RETURNING *
      `,
      [meetingId, adminNote]
    );

    await transitionCaseStatus(client, {
      caseId: currentR.rows[0].case_id,
      toStatus: CASE_STATUS.ACCEPTED,
      actorUserId: req.user?.id || null,
      actorRole: req.user?.role || "ADMIN",
      reason: "Admin rejected meeting request",
      metadata: {
        meetingId,
        adminNote,
      },
    });

    await client.query("COMMIT");

    return res.json({ ok: true, meeting: r.rows[0] });
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    console.error("adminRejectMeetingRequest error:", e);
    return res.status(500).json({ error: e.message || "Internal server error" });
  } finally {
    client.release();
  }
}
