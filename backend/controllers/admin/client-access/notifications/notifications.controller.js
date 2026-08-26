import pool from "../../../../db.js";

function toInt(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function requireAdmin(req, res) {
  const adminId = toInt(req.user?.id);
  if (!adminId) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }
  return adminId;
}

/**
 * GET /api/admin/client-access/notifications/client/:userId
 * Admin can view a specific client's notifications
 */
export async function listClientNotifications(req, res) {
  const adminId = requireAdmin(req, res);
  if (!adminId) return;

  try {
    const userId = toInt(req.params.userId);
    if (!userId) return res.status(400).json({ error: "Invalid userId" });

    // Optional: verify it's a client
    const u = await pool.query(
      `SELECT id FROM public.users WHERE id=$1 AND UPPER(role)='CLIENT'`,
      [userId]
    );
    if (u.rowCount === 0) {
      return res.status(404).json({ error: "Client not found" });
    }

    const r = await pool.query(
      `
      SELECT
        n.id,
        n.user_id,
        n.case_id,
        n.title,
        n.description AS message,
        n.type,
        n.priority,
        n.is_read,
        n.created_at
      FROM public.client_notifications n
      WHERE n.user_id=$1
      ORDER BY n.created_at DESC
      LIMIT 200
      `,
      [userId]
    );

    return res.json({ notifications: r.rows });
  } catch (e) {
    console.error("listClientNotifications error:", e);
    return res.status(500).json({ error: "Internal server error" });
  }
}

/**
 * GET /api/admin/client-access/notifications/recent?limit=50
 * Admin can view latest notifications across all clients
 */
export async function listRecentNotifications(req, res) {
  const adminId = requireAdmin(req, res);
  if (!adminId) return;

  try {
    const limit = Math.min(Math.max(toInt(req.query?.limit) || 50, 1), 200);

    const r = await pool.query(
      `
      SELECT
        n.id,
        n.user_id,
        n.case_id,
        u.email as client_email,
        n.title,
        n.description AS message,
        n.type,
        n.priority,
        n.is_read,
        n.created_at
      FROM public.client_notifications n
      JOIN public.users u ON u.id=n.user_id
      WHERE UPPER(u.role)='CLIENT'
      ORDER BY n.created_at DESC
      LIMIT $1
      `,
      [limit]
    );

    return res.json({ notifications: r.rows });
  } catch (e) {
    console.error("listRecentNotifications error:", e);
    return res.status(500).json({ error: "Internal server error" });
  }
}

/**
 * PATCH /api/admin/client-access/notifications/:id/read
 * Mark notification read (admin tool)
 */
export async function markNotificationRead(req, res) {
  const adminId = requireAdmin(req, res);
  if (!adminId) return;

  try {
    const id = toInt(req.params.id);
    if (!id) return res.status(400).json({ error: "Invalid id" });

    const r = await pool.query(
      `
      UPDATE public.client_notifications
      SET is_read=true
      WHERE id=$1
      RETURNING id, user_id, is_read
      `,
      [id]
    );

    if (r.rowCount === 0) {
      return res.status(404).json({ error: "Notification not found" });
    }

    return res.json({ ok: true, notification: r.rows[0] });
  } catch (e) {
    console.error("markNotificationRead error:", e);
    return res.status(500).json({ error: "Internal server error" });
  }
}
