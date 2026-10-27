import { allowance, assertCaseInactive } from "./interviewAdmission.service.js";
import { createHash, randomUUID } from "crypto";
import pool from "../db.js";
import { transitionCaseStatus } from "../utils/caseLifecycle.js";

export const ACKNOWLEDGMENT = "review-v1";
export const FACT_FIELDS = ["alias_name", "issue_category", "issue_description", "timeline", "parties", "location", "financial_impact", "previous_action", "urgency", "documentation", "desired_outcome"];
const LANGUAGES = ["urdu", "english", "mixed"];
const DOMAINS = ["family_law", "property_law", "criminal_law", "civil_law", "labor_law", "corporate_law", "other"];
export function intakeError(status, code) {
  return Object.assign(new Error(code), { status, code });
}
export function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  }
  return value;
}
export function digest(value) {
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}
function text(value, max) {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw intakeError(422, "INVALID_INTAKE");
  return value.trim();
}
function reviewedText(value, max, nullable = false) {
  if (nullable && value === null) return null;
  if (typeof value !== "string" || !value.trim() || Array.from(value).length > max) throw intakeError(422, "INVALID_INTAKE");
  return value.trim();
}
function object(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw intakeError(422, "INVALID_INTAKE");
  return value;
}
export function validateReviewed(value, submitting = false) {
  object(value);
  if (Object.keys(value).sort().join() !== ["issue_summary", "primary_language", "legal_domain", "key_entities", "facts"].sort().join()) throw intakeError(422, "INVALID_INTAKE");
  const issue_summary = reviewedText(value.issue_summary, 4096);
  if (submitting && /^(draft created.*|untitled case|case)$/i.test(issue_summary)) throw intakeError(422, "SUMMARY_REQUIRED");
  if (!LANGUAGES.includes(value.primary_language) || !DOMAINS.includes(value.legal_domain)) throw intakeError(422, "INVALID_INTAKE");
  const facts = object(value.facts);
  if (Object.keys(facts).sort().join() !== [...FACT_FIELDS].sort().join()) throw intakeError(422, "INVALID_INTAKE");
  const entities = object(value.key_entities);
  if (Object.keys(entities).sort().join() !== ["parties", "locations", "dates", "amounts"].sort().join()) throw intakeError(422, "INVALID_INTAKE");
  const normalizedEntities = Object.fromEntries(Object.entries(entities).map(([key, values]) => {
    if (!Array.isArray(values) || values.length > 32) throw intakeError(422, "INVALID_INTAKE");
    return [key, values.map(item => reviewedText(item, 4096))];
  }));
  const result = { issue_summary, primary_language: value.primary_language, legal_domain: value.legal_domain,
    key_entities: normalizedEntities, facts: Object.fromEntries(FACT_FIELDS.map(key => [key, reviewedText(facts[key], 2048, true)])) };
  if (Buffer.byteLength(JSON.stringify(result)) > 65536) throw intakeError(422, "INTAKE_TOO_LARGE");
  return result;
}
export function validateProposal(view, sessionId) {
  const p = object(view?.proposal);
  if (view.session_id !== sessionId || view.phase !== "proposed" || p.confirmed !== false || p.input_tail_complete !== false ||
      p.basis !== "unconfirmed proposal from retained Live audio/conversation context") throw intakeError(409, "PROPOSAL_NOT_AVAILABLE");
  text(p.tool_call_id, 128);
  const a = object(p.analysis);
  if (!Number.isFinite(a.confidence_score) || a.confidence_score < 0 || a.confidence_score > 1 ||
      typeof a.adr_suitable !== "boolean" || !["low", "medium", "high"].includes(a.urgency)) throw intakeError(422, "INVALID_PROPOSAL");
  if ([a.adr_reasoning, a.urgency_reasoning].some(value => typeof value !== "string" || value.length > 8192)) throw intakeError(422, "INVALID_INTAKE");
  const reviewed = validateReviewed({ issue_summary: a.issue_summary, primary_language: a.primary_language,
    legal_domain: a.legal_domain, key_entities: a.key_entities, facts: p.facts });
  if (Buffer.byteLength(JSON.stringify(p)) > 65536) throw intakeError(422, "INTAKE_TOO_LARGE");
  return { proposal: p, reviewed };
}
function identity(actor, caseId) {
  if (String(actor?.role).toLowerCase() !== "client") throw intakeError(403, "CLIENT_REQUIRED");
  if (!Number.isSafeInteger(Number(actor.id)) || Number(actor.id) <= 0 || !Number.isSafeInteger(caseId) || caseId <= 0) throw intakeError(400, "INVALID_CASE");
}
export async function withCase(actor, caseId, action) {
  identity(actor, caseId);
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const result = await db.query("SELECT * FROM public.client_cases WHERE id = $1 AND user_id = $2 FOR UPDATE", [caseId, Number(actor.id)]);
    if (!result.rows[0]) throw intakeError(404, "CASE_NOT_FOUND");
    const value = await action(db, result.rows[0]);
    await db.query("COMMIT");
    return value;
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally { db.release(); }
}
export function editable(c, version) {
  if (c.intake_protocol !== "live_v2" || c.status !== "INTAKE_STARTED" || c.submitted_intake_revision_id) throw intakeError(409, "INTAKE_NOT_EDITABLE");
  if (!Number.isSafeInteger(version) || Number(c.intake_version) !== version) throw intakeError(409, "STALE_CASE_VERSION");
}
export async function replay(db, actor, c, operation, key, request) {
  if (typeof key !== "string" || !/^[A-Za-z0-9._:-]{1,128}$/.test(key)) throw intakeError(400, "INTENT_KEY_REQUIRED");
  if (Buffer.byteLength(JSON.stringify(request)) > 70000) throw intakeError(422, "INTAKE_TOO_LARGE");
  const found = await db.query(`SELECT request_hash, response FROM public.case_intake_receipts
    WHERE case_id=$1 AND actor_user_id=$2 AND operation=$3 AND intent_key=$4`, [c.id, actor.id, operation, key]);
  if (!found.rows[0]) return null;
  if (found.rows[0].request_hash !== digest(request)) throw intakeError(409, "INTENT_CONFLICT");
  if (!found.rows[0].response) throw intakeError(409, "ADMISSION_OUTCOME_UNKNOWN");
  return found.rows[0].response;
}
export async function receipt(db, actor, c, operation, key, request, response) {
  await db.query(`INSERT INTO public.case_intake_receipts
    (case_id, actor_user_id, operation, intent_key, request_hash, response) VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
  [c.id, actor.id, operation, key, digest(request), response === null ? null : JSON.stringify(response)]);
}
async function revision(db, c, id) {
  const result = await db.query("SELECT * FROM public.case_intake_revisions WHERE case_id=$1 AND id=$2", [c.id, id]);
  if (!result.rows[0]) throw intakeError(404, "REVISION_NOT_FOUND");
  return result.rows[0];
}
async function insertRevision(db, actor, c, parent, sessionId, proposal, reviewed) {
  const id = randomUUID();
  const hash = digest({ schema: "review-v1", source: proposal, reviewed });
  await db.query(`INSERT INTO public.case_intake_revisions
    (id,case_id,parent_id,actor_user_id,source_session_id,source_proposal,reviewed_data,content_hash)
    VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8)`,
  [id, c.id, parent, actor.id, sessionId, JSON.stringify(proposal), JSON.stringify(reviewed), hash]);
  const version = Number(c.intake_version) + 1;
  await db.query("UPDATE public.client_cases SET selected_intake_revision_id=$2, intake_version=$3, updated_at=NOW() WHERE id=$1", [c.id, id, version]);
  return { revisionId: id, contentHash: hash, caseVersion: version, reviewedData: reviewed, confirmed: false };
}
export async function saveProposal(actor, caseId, key, request, readProposal) {
  return withCase(actor, caseId, async (db, c) => {
    const prior = await replay(db, actor, c, "save", key, request);
    if (prior) return prior;
    editable(c, request.expectedVersion);
    const bound = await db.query(`SELECT session_id FROM public.case_intake_live_sessions
      WHERE session_id=$1 AND case_id=$2 AND actor_user_id=$3 AND expires_at>NOW()`, [request.sessionId, c.id, actor.id]);
    if (!bound.rows.length) throw intakeError(409, "LIVE_SESSION_UNAVAILABLE");
    const { proposal, reviewed } = validateProposal(await readProposal(request.sessionId), request.sessionId);
    const result = await insertRevision(db, actor, c, c.selected_intake_revision_id, request.sessionId, proposal, reviewed);
    await receipt(db, actor, c, "save", key, request, result);
    return result;
  });
}
export async function editRevision(actor, caseId, key, request) {
  return withCase(actor, caseId, async (db, c) => {
    const prior = await replay(db, actor, c, "edit", key, request);
    if (prior) return prior;
    editable(c, request.expectedVersion);
    await assertCaseInactive(db, c);
    if (c.selected_intake_revision_id !== request.revisionId) throw intakeError(409, "STALE_REVISION");
    const parent = await revision(db, c, request.revisionId);
    const result = await insertRevision(db, actor, c, parent.id, parent.source_session_id, parent.source_proposal, validateReviewed(request.reviewedData));
    await receipt(db, actor, c, "edit", key, request, result);
    return result;
  });
}
export async function confirmRevision(actor, caseId, key, request) {
  return withCase(actor, caseId, async (db, c) => {
    const prior = await replay(db, actor, c, "confirm", key, request);
    if (prior) return prior;
    editable(c, request.expectedVersion);
    await assertCaseInactive(db, c);
    if (request.acknowledgeReview !== true || request.acknowledgmentVersion !== ACKNOWLEDGMENT) throw intakeError(422, "REVIEW_ACKNOWLEDGMENT_REQUIRED");
    if (c.selected_intake_revision_id !== request.revisionId) throw intakeError(409, "STALE_REVISION");
    const selected = await revision(db, c, request.revisionId);
    validateReviewed(selected.reviewed_data, true);
    const id = randomUUID(), version = Number(c.intake_version) + 1;
    await db.query(`INSERT INTO public.case_intake_confirmations
      (id,case_id,revision_id,actor_user_id,content_hash,case_version,acknowledgment_version)
      VALUES ($1,$2,$3,$4,$5,$6,$7)`, [id, c.id, selected.id, actor.id, selected.content_hash, version, ACKNOWLEDGMENT]);
    await db.query("UPDATE public.client_cases SET intake_version=$2, updated_at=NOW() WHERE id=$1", [c.id, version]);
    const result = { confirmationId: id, revisionId: selected.id, contentHash: selected.content_hash, caseVersion: version };
    await receipt(db, actor, c, "confirm", key, request, result);
    return result;
  });
}
export async function submitIntake(actor, caseId, key, request) {
  return withCase(actor, caseId, async (db, c) => {
    const prior = await replay(db, actor, c, "submit", key, request);
    if (prior) return prior;
    editable(c, request.expectedVersion);
    await assertCaseInactive(db, c);
    if (c.selected_intake_revision_id !== request.revisionId) throw intakeError(409, "STALE_REVISION");
    const selected = await revision(db, c, request.revisionId);
    const confirmation = await db.query(`SELECT id FROM public.case_intake_confirmations
      WHERE id=$1 AND case_id=$2 AND revision_id=$3 AND actor_user_id=$4 AND content_hash=$5 AND case_version=$6`,
    [request.confirmationId, c.id, selected.id, actor.id, selected.content_hash, c.intake_version]);
    if (!confirmation.rows.length) throw intakeError(409, "CURRENT_CONFIRMATION_REQUIRED");
    const data = validateReviewed(selected.reviewed_data, true);
    await db.query(`INSERT INTO public.case_intake_submissions
      (case_id,revision_id,confirmation_id,actor_user_id,content_hash) VALUES ($1,$2,$3,$4,$5)`,
    [c.id, selected.id, request.confirmationId, actor.id, selected.content_hash]);
    const version = Number(c.intake_version) + 1;
    await db.query(`UPDATE public.client_cases SET submitted_intake_revision_id=$2,
      intake_version=$3, interview_completed=true, description=$4, language=$5, legal_domain=$6, updated_at=NOW() WHERE id=$1`,
    [c.id, selected.id, version, data.issue_summary, data.primary_language, data.legal_domain]);
    await transitionCaseStatus(db, { caseId: c.id, toStatus: "MATCHING_REVIEW", actorUserId: actor.id, actorRole: "CLIENT",
      allowSameStatus: false, reason: "Client submitted reviewed intake", metadata: { revisionId: selected.id, contentHash: selected.content_hash } });
    const result = { caseId: c.id, revisionId: selected.id, confirmationId: request.confirmationId,
      contentHash: selected.content_hash, caseVersion: version, status: "MATCHING_REVIEW" };
    await receipt(db, actor, c, "submit", key, request, result);
    return result;
  });
}
export async function getReview(actor, caseId) {
  return withCase(actor, caseId, async (db, c) => {
    const selected = c.selected_intake_revision_id ? await revision(db, c, c.selected_intake_revision_id) : null;
    const confirmation = await db.query(`SELECT id, revision_id, content_hash FROM public.case_intake_confirmations
      WHERE case_id=$1 AND actor_user_id=$2 AND case_version=$3`, [c.id, actor.id, c.intake_version]);
    const interviewAllowance = await allowance(db, actor.id);
    const previous = await db.query("SELECT 1 FROM public.interview_admissions WHERE case_id=$1 AND actor_user_id=$2 AND outcome<>'refunded' LIMIT 1", [c.id, actor.id]);
    interviewAllowance.hasPreviousInterview = Boolean(selected || previous.rows.length);
    return { interviewAllowance, caseId: c.id, protocol: c.intake_protocol, status: c.status, caseVersion: Number(c.intake_version),
      revision: selected ? { revisionId: selected.id, contentHash: selected.content_hash, reviewedData: selected.reviewed_data,
        modelSuggestions: selected.source_proposal.analysis, inputTailComplete: false } : null,
      confirmation: confirmation.rows[0] ? { confirmationId: confirmation.rows[0].id,
        revisionId: confirmation.rows[0].revision_id, contentHash: confirmation.rows[0].content_hash } : null,
      submittedRevisionId: c.submitted_intake_revision_id };
  });
}
export async function acceptedIntake(db, caseId) {
  const result = await db.query(`SELECT r.id, r.reviewed_data, r.source_proposal, r.content_hash, s.created_at
    FROM public.client_cases c JOIN public.case_intake_revisions r
      ON r.case_id=c.id AND r.id=c.submitted_intake_revision_id
    JOIN public.case_intake_submissions s ON s.case_id=c.id AND s.revision_id=r.id
    WHERE c.id=$1 AND c.intake_protocol='live_v2'`, [caseId]);
  const row = result.rows[0];
  if (!row) return null;
  return { revisionId: row.id, contentHash: row.content_hash, submittedAt: row.created_at,
    analysis: { ...row.source_proposal.analysis, ...row.reviewed_data, confidence_score: null }, transcript: null };
}
