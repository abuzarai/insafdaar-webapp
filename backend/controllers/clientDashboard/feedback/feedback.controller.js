import pool from "../../../db.js";

function parseCaseId(input) {
  if (!input) return null;

  // supports: 123, "123", "CASE-123"
  const s = String(input).trim().toUpperCase();
  if (!s) return null;

  if (s.startsWith("CASE-")) {
    const n = Number(s.replace("CASE-", ""));
    return Number.isFinite(n) ? n : null;
  }

  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function normalizeAudience(aud) {
  const a = String(aud || "").trim();
  if (!a) return "WEBSITE_APP";

  // frontend sends: "Website/App" | "Admin Team" | "Advocate"
  if (a === "Website/App") return "WEBSITE_APP";
  if (a === "Admin Team") return "ADMIN_TEAM";
  if (a === "Advocate") return "ADVOCATE";

  // allow direct values too:
  if (a === "WEBSITE_APP" || a === "ADMIN_TEAM" || a === "ADVOCATE") return a;

  return "WEBSITE_APP";
}

function safeSentiment(s) {
  const v = String(s || "Positive");
  if (v === "Positive" || v === "Neutral" || v === "Negative") return v;
  return "Positive";
}

/**
 * POST /api/client/dashboard/feedback
 * body:
 *  {
 *    audience, caseId?, category?, sentiment?, message,
 *    contactPref?, contactValue?,
 *    advocateUserId? (required if audience=Advocate),
 *    ratings: {}   (website/admin/advocate rating fields)
 *  }
 */
export async function createFeedback(req, res) {
  try {
    const userId = req.user.id;

    const {
      audience,
      caseId,
      category = "General",
      sentiment = "Positive",
      message,
      contactPref = "No need",
      contactValue = null,
      advocateUserId = null,
      ratings = {},
    } = req.body || {};

    if (!message || !String(message).trim()) {
      return res.status(400).json({ error: "message is required" });
    }

    const aud = normalizeAudience(audience);
    const cid = parseCaseId(caseId);

    // If caseId provided, verify ownership
    if (cid) {
      const own = await pool.query(
        `SELECT id FROM public.client_cases WHERE id=$1 AND user_id=$2`,
        [cid, userId]
      );
      if (own.rows.length === 0) {
        return res.status(404).json({ error: "Case not found for this user" });
      }
    }

    let advId = null;
    if (aud === "ADVOCATE") {
      if (!advocateUserId) {
        return res.status(400).json({ error: "advocateUserId is required for advocate feedback" });
      }

      // verify advocate exists (basic check)
      const adv = await pool.query(`SELECT id FROM public.users WHERE id=$1`, [Number(advocateUserId)]);
      if (adv.rows.length === 0) return res.status(404).json({ error: "Advocate not found" });
      advId = Number(advocateUserId);
    }

    // store ratings as jsonb (flexible)
    const r = await pool.query(
      `
      INSERT INTO public.client_feedback
        (user_id, case_id, audience, advocate_user_id, category, sentiment, ratings, message, contact_pref, contact_value)
      VALUES
        ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      RETURNING *
      `,
      [
        userId,
        cid,
        aud,
        advId,
        String(category),
        safeSentiment(sentiment),
        JSON.stringify(ratings || {}),
        String(message).trim(),
        String(contactPref),
        contactValue ? String(contactValue).trim() : null,
      ]
    );

    return res.json({ message: "Feedback saved", feedback: r.rows[0] });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

/**
 * GET /api/client/dashboard/feedback/mine
 */
export async function getMyFeedback(req, res) {
  try {
    const userId = req.user.id;

    const r = await pool.query(
      `
      SELECT
        f.id,
        f.audience,
        f.category,
        f.sentiment,
        f.case_id,
        f.advocate_user_id,
        f.ratings,
        f.message,
        f.status,
        f.created_at
      FROM public.client_feedback f
      WHERE f.user_id = $1
      ORDER BY f.created_at DESC
      `,
      [userId]
    );

    return res.json({ feedback: r.rows });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

/**
 * GET /api/client/dashboard/feedback/advocate/:advocateUserId/summary
 * Returns avg rating numbers so you can show on advocate cards later
 */
export async function getAdvocateFeedbackSummary(req, res) {
  try {
    const advocateUserId = Number(req.params.advocateUserId);

    const r = await pool.query(
      `
      SELECT ratings
      FROM public.client_feedback
      WHERE audience='ADVOCATE' AND advocate_user_id=$1
      `,
      [advocateUserId]
    );

    if (r.rows.length === 0) {
      return res.json({
        advocateUserId,
        count: 0,
        averages: {
          knowledge: 0,
          responsiveness: 0,
          availability: 0,
          caseHandling: 0,
          overall: 0,
        },
      });
    }

    // compute averages safely from JSON ratings
    let sumK = 0,
      sumR = 0,
      sumA = 0,
      sumC = 0,
      count = 0;

    for (const row of r.rows) {
      const rt = row.ratings || {};
      const k = Number(rt.advocateKnowledge || 0);
      const c = Number(rt.advocateCaseHandling || 0);
      const rr = Number(rt.advocateResponsiveness || 0);
      const av = Number(rt.advocateAvailability || 0);

      // count if any rating exists
      if (k || c || rr || av) {
        sumK += k;
        sumC += c;
        sumR += rr;
        sumA += av;
        count += 1;
      }
    }

    const avg = (x) => (count ? Math.round((x / count) * 10) / 10 : 0);
    const knowledge = avg(sumK);
    const responsiveness = avg(sumR);
    const availability = avg(sumA);
    const caseHandling = avg(sumC);

    const overall = count
      ? Math.round(((knowledge + responsiveness + availability + caseHandling) / 4) * 10) / 10
      : 0;

    return res.json({
      advocateUserId,
      count,
      averages: { knowledge, responsiveness, availability, caseHandling, overall },
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
