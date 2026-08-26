import express from "express";
import pool from "../../../../db.js";

const router = express.Router();

/**
 * GET /api/admin/stats
 * returns totalClients, totalAdvocates, totalUsers
 */
router.get("/", async (req, res) => {
  try {
    const totalUsersRes = await pool.query(
      `SELECT COUNT(*)::int AS total FROM public.users`
    );

    const totalClientsRes = await pool.query(
      `SELECT COUNT(*)::int AS total FROM public.users WHERE UPPER(role)='CLIENT'`
    );

    const totalAdvocatesRes = await pool.query(
      `SELECT COUNT(*)::int AS total FROM public.users WHERE UPPER(role)='ADVOCATE'`
    );

    return res.json({
      totalUsers: totalUsersRes.rows[0]?.total || 0,
      totalClients: totalClientsRes.rows[0]?.total || 0,
      totalAdvocates: totalAdvocatesRes.rows[0]?.total || 0,
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

export default router;
