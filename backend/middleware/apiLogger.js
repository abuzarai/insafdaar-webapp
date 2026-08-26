import pool from "../db.js";

// These can be noisy (health checks, assets, etc.) – adjust as you want.
const DEFAULT_SKIP_PREFIXES = ["/uploads", "/static", "/favicon.ico"];

function shouldSkip(req) {
  const url = req.originalUrl || req.url || "";
  return DEFAULT_SKIP_PREFIXES.some((p) => url.startsWith(p));
}

/**
 * Best effort: figure out a stable "route" string.
 * Prefer req.baseUrl + req.route.path if available.
 * Fallback to req.originalUrl without query string.
 */
function getRouteName(req) {
  const base = req.baseUrl || "";
  const routePath = req.route?.path || "";
  if (base && routePath) return `${base}${routePath}`;

  const raw = req.originalUrl || req.url || "";
  return raw.split("?")[0] || "/";
}

/**
 * Logs requests after response finishes.
 * Requires authMiddleware earlier if you want user_id/role in logs.
 */
export function apiLogger(options = {}) {
  const skip = options.skip || shouldSkip;

  return (req, res, next) => {
    if (skip(req)) return next();

    const start = Date.now();

    res.on("finish", async () => {
      try {
        const duration = Date.now() - start;
        const method = (req.method || "GET").toUpperCase();
        const route = getRouteName(req);
        const status = Number(res.statusCode || 0);

        const userId = req.user?.id ?? null;
        const role = req.user?.role ?? null;

        const ip =
          req.headers["x-forwarded-for"]?.toString().split(",")[0]?.trim() ||
          req.socket?.remoteAddress ||
          null;

        const ua = req.headers["user-agent"] || null;

        // if your error handler sets res.locals.errorMessage, we store it.
        const errorMessage = res.locals?.errorMessage ?? null;

        await pool.query(
          `
          INSERT INTO api_logs
            (method, route, status, duration_ms, user_id, role, ip, user_agent, error_message)
          VALUES
            ($1,$2,$3,$4,$5,$6,$7,$8,$9)
        `,
          [method, route, status, duration, userId, role, ip, ua, errorMessage]
        );
      } catch (e) {
        // Never crash app because logger failed
        // console.error("apiLogger insert failed:", e);
      }
    });

    next();
  };
}
