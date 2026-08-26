import pool from "../../../db.js";

/**
 * GET /api/client/dashboard/meetings/approved
 * Returns approved meetings for the logged-in client
 */
export async function listMyApprovedMeetings(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const r = await pool.query(
      `
      SELECT
        m.id,
        m.case_id,
        m.start_at,
        m.end_at,
        m.google_meet_link,
        m.status,
        m.approved_at,
        m.created_at
      FROM public.case_meetings m
      WHERE m.client_user_id = $1
        AND UPPER(m.status) = 'APPROVED'
      ORDER BY m.start_at ASC, m.id ASC
      `,
      [Number(userId)]
    );

    return res.json({ meetings: r.rows });
  } catch (e) {
    console.error("listMyApprovedMeetings error:", e);
    return res.status(500).json({ error: e.message || "Internal server error" });
  }
}
