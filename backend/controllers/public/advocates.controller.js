import pool from "../../db.js";

/**
 * GET /api/public/advocates
 * Returns: { advocates: PublicAdvocate[] }
 *
 * Public fields only (safe):
 * - id, name, headline, practice_areas, experience_years, avatar_url
 * - rating_avg, rating_count (optional - returned as null/0 here)
 */
export async function getPublicAdvocates(req, res) {
  try {
    // Optional search param: ?q=
    const qRaw = String(req.query.q || "").trim().toLowerCase();

    const params = [];
    let where = `
      LOWER(u.role) = 'advocate'
      AND COALESCE(ap.public_profile_enabled, true) = true
      AND COALESCE(ap.is_verified, false) = true
    `;

    if (qRaw) {
      params.push(`%${qRaw}%`);
      where += ` AND (
        LOWER(COALESCE(u.name, '')) LIKE $1
        OR LOWER(COALESCE(ap.headline, '')) LIKE $1
        OR EXISTS (
          SELECT 1
          FROM unnest(COALESCE(ap.practice_areas, ARRAY[]::text[])) x
          WHERE LOWER(x) LIKE $1
        )
      )`;
    }

    const sql = `
      SELECT
        u.id,
        u.name,
        ap.headline,
        ap.practice_areas,
        ap.experience_years,
        ap.avatar_url,

        /* Ratings: keep null/0 for now (until reviews table exists) */
        NULL::numeric AS rating_avg,
        0::int AS rating_count
      FROM public.users u
      LEFT JOIN public.advocate_profiles ap ON ap.user_id = u.id
      WHERE ${where}
      ORDER BY u.id DESC
      LIMIT 200
    `;

    const r = await pool.query(sql, params);

    return res.json({
      advocates: r.rows.map((a) => ({
        id: a.id,
        name: a.name ?? null,
        headline: a.headline ?? null,
        practice_areas: a.practice_areas ?? [],
        experience_years: a.experience_years ?? 0,
        avatar_url: a.avatar_url ?? null,
        rating_avg: a.rating_avg ?? null,
        rating_count: a.rating_count ?? 0,
      })),
    });
  } catch (e) {
    console.error("getPublicAdvocates error:", e);
    return res.status(500).json({ error: e?.message || "Server error" });
  }
}
