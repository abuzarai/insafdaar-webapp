import pool from "../../../db.js";

function toInt(x, def = 0) {
  const n = Number(x);
  return Number.isFinite(n) ? n : def;
}

export async function getMyAdvocateNotifications(req, res) {
  try {
    const advocateId = Number(req.user?.id);
    if (!advocateId) return res.status(401).json({ error: "Unauthorized" });

    const limit = Math.min(100, Math.max(1, toInt(req.query.limit, 30)));
    const offset = Math.max(0, toInt(req.query.offset, 0));
    const unreadOnly = String(req.query.unreadOnly || "").toLowerCase() === "true";

    const where = [`advocate_id = $1`];
    const params = [advocateId];

    if (unreadOnly) where.push(`is_read = false`);

    const q = `
      SELECT
        id,
        advocate_id,
        title,
        description,
        type,
        priority,
        is_read,
        created_at,
        updated_at
      FROM public.advocate_notifications
      WHERE ${where.join(" AND ")}
      ORDER BY created_at DESC
      LIMIT $2 OFFSET $3
    `;

    const items = await pool.query(q, [advocateId, limit, offset]);

    const countQ = `
      SELECT COUNT(*)::int AS total
      FROM public.advocate_notifications
      WHERE ${where.join(" AND ")}
    `;
    const total = await pool.query(countQ, [advocateId]);

    const unreadQ = `
      SELECT COUNT(*)::int AS unread
      FROM public.advocate_notifications
      WHERE advocate_id=$1 AND is_read=false
    `;
    const unread = await pool.query(unreadQ, [advocateId]);

    return res.json({
      ok: true,
      total: total.rows[0]?.total || 0,
      unread: unread.rows[0]?.unread || 0,
      items: items.rows,
    });
  } catch (e) {
    console.error("getMyAdvocateNotifications error:", e);
    return res.status(500).json({ error: "Internal server error" });
  }
}

export async function markAdvocateNotificationRead(req, res) {
  try {
    const advocateId = Number(req.user?.id);
    if (!advocateId) return res.status(401).json({ error: "Unauthorized" });

    const id = toInt(req.params.id, null);
    if (!id) return res.status(400).json({ error: "Invalid notification id" });

    const r = await pool.query(
      `
      UPDATE public.advocate_notifications
      SET is_read=true, updated_at=NOW()
      WHERE id=$1 AND advocate_id=$2
      RETURNING id, is_read
      `,
      [id, advocateId]
    );

    if (r.rowCount === 0) return res.status(404).json({ error: "Notification not found" });

    return res.json({ ok: true, item: r.rows[0] });
  } catch (e) {
    console.error("markAdvocateNotificationRead error:", e);
    return res.status(500).json({ error: "Internal server error" });
  }
}

export async function markAllAdvocateNotificationsRead(req, res) {
  try {
    const advocateId = Number(req.user?.id);
    if (!advocateId) return res.status(401).json({ error: "Unauthorized" });

    await pool.query(
      `
      UPDATE public.advocate_notifications
      SET is_read=true, updated_at=NOW()
      WHERE advocate_id=$1 AND is_read=false
      `,
      [advocateId]
    );

    return res.json({ ok: true });
  } catch (e) {
    console.error("markAllAdvocateNotificationsRead error:", e);
    return res.status(500).json({ error: "Internal server error" });
  }
}
