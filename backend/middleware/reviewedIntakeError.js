// Parser and other pre-route errors must not expose interview request content.
export function reviewedIntakeError(error, req, res, next) {
  if (!/^\/api\/client\/dashboard\/start-case\/[^/]+\/intake-v2(?:\/|$)/.test(req.path)) return next(error);
  const candidate = error?.statusCode || error?.status;
  const status = Number.isInteger(candidate) && candidate >= 400 && candidate <= 599 ? candidate : 500;
  res.locals.errorMessage = "INTAKE_REQUEST_FAILED";
  res.set("Cache-Control", "no-store");
  return res.status(status).json({ error: "Intake request could not be completed", code: "INTAKE_REQUEST_FAILED" });
}
