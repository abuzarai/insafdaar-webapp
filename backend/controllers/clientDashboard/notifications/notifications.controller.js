import pool from "../../../db.js";

/**
 * GET /api/client/dashboard/notifications
 */
export async function listMyNotifications(req, res) {
  try {
    const userId = req.user.id;

    const {
      type = "All",
      read = "All",
      q = "",
      limit = "50",
      offset = "0",
    } = req.query || {};

    const lim = Math.min(200, Math.max(1, Number(limit) || 50));
    const off = Math.max(0, Number(offset) || 0);

    const where = [`n.user_id = $1`];
    const values = [userId];
    let idx = values.length;

    if (type !== "All") {
      idx++;
      where.push(`n.type = $${idx}`);
      values.push(type);
    }

    if (read !== "All") {
      idx++;
      where.push(`n.is_read = $${idx}`);
      values.push(read === "Read");
    }

    if (q.trim()) {
      idx++;
      where.push(`(
        LOWER(n.title) LIKE $${idx}
        OR LOWER(COALESCE(n.description,'')) LIKE $${idx}
      )`);
      values.push(`%${q.toLowerCase()}%`);
    }

    const totalRes = await pool.query(
      `SELECT COUNT(*)::int AS total
       FROM public.client_notifications n
       WHERE ${where.join(" AND ")}`,
      values
    );

    values.push(lim, off);

    const rowsRes = await pool.query(
      `
      SELECT id, case_id, title, description, type, priority, is_read, created_at
      FROM public.client_notifications n
      WHERE ${where.join(" AND ")}
      ORDER BY created_at DESC
      LIMIT $${values.length - 1}
      OFFSET $${values.length}
      `,
      values
    );

    res.json({
      total: totalRes.rows[0]?.total || 0,
      notifications: rowsRes.rows,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

/**
 * GET /unread-count
 */
export async function getUnreadCount(req, res) {
  try {
    const userId = req.user.id;

    const r = await pool.query(
      `SELECT COUNT(*)::int AS unread
       FROM public.client_notifications
       WHERE user_id=$1 AND is_read=false`,
      [userId]
    );

    res.json({ unread: r.rows[0]?.unread || 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

/**
 * PATCH /:id/read
 */
export async function markNotificationRead(req, res) {
  try {
    const userId = req.user.id;
    const id = Number(req.params.id);
    const read = typeof req.body?.read === "boolean" ? req.body.read : true;

    if (!id) return res.status(400).json({ error: "Invalid notification id" });

    const r = await pool.query(
      `
      UPDATE public.client_notifications
      SET is_read=$1
      WHERE id=$2 AND user_id=$3
      RETURNING *
      `,
      [read, id, userId]
    );

    if (!r.rows.length)
      return res.status(404).json({ error: "Notification not found" });

    res.json({ message: "Updated", notification: r.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

/**
 * PATCH /mark-all-read
 */
export async function markAllRead(req, res) {
  try {
    const userId = req.user.id;

    await pool.query(
      `
      UPDATE public.client_notifications
      SET is_read=true
      WHERE user_id=$1 AND is_read=false
      `,
      [userId]
    );

    res.json({ message: "All notifications marked as read" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

/**
 * DELETE /clear-read
 */
export async function clearReadNotifications(req, res) {
  try {
    const userId = req.user.id;

    const r = await pool.query(
      `
      DELETE FROM public.client_notifications
      WHERE user_id=$1 AND is_read=true
      RETURNING id
      `,
      [userId]
    );

    res.json({
      message: "Cleared read notifications",
      removed: r.rows.length,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

/**
 * DELETE /:id
 */
export async function deleteNotification(req, res) {
  try {
    const userId = req.user.id;
    const id = Number(req.params.id);

    if (!id) return res.status(400).json({ error: "Invalid notification id" });

    const r = await pool.query(
      `
      DELETE FROM public.client_notifications
      WHERE id=$1 AND user_id=$2
      RETURNING id
      `,
      [id, userId]
    );

    if (!r.rows.length)
      return res.status(404).json({ error: "Notification not found" });

    res.json({ message: "Deleted", id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

/**
 * Helper for Admin / Advocate / System
 */
export async function createClientNotification({
  userId,
  caseId = null,
  title,
  description = null,
  type = "System",
  priority = "Low",
}) {
  const r = await pool.query(
    `
    INSERT INTO public.client_notifications
    (user_id, case_id, title, description, type, priority, is_read)
    VALUES ($1,$2,$3,$4,$5,$6,false)
    RETURNING *
    `,
    [userId, caseId, title, description, type, priority]
  );

  return r.rows[0];
}
