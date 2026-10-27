import { reserveAdmission } from "../services/interviewAdmission.service.js";
import express from "express";
import pool from "../db.js";
import { authMiddleware } from "../middleware/authMiddleware.js";
import { liveIntakeClient } from "../services/liveIntakeClient.js";
import { withCase, replay, receipt, digest, intakeError, editable, saveProposal, editRevision,
  confirmRevision, submitIntake, getReview } from "../services/reviewedIntake.service.js";

import { liveTranscriptCollector, TRANSCRIPT_NOTICE_VERSION } from "../services/liveTranscriptCollector.js";

const router = express.Router({ mergeParams: true });
router.use(authMiddleware, (req, res, next) => {
  res.set("Cache-Control", "no-store");
  if (String(req.user?.role).toLowerCase() !== "client") return res.status(403).json({ error: "Client required", code: "CLIENT_REQUIRED" });
  const caseId = Number(req.params.caseId);
  if (!Number.isSafeInteger(caseId) || caseId <= 0) return res.status(400).json({ error: "Invalid case", code: "INVALID_CASE" });
  req.intakeCaseId = caseId;
  next();
});
const wrap = action => async (req, res) => {
  try { res.json(await action(req)); }
  catch (error) { if (error.retryAt) res.set("Retry-After", String(Math.max(0, Math.ceil((Date.parse(error.retryAt)-Date.now())/1000)))); res.status(error.status || 500).json({ ...(error.retryAt ? { retryAt: error.retryAt } : {}), error: "Intake request could not be completed", code: error.code && error.status ? error.code : "INTAKE_REQUEST_FAILED" }); }
};
function enabled() {
  if (process.env.INTAKE_V2_ENABLED !== "true") throw intakeError(404, "INTAKE_UNAVAILABLE");
}
function body(req, keys) {
  enabled();
  const value = req.body;
  if (!value || Array.isArray(value) || Object.keys(value).sort().join() !== [...keys].sort().join()) throw intakeError(422, "INVALID_INTAKE_REQUEST");
  if (!Number.isSafeInteger(value.expectedVersion) || value.expectedVersion < 0) throw intakeError(422, "INVALID_CASE_VERSION");
  for (const name of ["revisionId", "confirmationId"]) if (name in value && (typeof value[name] !== "string" || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value[name]))) throw intakeError(422, "INVALID_REVISION_ID");
  if ("sessionId" in value && (typeof value.sessionId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(value.sessionId))) throw intakeError(422, "INVALID_SESSION_ID");
  return value;
}
router.get("/review", wrap(async req => ({ ...(await getReview(req.user, req.intakeCaseId)), enabled: process.env.INTAKE_V2_ENABLED === "true" })));
router.post("/sessions", wrap(async req => {
  const notice = Object.prototype.hasOwnProperty.call(req.body || {}, "transcriptNoticeVersion");
  const request = body(req, ["expectedVersion", "processingConsent", ...(notice ? ["transcriptNoticeVersion"] : []), ...(Object.hasOwn(req.body || {}, "newInterview") ? ["newInterview"] : [])]);
  if ("newInterview" in request && request.newInterview !== true) throw intakeError(422, "INVALID_INTAKE_REQUEST");
  if (notice && request.transcriptNoticeVersion !== TRANSCRIPT_NOTICE_VERSION) throw intakeError(422, "INVALID_TRANSCRIPT_NOTICE");
  if (request.processingConsent !== true) throw intakeError(422, "PROCESSING_CONSENT_REQUIRED");
  const key = req.get("Idempotency-Key"), actor = req.user, caseId = req.intakeCaseId;
  const reservation = await withCase(actor, caseId, async (db, c) => {
    const prior = await replay(db, actor, c, "admit", key, request);
    if (prior) return { prior };
    if (!["DRAFT", "INTAKE_STARTED"].includes(c.status) || c.submitted_intake_revision_id || c.assigned_advocate_id ||
        (c.intake_protocol !== "live_v2" && (c.status !== "DRAFT" || c.interview_completed))) throw intakeError(409, "INTAKE_NOT_EDITABLE");
    if (Number(c.intake_version) !== request.expectedVersion) throw intakeError(409, "STALE_CASE_VERSION");
    if (c.intake_protocol !== "live_v2") {
      const history = await db.query(`SELECT 1 FROM public.case_intake_sessions WHERE case_id=$1
        UNION ALL SELECT 1 FROM public.case_voice_notes WHERE case_id=$1 LIMIT 1`, [c.id]);
      if (history.rows.length) throw intakeError(409, "LEGACY_INTAKE_HISTORY");
    }
    try { await reserveAdmission(db, actor, c, key, digest(request), request); }
    catch (error) {
      if (!["INTERVIEW_DAILY_LIMIT", "INTERVIEW_WEEKLY_LIMIT", "INTERVIEW_PLATFORM_LIMIT", "INTERVIEW_ALREADY_ACTIVE", "INTERVIEWS_PAUSED", "NEW_INTERVIEW_CONFIRMATION_REQUIRED"].includes(error.code)) throw error;
      const rejected = { rejected: true, status: error.status, code: error.code, ...(error.retryAt ? { retryAt: error.retryAt } : {}) };
      await receipt(db, actor, c, "admit", key, request, rejected);
      return { prior: rejected };
    }
    await db.query("UPDATE public.client_cases SET intake_protocol='live_v2', intake_version=intake_version+1, updated_at=NOW() WHERE id=$1", [c.id]);
    await receipt(db, actor, c, "admit", key, request, null);
    return { version: Number(c.intake_version) + 1 };
  });
  if (reservation.prior) {
    if (reservation.prior.rejected) throw Object.assign(intakeError(reservation.prior.status, reservation.prior.code), { retryAt: reservation.prior.retryAt });
    if (reservation.prior.failed) throw intakeError(409, "ADMISSION_OUTCOME_UNKNOWN");
    return reservation.prior;
  }
  const acknowledgedAt = new Date().toISOString();
  let admitted;
  try {
    admitted = await liveIntakeClient.admit(actor, caseId);
    const issuedAt = admitted.issuedAt || new Date().toISOString();
    const committed = await withCase(actor, caseId, async (db, c) => {
      if (Number(c.intake_version) !== reservation.version || !["DRAFT", "INTAKE_STARTED"].includes(c.status)) throw intakeError(409, "STALE_CASE_VERSION");
      await db.query(`INSERT INTO public.case_intake_live_sessions (session_id,case_id,actor_user_id,expires_at)
        VALUES ($1,$2,$3,$4)`, [admitted.sessionId, c.id, actor.id, admitted.expiresAt]);
      if (c.status === "DRAFT") {
        await db.query("UPDATE public.client_cases SET status='INTAKE_STARTED', updated_at=NOW() WHERE id=$1", [c.id]);
        await db.query(`INSERT INTO public.case_lifecycle_events (case_id,from_status,to_status,actor_user_id,actor_role,reason)
          VALUES ($1,'DRAFT','INTAKE_STARTED',$2,'CLIENT','Live session admitted')`, [c.id, actor.id]);
      }
      await db.query(`UPDATE public.interview_admissions SET outcome='accepted', session_id=$4, active_until=$5
        WHERE actor_user_id=$1 AND case_id=$2 AND intent_key=$3`, [actor.id,c.id,key,admitted.sessionId,admitted.expiresAt]);
      const result = { ...admitted, caseVersion: reservation.version, ...(notice ? { transcriptSaving: "pending",
        transcriptNotice: { actorId: actor.id, noticeVersion: TRANSCRIPT_NOTICE_VERSION, acknowledgedAt } } : {}) };
      await db.query(`UPDATE public.case_intake_receipts SET response=$5::jsonb
        WHERE case_id=$1 AND actor_user_id=$2 AND operation='admit' AND intent_key=$3 AND response IS NULL AND request_hash=$4`,
      [c.id, actor.id, key, digest(request), JSON.stringify(result)]);
      return result;
    });
    if (notice) committed.transcriptSaving = liveTranscriptCollector.start(actor, caseId, {
      sessionId: admitted.sessionId, issuedAt, originalExpiry: admitted.expiresAt,
      noticeVersion: TRANSCRIPT_NOTICE_VERSION, acknowledgedAt,
    });
    return committed;
  } catch (error) {
    if (admitted) await liveIntakeClient.stop(actor, caseId, admitted.sessionId).catch(() => {});
    if (!admitted && error.definitiveAdmissionRejection === true) {
      // Record the authoritative 4xx rejection, not a fake successful session.
      // Replaying this key must return that rejection, never call out again.
      await withCase(actor, caseId, async (db, c) => {
        await db.query(`UPDATE public.interview_admissions SET outcome='refunded', active_until=clock_timestamp()
          WHERE actor_user_id=$1 AND case_id=$2 AND intent_key=$3`, [actor.id,c.id,key]);
        await db.query(`UPDATE public.case_intake_receipts SET response=$5::jsonb
          WHERE case_id=$1 AND actor_user_id=$2 AND operation='admit' AND intent_key=$3 AND response IS NULL AND request_hash=$4`,
        [c.id, actor.id, key, digest(request), JSON.stringify({ rejected: true, status: error.status, code: error.code })]);
      }).catch(() => {});
    }
    // Network/5xx ambiguity (or failed rejection bookkeeping) remains quarantined.
    throw error;
  }
}));
async function authorizedLive(req) {
  const sessionId = req.params.sessionId;
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(sessionId)) throw intakeError(400, "INVALID_SESSION_ID");
  await withCase(req.user, req.intakeCaseId, async (db, c) => {
    editable(c, Number(c.intake_version));
    const found = await db.query(`SELECT session_id FROM public.case_intake_live_sessions
      WHERE session_id=$1 AND case_id=$2 AND actor_user_id=$3 AND expires_at>NOW()`, [sessionId, c.id, req.user.id]);
    if (!found.rows.length) throw intakeError(404, "LIVE_SESSION_NOT_FOUND");
  });
  return sessionId;
}
router.post("/sessions/:sessionId/stop", wrap(async req => {
  // Safety stop is independent of database availability and feature flag.
  const id = req.params.sessionId;
  const stopping = liveIntakeClient.stop(req.user, req.intakeCaseId, id);
  liveTranscriptCollector.end(req.user, req.intakeCaseId, id);
  const result = await stopping;
  // Expiry bookkeeping is best effort, not part of the safety-stop response.
  // query_timeout does not bound waiting for a saturated pool connection.
  if (result?.session_id === id && result.phase === "partial") {
    void pool.query({ text: "UPDATE public.interview_admissions SET active_until=LEAST(active_until,clock_timestamp()) WHERE session_id=$1 AND actor_user_id=$2 AND case_id=$3", values: [id, req.user.id, req.intakeCaseId], query_timeout: 1000 }).catch(() => {});
    void pool.query({ text: "UPDATE public.case_intake_live_sessions SET expires_at=LEAST(expires_at,NOW()) WHERE session_id=$1 AND actor_user_id=$2", values: [id, req.user.id], query_timeout: 1000 }).catch(() => {});
  }
  return result;
}));
function initialOffer(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw intakeError(422, "INVALID_LIVE_SIGNALING");
  const keys = Object.keys(value).sort().join();
  const canonical = keys === "sdp,type";
  const sdkInitial = keys === "pc_id,restart_pc,sdp,type" && value.pc_id === null && value.restart_pc === false;
  if ((!canonical && !sdkInitial) || value.type !== "offer" || typeof value.sdp !== "string" || !value.sdp.length) throw intakeError(422, "INVALID_LIVE_SIGNALING");
  // Pinned SDK's null peer / false restart describe an initial offer. They are
  // transport metadata, not commands accepted by the strict voice API.
  return { sdp: value.sdp, type: value.type };
}
for (const method of ["post", "patch"]) router[method]("/sessions/:sessionId/webrtc/offer", wrap(async req => {
  enabled(); const id = await authorizedLive(req);
  if (Buffer.byteLength(JSON.stringify(req.body || {})) > 65536) throw intakeError(413, "SIGNALING_TOO_LARGE");
  const payload = method === "post" ? initialOffer(req.body) : req.body;
  try { return await liveIntakeClient.call(req.user, req.intakeCaseId, id, "webrtc/offer", method.toUpperCase(), payload); }
  catch (error) {
    if (method === "post" && error.code !== "LIVE_OFFER_ALREADY_ATTEMPTED") {
      liveTranscriptCollector.end(req.user, req.intakeCaseId, id);
    }
    throw error;
  }
}));
router.post("/sessions/:sessionId/prepare", wrap(async req => {
  enabled(); const id = await authorizedLive(req);
  if (req.body?.acknowledge_unproven_tail !== true || Object.keys(req.body).length !== 1) throw intakeError(422, "TAIL_ACKNOWLEDGMENT_REQUIRED");
  const preparing = liveIntakeClient.call(req.user, req.intakeCaseId, id, "audio-draft", "POST", { acknowledge_unproven_tail: true });
  liveTranscriptCollector.end(req.user, req.intakeCaseId, id);
  return preparing;
}));
router.post("/revisions", wrap(async req => {
  const request = body(req, ["expectedVersion", "sessionId"]);
  return saveProposal(req.user, req.intakeCaseId, req.get("Idempotency-Key"), request,
    id => liveIntakeClient.call(req.user, req.intakeCaseId, id, "audio-draft"));
}));
router.post("/edits", wrap(req => editRevision(req.user, req.intakeCaseId, req.get("Idempotency-Key"), body(req, ["expectedVersion", "revisionId", "reviewedData"]))));
router.post("/confirmations", wrap(req => confirmRevision(req.user, req.intakeCaseId, req.get("Idempotency-Key"), body(req, ["expectedVersion", "revisionId", "acknowledgeReview", "acknowledgmentVersion"]))));
router.post("/submissions", wrap(req => submitIntake(req.user, req.intakeCaseId, req.get("Idempotency-Key"), body(req, ["expectedVersion", "revisionId", "confirmationId"]))));
export default router;
