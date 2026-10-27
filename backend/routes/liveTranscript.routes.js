import express from "express";
import { authMiddleware } from "../middleware/authMiddleware.js";
import { ownerList, ownerRead } from "../services/liveTranscript.service.js";

const router = express.Router({ mergeParams: true });
router.use((req, res, next) => { res.set("Cache-Control", "no-store"); next(); }, authMiddleware);
function decimal(value, fallback, max) {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || !/^(0|[1-9]\d*)$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) > max) throw Object.assign(new Error("INVALID_TRANSCRIPT"), { status: 422, code: "INVALID_TRANSCRIPT" });
  return Number(value);
}
const read = action => async (req, res) => {
  try { res.json(await action(req, decimal(req.params.caseId, 0, Number.MAX_SAFE_INTEGER))); }
  catch (error) {
    const known = ["INVALID_TRANSCRIPT", "TRANSCRIPT_NOT_FOUND", "CLIENT_REQUIRED", "TRANSCRIPT_UNAVAILABLE"].includes(error.code);
    res.status(known ? error.status : 503).json({ error: "Transcript request could not be completed", code: known ? error.code : "TRANSCRIPT_UNAVAILABLE" });
  }
};
// Mount at intake-v2; these are deliberately the only browser operations.
router.get("/transcripts", read((req, caseId) => ownerList(req.user, caseId, {
  limit: decimal(req.query.limit, 10, 20), before: req.query.before === undefined ? null : req.query.before,
})));
router.get("/transcripts/:sessionId", read((req, caseId) => ownerRead(req.user, caseId, req.params.sessionId, {
  afterSequence: decimal(req.query.afterSequence, 0, 256),
})));
export default router;
