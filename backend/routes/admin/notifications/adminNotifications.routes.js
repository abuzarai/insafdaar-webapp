import express from "express";
import pool from "../../../db.js";

const router = express.Router();

/**
 * GET /api/admin/notifications
 * Admin dashboard notifications (ADMIN ONLY)
 */
router.get("/", async (req, res) => {
  try {
    const adminId = req.user.id;

    const r = await pool.query(
      `
      SELECT id, title, description, type, is_read, created_at
      FROM public.admin_notifications
      WHERE admin_id = $1
      ORDER BY created_at DESC
      `,
      [adminId]
    );

    res.json({ notifications: r.rows });
  } catch (err) {
    console.error("Admin notifications error:", err);
    res.status(500).json({ error: "Failed to load admin notifications" });
  }
});

export default router;
