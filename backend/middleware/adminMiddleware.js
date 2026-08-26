export function adminOnly(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const role = String(req.user.role || "").toUpperCase();
  if (role !== "ADMIN") {
    return res.status(403).json({ error: "Admin access only" });
  }

  next();
}
