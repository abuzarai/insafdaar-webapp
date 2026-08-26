import pool from "../../../../db.js";

/**
 * GET /api/admin/client-access/dashboard/clients/:userId/feedback
 */
export async function adminListClientFeedback(req, res) {
  try {
    const userId = Number(req.params.userId);
    if (!userId) return res.status(400).json({ error: "Invalid userId" });

    const {
      q = "",
      audience = "All",
      sentiment = "All",
      limit = "50",
      offset = "0",
    } = req.query || {};

    const lim = Math.min(200, Math.max(1, Number(limit) || 50));
    const off = Math.max(0, Number(offset) || 0);

    const where = [`f.user_id = $1`];
    const values = [userId];
    let idx = values.length;

    if (audience !== "All") {
      idx++;
      where.push(`f.audience = $${idx}`);
      values.push(String(audience));
    }

    if (sentiment !== "All") {
      idx++;
      where.push(`f.sentiment = $${idx}`);
      values.push(String(sentiment));
    }

    if (String(q).trim()) {
      idx++;
      where.push(`LOWER(COALESCE(f.message,'')) LIKE $${idx}`);
      values.push(`%${String(q).trim().toLowerCase()}%`);
    }

    const totalRes = await pool.query(
      `SELECT COUNT(*)::int AS total
       FROM public.case_feedback f
       WHERE ${where.join(" AND ")}`,
      values
    );

    // pagination params
    values.push(lim, off);
    const limitParam = `$${values.length - 1}`;
    const offsetParam = `$${values.length}`;

    const rowsRes = await pool.query(
      `
      SELECT
        f.id,
        f.user_id,
        f.audience,
        f.category,
        f.sentiment,
        f.message,
        f.case_id,
        f.advocate_id,
        f.contact_preference AS contact_pref,
        f.contact_value,
        f.created_at,
        f.rating_1,
        f.rating_2,
        f.rating_3,
        f.rating_4
      FROM public.case_feedback f
      WHERE ${where.join(" AND ")}
      ORDER BY f.created_at DESC
      LIMIT ${limitParam}
      OFFSET ${offsetParam}
      `,
      values
    );

    // Map rating_1..rating_4 into the fields your frontend already expects
    const feedback = rowsRes.rows.map((r) => ({
      id: r.id,
      audience: r.audience,
      category: r.category,
      sentiment: r.sentiment,
      message: r.message,
      case_id: r.case_id,
      advocate_id: r.advocate_id,
      contact_pref: r.contact_pref ?? null,
      contact_value: r.contact_value ?? null,
      created_at: r.created_at,

      // Simple/default mapping
      website_ux: r.rating_1 ?? null,
      website_speed: r.rating_2 ?? null,
      admin_helpfulness: r.rating_3 ?? null,
      admin_response: r.rating_4 ?? null,

      // If you later add more columns, fill these properly
      advocate_knowledge: null,
      advocate_responsiveness: null,
      advocate_availability: null,
      advocate_case_handling: null,
    }));

    return res.json({ total: totalRes.rows[0]?.total || 0, feedback });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
