import pool from "../../../../db.js";


/**
 * Guard: ensure client exists
 */
async function ensureClient(id) {
  const r = await pool.query(
    `SELECT id FROM public.users WHERE id=$1 AND UPPER(role)='CLIENT'`,
    [id]
  );
  return r.rowCount > 0;
}

/**
 * table existence cache (60s)
 */
const tableExistCache = new Map(); // name -> { exists, ts }
async function tableExists(qualifiedName) {
  const cached = tableExistCache.get(qualifiedName);
  const now = Date.now();
  if (cached && now - cached.ts < 60_000) return cached.exists;

  const r = await pool.query(`SELECT to_regclass($1) as t`, [qualifiedName]);
  const exists = Boolean(r.rows?.[0]?.t);
  tableExistCache.set(qualifiedName, { exists, ts: now });
  return exists;
}

function parseLimitOffset(req, defaults = { limit: 25, offset: 0, max: 200 }) {
  const limit = Math.min(
    defaults.max,
    Math.max(1, Number(req.query.limit) || defaults.limit)
  );
  const offset = Math.max(0, Number(req.query.offset) || defaults.offset);
  return { limit, offset };
}

/**
 * GET /api/admin/clients/:id/dashboard/summary
 * Uses confirmed table: public.client_cases (NOT public.cases)
 */
export async function adminClientDashboardSummary(req, res) {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ error: "Invalid id" });
    }

    const ok = await ensureClient(id);
    if (!ok) return res.status(404).json({ error: "Client not found" });

    // Check table existence (cached)
    const [hasNotifications, hasBilling, hasFeedback, hasCases] = await Promise.all([
      tableExists("public.client_notifications"),
      tableExists("public.client_billing"),
      tableExists("public.client_feedback"),
      tableExists("public.client_cases"),
    ]);

    const queries = [];

    // notifications total + unread
    queries.push(
      hasNotifications
        ? pool.query(
            `SELECT COUNT(*)::int AS total FROM public.client_notifications WHERE user_id=$1`,
            [id]
          )
        : Promise.resolve({ rows: [{ total: 0 }] })
    );

    queries.push(
      hasNotifications
        ? pool.query(
            `SELECT COUNT(*)::int AS total FROM public.client_notifications WHERE user_id=$1 AND is_read=false`,
            [id]
          )
        : Promise.resolve({ rows: [{ total: 0 }] })
    );

    // billing count
    queries.push(
      hasBilling
        ? pool.query(
            `SELECT COUNT(*)::int AS total FROM public.client_billing WHERE user_id=$1`,
            [id]
          )
        : Promise.resolve({ rows: [{ total: 0 }] })
    );

    // feedback count
    queries.push(
      hasFeedback
        ? pool.query(
            `SELECT COUNT(*)::int AS total FROM public.client_feedback WHERE user_id=$1`,
            [id]
          )
        : Promise.resolve({ rows: [{ total: 0 }] })
    );

    // cases count (confirmed table)
    queries.push(
      hasCases
        ? pool.query(
            `SELECT COUNT(*)::int AS total FROM public.client_cases WHERE client_id=$1`,
            [id]
          )
        : Promise.resolve({ rows: [{ total: 0 }] })
    );

    const [notifTotalR, notifUnreadR, billingR, feedbackR, casesR] =
      await Promise.all(queries);

    const notificationsCount = Number(notifTotalR.rows?.[0]?.total || 0);
    const unreadNotifications = Number(notifUnreadR.rows?.[0]?.total || 0);
    const billingItems = Number(billingR.rows?.[0]?.total || 0);
    const feedbackItems = Number(feedbackR.rows?.[0]?.total || 0);
    const casesCount = Number(casesR.rows?.[0]?.total || 0);

    return res.json({
      ok: true,
      summary: {
        clientId: id,
        cases: casesCount,
        notifications: notificationsCount,
        unreadNotifications,
        billingItems,
        feedback: feedbackItems,
      },
    });
  } catch (e) {
    console.error("adminClientDashboardSummary error:", e);
    return res.status(500).json({ error: "Internal server error" });
  }
}

/**
 * GET /api/admin/clients/:id/dashboard/cases?limit=25&offset=0
 * Uses confirmed table: public.client_cases
 */
export async function adminClientMyCases(req, res) {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ error: "Invalid id" });
    }

    const ok = await ensureClient(id);
    if (!ok) return res.status(404).json({ error: "Client not found" });

    const { limit, offset } = parseLimitOffset(req);

    const hasCases = await tableExists("public.client_cases");
    if (!hasCases) return res.json({ cases: [], limit, offset });

    const r = await pool.query(
      `
      SELECT *
      FROM public.client_cases
      WHERE client_id=$1
      ORDER BY created_at DESC
      LIMIT $2 OFFSET $3
      `,
      [id, limit, offset]
    );

    return res.json({ cases: r.rows, limit, offset });
  } catch (e) {
    console.error("adminClientMyCases error:", e);
    return res.status(500).json({ error: "Internal server error" });
  }
}

/**
 * GET /api/admin/clients/:id/dashboard/notifications?limit=25&offset=0
 */
export async function adminClientNotifications(req, res) {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ error: "Invalid id" });
    }

    const ok = await ensureClient(id);
    if (!ok) return res.status(404).json({ error: "Client not found" });

    const { limit, offset } = parseLimitOffset(req);

    const hasNotifications = await tableExists("public.client_notifications");
    if (!hasNotifications) return res.json({ notifications: [], limit, offset });

    const r = await pool.query(
      `
      SELECT
        id, user_id, case_id, title, description, type, priority, is_read, created_at
      FROM public.client_notifications
      WHERE user_id=$1
      ORDER BY created_at DESC
      LIMIT $2 OFFSET $3
      `,
      [id, limit, offset]
    );

    return res.json({ notifications: r.rows, limit, offset });
  } catch (e) {
    console.error("adminClientNotifications error:", e);
    return res.status(500).json({ error: "Internal server error" });
  }
}

/**
 * GET /api/admin/clients/:id/dashboard/feedback?limit=25&offset=0
 */
export async function adminClientFeedback(req, res) {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ error: "Invalid id" });
    }

    const ok = await ensureClient(id);
    if (!ok) return res.status(404).json({ error: "Client not found" });

    const { limit, offset } = parseLimitOffset(req);

    const hasFeedback = await tableExists("public.client_feedback");
    if (!hasFeedback) return res.json({ feedback: [], limit, offset });

    const r = await pool.query(
      `
      SELECT *
      FROM public.client_feedback
      WHERE user_id=$1
      ORDER BY created_at DESC
      LIMIT $2 OFFSET $3
      `,
      [id, limit, offset]
    );

    return res.json({ feedback: r.rows, limit, offset });
  } catch (e) {
    console.error("adminClientFeedback error:", e);
    return res.status(500).json({ error: "Internal server error" });
  }
}

/**
 * GET /api/admin/clients/:id/dashboard/billing?limit=25&offset=0
 * Fixed invalid SQL "public then.client_billing" -> "public.client_billing"
 */
export async function adminClientBilling(req, res) {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ error: "Invalid id" });
    }

    const ok = await ensureClient(id);
    if (!ok) return res.status(404).json({ error: "Client not found" });

    const { limit, offset } = parseLimitOffset(req);

    const hasBilling = await tableExists("public.client_billing");
    if (!hasBilling) return res.json({ billing: [], limit, offset });

    const r = await pool.query(
      `
      SELECT *
      FROM public.client_billing
      WHERE user_id=$1
      ORDER BY created_at DESC
      LIMIT $2 OFFSET $3
      `,
      [id, limit, offset]
    );

    return res.json({ billing: r.rows, limit, offset });
  } catch (e) {
    console.error("adminClientBilling error:", e);
    return res.status(500).json({ error: "Internal server error" });
  }
}
