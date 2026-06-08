import pool from "../../../db.js";
import os from "os";

/**
 * Helper: translate Postgres "relation does not exist" into a friendly API error.
 */
function handleMissingTable(e, res, tableName) {
  const msg = String(e?.message || "");
  // Postgres: 42P01 = undefined_table
  if (e?.code === "42P01" || msg.toLowerCase().includes("does not exist")) {
    return res.status(500).json({
      error: `Performance logs table missing. Create "${tableName}" schema first.`,
      hint: `Create table "${tableName}" (e.g., api_logs) and start writing request logs. Then retry.`,
      pg: { code: e?.code, message: msg },
    });
  }
  return null;
}

function resolveRangeSql(range) {
  if (range === "7d") return "NOW() - INTERVAL '7 days'";
  if (range === "30d") return "NOW() - INTERVAL '30 days'";
  return "NOW() - INTERVAL '24 hours'";
}

/**
 * GET /api/admin/performance/overview?range=24h|7d|30d
 * Returns KPI summary for admin dashboard performance tab.
 */
export async function getPerformanceOverview(req, res) {
  const range = String(req.query.range || "24h").trim();

  // Supported ranges
  const rangeSql = resolveRangeSql(range);

  try {
    // KPIs from api_logs
    const overviewSql = `
      SELECT
        COUNT(*)::int AS total_requests,
        COALESCE(ROUND(AVG(duration_ms))::int, 0) AS avg_latency_ms,
        COALESCE(
          ROUND(
            100.0 * SUM(CASE WHEN status >= 500 THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0),
            2
          ),
          0
        ) AS error_rate_5xx,
        COALESCE(COUNT(DISTINCT user_id)::int, 0) AS unique_users
      FROM api_logs
      WHERE created_at >= ${rangeSql};
    `;

    // New users (7d) - from users table
    const newUsersSql = `
      SELECT
        SUM(CASE WHEN LOWER(role)='client' THEN 1 ELSE 0 END)::int AS new_clients_7d,
        SUM(CASE WHEN LOWER(role)='advocate' THEN 1 ELSE 0 END)::int AS new_advocates_7d,
        SUM(CASE WHEN LOWER(role)='admin' THEN 1 ELSE 0 END)::int AS new_admins_7d
      FROM users
      WHERE created_at >= NOW() - INTERVAL '7 days';
    `;

    const [a, b] = await Promise.all([pool.query(overviewSql), pool.query(newUsersSql)]);

    return res.json({
      range,
      overview: a.rows[0] || {
        total_requests: 0,
        avg_latency_ms: 0,
        error_rate_5xx: 0,
        unique_users: 0,
      },
      newUsers: b.rows[0] || { new_clients_7d: 0, new_advocates_7d: 0, new_admins_7d: 0 },
    });
  } catch (e) {
    const handled = handleMissingTable(e, res, "api_logs");
    if (handled) return handled;

    console.error("getPerformanceOverview error:", e);
    return res.status(500).json({ error: "Failed to load performance overview" });
  }
}

/**
 * GET /api/admin/performance/timeseries?range=24h|7d|30d
 * Hourly buckets for last 24h; daily buckets for 7d/30d (auto).
 */
export async function getPerformanceTimeseries(req, res) {
  const range = String(req.query.range || "24h").trim();

  // Bucket logic
  const isHourly = range === "24h";
  const bucket = isHourly ? "hour" : "day";

  const rangeSql = resolveRangeSql(range);

  try {
    const sql = `
      SELECT
        date_trunc('${bucket}', created_at) AS t,
        COUNT(*)::int AS requests,
        COALESCE(ROUND(AVG(duration_ms))::int, 0) AS avg_latency_ms,
        SUM(CASE WHEN status >= 500 THEN 1 ELSE 0 END)::int AS errors_5xx,
        SUM(CASE WHEN status >= 400 AND status < 500 THEN 1 ELSE 0 END)::int AS errors_4xx
      FROM api_logs
      WHERE created_at >= ${rangeSql}
      GROUP BY 1
      ORDER BY 1;
    `;

    const r = await pool.query(sql);
    return res.json({
      range,
      bucket,
      points: (r.rows || []).map((x) => ({
        t: x.t, // timestamp
        requests: x.requests,
        avg_latency_ms: x.avg_latency_ms,
        errors_5xx: x.errors_5xx,
        errors_4xx: x.errors_4xx,
      })),
    });
  } catch (e) {
    const handled = handleMissingTable(e, res, "api_logs");
    if (handled) return handled;

    console.error("getPerformanceTimeseries error:", e);
    return res.status(500).json({ error: "Failed to load performance timeseries" });
  }
}

/**
 * GET /api/admin/performance/errors?range=24h|7d|30d&limit=50&minStatus=500
 * Returns recent error rows.
 */
export async function getPerformanceErrors(req, res) {
  const range = String(req.query.range || "24h").trim();
  const limit = Math.min(Math.max(Number(req.query.limit || 30), 1), 200);
  const minStatus = Math.min(Math.max(Number(req.query.minStatus || 500), 400), 599);

  const rangeSql = resolveRangeSql(range);

  try {
    const sql = `
      SELECT
        created_at,
        route,
        method,
        status,
        duration_ms,
        error_message,
        user_id,
        role,
        ip
      FROM api_logs
      WHERE created_at >= ${rangeSql}
        AND status >= $1
      ORDER BY created_at DESC
      LIMIT $2;
    `;

    const r = await pool.query(sql, [minStatus, limit]);
    return res.json({
      range,
      minStatus,
      limit,
      errors: r.rows || [],
    });
  } catch (e) {
    const handled = handleMissingTable(e, res, "api_logs");
    if (handled) return handled;

    console.error("getPerformanceErrors error:", e);
    return res.status(500).json({ error: "Failed to load performance errors" });
  }
}

/**
 * GET /api/admin/performance/slow?range=24h|7d|30d&limit=10&minCount=5
 * Returns slowest endpoints by p95 latency.
 */
export async function getPerformanceSlowEndpoints(req, res) {
  const range = String(req.query.range || "24h").trim();
  const limit = Math.min(Math.max(Number(req.query.limit || 10), 1), 100);
  const minCount = Math.min(Math.max(Number(req.query.minCount || 5), 1), 500);

  const rangeSql = resolveRangeSql(range);

  try {
    const sql = `
      SELECT
        route,
        COUNT(*)::int AS count,
        COALESCE(ROUND(AVG(duration_ms))::int, 0) AS avg_latency_ms,
        COALESCE(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_ms), 0) AS p95_latency_ms
      FROM api_logs
      WHERE created_at >= ${rangeSql}
      GROUP BY route
      HAVING COUNT(*) >= $1
      ORDER BY p95_latency_ms DESC
      LIMIT $2;
    `;

    const r = await pool.query(sql, [minCount, limit]);
    return res.json({
      range,
      minCount,
      limit,
      slow: r.rows || [],
    });
  } catch (e) {
    const handled = handleMissingTable(e, res, "api_logs");
    if (handled) return handled;

    console.error("getPerformanceSlowEndpoints error:", e);
    return res.status(500).json({ error: "Failed to load slow endpoints" });
  }
}

/**
 * GET /api/admin/performance/system
 * Runtime/system snapshot from current backend process.
 */
export async function getPerformanceSystem(req, res) {
  try {
    const mem = process.memoryUsage();
    const cpus = os.cpus() || [];

    return res.json({
      timestamp: new Date().toISOString(),
      uptimeSec: Math.round(process.uptime()),
      nodeVersion: process.version,
      pid: process.pid,
      platform: process.platform,
      arch: process.arch,
      cpuCores: cpus.length,
      loadAvg: os.loadavg(),
      memory: {
        rssMb: Math.round((mem.rss / (1024 * 1024)) * 10) / 10,
        heapUsedMb: Math.round((mem.heapUsed / (1024 * 1024)) * 10) / 10,
        heapTotalMb: Math.round((mem.heapTotal / (1024 * 1024)) * 10) / 10,
        externalMb: Math.round((mem.external / (1024 * 1024)) * 10) / 10,
      },
      hostMemory: {
        totalMb: Math.round((os.totalmem() / (1024 * 1024)) * 10) / 10,
        freeMb: Math.round((os.freemem() / (1024 * 1024)) * 10) / 10,
      },
    });
  } catch (e) {
    console.error("getPerformanceSystem error:", e);
    return res.status(500).json({ error: "Failed to load system snapshot" });
  }
}

/**
 * GET /api/admin/performance/endpoints?range=24h|7d|30d&limit=100
 * Endpoint inventory with traffic + latency + error rate.
 */
export async function getPerformanceEndpoints(req, res) {
  const range = String(req.query.range || "24h").trim();
  const limit = Math.min(Math.max(Number(req.query.limit || 100), 1), 500);
  const rangeSql = resolveRangeSql(range);

  try {
    const sql = `
      SELECT
        method,
        route,
        COUNT(*)::int AS total_requests,
        COALESCE(ROUND(AVG(duration_ms))::int, 0) AS avg_latency_ms,
        COALESCE(ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_ms))::int, 0) AS p95_latency_ms,
        COALESCE(
          ROUND(100.0 * SUM(CASE WHEN status >= 500 THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0), 2),
          0
        ) AS error_rate_5xx,
        MAX(created_at) AS last_seen_at
      FROM api_logs
      WHERE created_at >= ${rangeSql}
      GROUP BY method, route
      ORDER BY total_requests DESC, p95_latency_ms DESC
      LIMIT $1
    `;

    const r = await pool.query(sql, [limit]);
    return res.json({
      range,
      limit,
      endpoints: r.rows || [],
    });
  } catch (e) {
    const handled = handleMissingTable(e, res, "api_logs");
    if (handled) return handled;

    console.error("getPerformanceEndpoints error:", e);
    return res.status(500).json({ error: "Failed to load endpoints inventory" });
  }
}

/**
 * GET /api/admin/performance/status-codes?range=24h|7d|30d
 * HTTP status distribution summary.
 */
export async function getPerformanceStatusCodes(req, res) {
  const range = String(req.query.range || "24h").trim();
  const rangeSql = resolveRangeSql(range);

  try {
    const classSql = `
      SELECT
        CASE
          WHEN status >= 200 AND status < 300 THEN '2xx'
          WHEN status >= 300 AND status < 400 THEN '3xx'
          WHEN status >= 400 AND status < 500 THEN '4xx'
          WHEN status >= 500 THEN '5xx'
          ELSE 'other'
        END AS status_class,
        COUNT(*)::int AS count
      FROM api_logs
      WHERE created_at >= ${rangeSql}
      GROUP BY 1
      ORDER BY 1
    `;

    const topCodesSql = `
      SELECT status, COUNT(*)::int AS count
      FROM api_logs
      WHERE created_at >= ${rangeSql}
      GROUP BY status
      ORDER BY count DESC, status DESC
      LIMIT 10
    `;

    const [a, b] = await Promise.all([pool.query(classSql), pool.query(topCodesSql)]);

    return res.json({
      range,
      classes: a.rows || [],
      topCodes: b.rows || [],
    });
  } catch (e) {
    const handled = handleMissingTable(e, res, "api_logs");
    if (handled) return handled;

    console.error("getPerformanceStatusCodes error:", e);
    return res.status(500).json({ error: "Failed to load status code distribution" });
  }
}

/**
 * GET /api/admin/performance/traffic?range=24h|7d|30d&limit=10
 * Top endpoints by request volume.
 */
export async function getPerformanceTraffic(req, res) {
  const range = String(req.query.range || "24h").trim();
  const limit = Math.min(Math.max(Number(req.query.limit || 10), 1), 100);
  const rangeSql = resolveRangeSql(range);

  try {
    const sql = `
      SELECT
        method,
        route,
        COUNT(*)::int AS requests,
        COALESCE(ROUND(AVG(duration_ms))::int, 0) AS avg_latency_ms,
        MAX(created_at) AS last_seen_at
      FROM api_logs
      WHERE created_at >= ${rangeSql}
      GROUP BY method, route
      ORDER BY requests DESC, avg_latency_ms DESC
      LIMIT $1
    `;

    const r = await pool.query(sql, [limit]);
    return res.json({
      range,
      limit,
      traffic: r.rows || [],
    });
  } catch (e) {
    const handled = handleMissingTable(e, res, "api_logs");
    if (handled) return handled;

    console.error("getPerformanceTraffic error:", e);
    return res.status(500).json({ error: "Failed to load traffic endpoints" });
  }
}
