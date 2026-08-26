import pool from "../db.js";

/**
 * GET /api/admin/notifications
 * List notifications for logged-in admin
 */
export const listAdminNotifications = async (req, res) => {
  try {
    const adminId = req.user.id;

    const r = await pool.query(
      `
      SELECT id, title, description, type, is_read, created_at
      FROM public.admin_notifications
      WHERE admin_id = $1
      ORDER BY created_at DESC
      LIMIT 200
      `,
      [adminId]
    );

    return res.json({ notifications: r.rows });
  } catch (e) {
    console.error("listAdminNotifications error:", e);
    return res.status(500).json({ error: "Failed to load notifications" });
  }
};
