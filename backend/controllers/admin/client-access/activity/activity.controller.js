import pool from "../../../../db.js";

export async function listActivityFeed(req, res) {
  try {
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
    const offset = Math.max(0, Number(req.query.offset) || 0);

    const source = String(req.query.source || "ALL").toUpperCase();
    const isReadRaw = req.query.is_read;
    const isRead =
      isReadRaw === undefined ? null : String(isReadRaw).toLowerCase() === "true";

    const r = await pool.query(
      `
      WITH feed AS (
        SELECT
          'CLIENT'::text AS source,
          n.id,
          n.user_id,
          u.email AS user_email,
          n.case_id,
          NULL::int AS admin_id,
          NULL::text AS admin_email,
          n.title,
          n.description,
          n.type::text AS type,
          n.priority::text AS priority,
          n.is_read,
          n.created_at
        FROM public.client_notifications n
        JOIN public.users u ON u.id = n.user_id

        UNION ALL

        SELECT
          'ADMIN'::text AS source,
          an.id,
          NULL::int AS user_id,
          NULL::text AS user_email,
          NULL::int AS case_id,
          an.admin_id,
          au.email AS admin_email,
          an.title,
          an.description,
          an.type::text AS type,
          NULL::text AS priority,
          an.is_read,
          an.created_at
        FROM public.admin_notifications an
        JOIN public.users au ON au.id = an.admin_id
      )
      SELECT *
      FROM feed
      WHERE
        ($3::text = 'ALL' OR source = $3::text)
        AND ($4::boolean IS NULL OR is_read = $4::boolean)
      ORDER BY created_at DESC
      LIMIT $1 OFFSET $2
      `,
      [limit, offset, source, isRead]
    );

    return res.json({
      activity: r.rows,
      limit,
      offset,
      filters: { source, is_read: isRead },
    });
  } catch (err) {
    console.error("listActivityFeed error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
