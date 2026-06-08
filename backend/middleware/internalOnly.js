export function internalOnly(req, res, next) {
  const incoming = req.headers["x-internal-key"];
  const expected = process.env.INTERNAL_API_KEY;

  if (!expected || incoming !== expected) {
    return res.status(403).json({ error: "Forbidden" });
  }

  next();
}
