import pool from "../db.js";

const DAYS90 = 90 * 86400000;
const reasons = ["prepare", "stopped", "disconnected", "timeout", "provider_error", "limit", "capture_error"];
const fail = (status = 422, code = "INVALID_TRANSCRIPT") => { throw Object.assign(new Error(code), { status, code }); };
function keys(value, expected) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).sort().join() !== expected.split(" ").sort().join()) fail();
}
function integer(value, min = 0, max = 256) { if (!Number.isSafeInteger(value) || value < min || value > max) fail(); return value; }
function timestamp(value) {
  if (typeof value !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|[+-]\d\d:\d\d)$/.test(value) || !Number.isFinite(Date.parse(value))) fail();
  const [year, month, day, hour, minute, second] = value.slice(0, 19).split(/[-T:]/).map(Number);
  const days = [31, year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > days[month - 1] || hour > 23 || minute > 59 || second > 59) fail();
  return new Date(value).toISOString();
}
function observedTimestamp(value) {
  const normalized = timestamp(value);
  // Preserve Python's microsecond precision even though JavaScript Date uses milliseconds.
  const fraction = (value.match(/\.(\d+)/)?.[1] ?? "").padEnd(6, "0");
  return normalized.slice(0, -1) + fraction.slice(3) + "Z";
}
function sid(value) { if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) fail(); return value; }
const iso = value => value === null ? null : new Date(value).toISOString();
function metadata(r) {
  return { sessionId: r.session_id, issuedAt: iso(r.issued_at), sessionExpiresAt: iso(r.session_expires_at), endedAt: iso(r.ended_at), retentionEndsAt: iso(r.retention_ends_at), noticeVersion: r.notice_version, acknowledgedAt: iso(r.acknowledged_at), savedThrough: r.saved_through, lastCapturedSequence: r.last_captured_sequence, sealed: r.sealed, sealReason: r.seal_reason, truncated: r.truncated, inputTailComplete: false, collectionState: r.collection_state };
}
// Validates the current Python v1 wire object, not browser DTOs. Text is never normalized.
export function validateBatch(batch, sessionId, afterSequence) {
  keys(batch, "version session_id after_sequence entries next_sequence last_captured_sequence earliest_available_sequence sealed seal_reason sealed_at truncated input_tail_complete has_more");
  if (batch.version !== 1 || batch.session_id !== sid(sessionId) || batch.after_sequence !== integer(afterSequence) || batch.earliest_available_sequence !== 1 || batch.input_tail_complete !== false) fail();
  integer(batch.next_sequence); integer(batch.last_captured_sequence);
  for (const field of ["sealed", "truncated", "has_more"]) if (typeof batch[field] !== "boolean") fail();
  if (batch.sealed ? !reasons.includes(batch.seal_reason) : batch.seal_reason !== null) fail();
  if (batch.sealed) timestamp(batch.sealed_at); else if (batch.sealed_at !== null) fail();
  if (batch.truncated !== (batch.sealed && ["limit", "capture_error"].includes(batch.seal_reason))) fail();
  if (!Array.isArray(batch.entries) || batch.entries.length > 16 || Buffer.byteLength(JSON.stringify(batch)) > 32768) fail();
  batch.entries.forEach((entry, index) => {
    keys(entry, "sequence speaker text observed_at interrupted");
    if (integer(entry.sequence, 1) !== afterSequence + index + 1 || !["user", "assistant"].includes(entry.speaker) || typeof entry.interrupted !== "boolean") fail();
    if (typeof entry.text !== "string" || !entry.text.length || [...entry.text].length > 4096 || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(entry.text)) fail();
    timestamp(entry.observed_at);
  });
  if (batch.next_sequence !== afterSequence + batch.entries.length || batch.next_sequence > batch.last_captured_sequence || batch.has_more !== (batch.next_sequence < batch.last_captured_sequence) || (!batch.entries.length && batch.has_more)) fail();
  return batch;
}
async function transaction(action) {
  let db;
  try {
    db = await pool.connect();
    await db.query("BEGIN");
    await db.query("SET LOCAL statement_timeout='3000ms'");
    await db.query("SET LOCAL lock_timeout='1000ms'");
    const result = await action(db);
    await db.query("COMMIT");
    return result;
  } catch (error) {
    if (db) await db.query("ROLLBACK").catch(() => {});
    if (error?.status && ["INVALID_TRANSCRIPT", "TRANSCRIPT_NOT_FOUND", "CLIENT_REQUIRED", "TRANSCRIPT_CONFLICT"].includes(error.code)) throw error;
    fail(503, "TRANSCRIPT_UNAVAILABLE");
  } finally { db?.release(); }
}
async function owner(db, actor, caseId) {
  if (String(actor?.role).toLowerCase() !== "client") fail(403, "CLIENT_REQUIRED");
  integer(caseId, 1, Number.MAX_SAFE_INTEGER); integer(Number(actor.id), 1, Number.MAX_SAFE_INTEGER);
  const result = await db.query(`SELECT c.id FROM public.client_cases c JOIN public.users u ON u.id=c.user_id
    WHERE c.id=$1 AND c.user_id=$2 AND LOWER(u.role)='client' FOR SHARE OF c,u`, [caseId, Number(actor.id)]);
  if (!result.rows.length) fail(404, "TRANSCRIPT_NOT_FOUND");
}
async function session(db, actor, caseId, sessionId) {
  await owner(db, actor, caseId);
  const result = await db.query(`SELECT t.* FROM public.case_live_transcripts t
    JOIN public.case_intake_live_sessions l ON l.session_id=t.session_id AND l.case_id=t.case_id AND l.actor_user_id=t.actor_user_id
    WHERE t.session_id=$1 AND t.case_id=$2 AND t.actor_user_id=$3 AND t.retention_ends_at>NOW() FOR UPDATE OF t`, [sid(sessionId), caseId, Number(actor.id)]);
  if (!result.rows[0]) fail(404, "TRANSCRIPT_NOT_FOUND");
  return result.rows[0];
}
// registerSource(actor, caseId, {sessionId,noticeVersion,acknowledgedAt,issuedAt,originalExpiry})
// Call only AFTER the admission binding commits; no capability is accepted or stored.
// originalExpiry comes from trusted admission, not the Stop-shortened binding or browser.
export async function registerSource(actor, caseId, source) {
  keys(source, "sessionId noticeVersion acknowledgedAt issuedAt originalExpiry");
  sid(source.sessionId);
  const issued = timestamp(source.issuedAt), expiry = timestamp(source.originalExpiry), ack = timestamp(source.acknowledgedAt);
  if (source.noticeVersion !== "live-transcript-v1" || issued > expiry || ack > expiry) fail();
  return transaction(async db => {
    await owner(db, actor, caseId);
    const binding = await db.query(`SELECT session_id FROM public.case_intake_live_sessions
      WHERE session_id=$1 AND case_id=$2 AND actor_user_id=$3 AND date_trunc('milliseconds',expires_at)<=$4::timestamptz FOR SHARE`, [source.sessionId, caseId, Number(actor.id), expiry]);
    if (!binding.rows.length) fail(404, "TRANSCRIPT_NOT_FOUND");
    await db.query(`INSERT INTO public.case_live_transcripts
      (session_id,case_id,actor_user_id,issued_at,session_expires_at,retention_ends_at,notice_version,acknowledged_at)
      VALUES($1,$2,$3,$4,$5,$5::timestamptz+INTERVAL '2160 hours',$6,$7) ON CONFLICT DO NOTHING`, [source.sessionId, caseId, Number(actor.id), issued, expiry, source.noticeVersion, ack]);
    const r = await session(db, actor, caseId, source.sessionId);
    if (iso(r.issued_at) !== issued || iso(r.session_expires_at) !== expiry || iso(r.acknowledged_at) !== ack || r.notice_version !== source.noticeVersion) fail(409, "TRANSCRIPT_CONFLICT");
    return metadata(r);
  });
}
// saveBatch(actor, caseId, sessionId, afterSequence, pythonBatch): Promise<metadata>
export async function saveBatch(actor, caseId, sessionId, afterSequence, batch) {
  validateBatch(batch, sessionId, afterSequence);
  return transaction(async db => {
    const r = await session(db, actor, caseId, sessionId);
    if (afterSequence > r.saved_through || (r.sealed && (batch.last_captured_sequence > r.last_captured_sequence || (batch.sealed && (batch.seal_reason !== r.seal_reason || timestamp(batch.sealed_at) !== iso(r.sealed_at) || batch.last_captured_sequence !== r.last_captured_sequence))))) fail(409, "TRANSCRIPT_CONFLICT");
    let saved = r.saved_through, bytes = r.text_bytes;
    for (const e of batch.entries) {
      if (e.sequence <= saved) {
        const old = (await db.query("SELECT * FROM public.case_live_transcript_entries WHERE session_id=$1 AND sequence=$2", [sessionId, e.sequence])).rows[0];
        if (!old || !Buffer.from(old.text_utf8).equals(Buffer.from(e.text, "utf8")) || old.speaker !== e.speaker || old.interrupted !== e.interrupted || old.observed_at !== observedTimestamp(e.observed_at)) fail(409, "TRANSCRIPT_CONFLICT");
      } else {
        if (e.sequence !== saved + 1) fail(409, "TRANSCRIPT_CONFLICT");
        bytes += Buffer.byteLength(e.text);
        if (bytes > 262144) fail();
        await db.query(`INSERT INTO public.case_live_transcript_entries(session_id,sequence,speaker,text_utf8,observed_at,interrupted) VALUES($1,$2,$3,$4,$5,$6)`, [sessionId, e.sequence, e.speaker, Buffer.from(e.text, "utf8"), observedTimestamp(e.observed_at), e.interrupted]);
        saved = e.sequence;
      }
    }
    const captured = Math.max(r.last_captured_sequence, batch.last_captured_sequence);
    const sealed = r.sealed || batch.sealed;
    // Older identical entry replays must not rewind the source metadata or ACK.
    if (batch.sealed && batch.last_captured_sequence < r.last_captured_sequence) fail(409, "TRANSCRIPT_CONFLICT");
    const state = r.collection_state === "partial" ? "partial" : sealed && saved === captured ? "saved" : "collecting";
    const result = await db.query(`UPDATE public.case_live_transcripts SET saved_through=$2,text_bytes=$3,last_captured_sequence=$4,sealed=$5,seal_reason=$6,truncated=$7,collection_state=$8,sealed_at=$9 WHERE session_id=$1 RETURNING *`, [sessionId, saved, bytes, captured, sealed, r.sealed ? r.seal_reason : batch.seal_reason, r.sealed ? r.truncated : batch.truncated, state, r.sealed ? r.sealed_at : batch.sealed_at === null ? null : timestamp(batch.sealed_at)]);
    return metadata(result.rows[0]);
  });
}
// markEnded(actor, caseId, sessionId, endedAt): first terminal time wins, clamped to original TTL.
export async function markEnded(actor, caseId, sessionId, endedAt) {
  const end = timestamp(endedAt);
  return transaction(async db => {
    const r = await session(db, actor, caseId, sessionId);
    if (end < iso(r.issued_at)) fail();
    if (r.ended_at) return metadata(r);
    const fixed = new Date(Math.min(Date.parse(end), new Date(r.session_expires_at).getTime())).toISOString();
    return metadata((await db.query(`UPDATE public.case_live_transcripts SET ended_at=$2,retention_ends_at=$3 WHERE session_id=$1 RETURNING *`, [sessionId, fixed, new Date(Date.parse(fixed) + DAYS90).toISOString()])).rows[0]);
  });
}
// markPartial(actor, caseId, sessionId): never fabricates source sealing or interview end.
export async function markPartial(actor, caseId, sessionId) {
  return transaction(async db => {
    await session(db, actor, caseId, sessionId);
    return metadata((await db.query("UPDATE public.case_live_transcripts SET collection_state='partial' WHERE session_id=$1 RETURNING *", [sessionId])).rows[0]);
  });
}
// ownerList(actor, caseId, {limit=10,before=null}={}): Promise<{caseId,interviews,nextBefore}>
export async function ownerList(actor, caseId, { limit = 10, before = null } = {}) {
  integer(limit, 1, 20);
  return transaction(async db => {
    await owner(db, actor, caseId);
    const cursor = before === null ? null : await session(db, actor, caseId, before);
    const rows = (await db.query(`SELECT t.* FROM public.case_live_transcripts t
      JOIN public.case_intake_live_sessions l ON l.session_id=t.session_id AND l.case_id=t.case_id AND l.actor_user_id=t.actor_user_id
      WHERE t.case_id=$1 AND t.actor_user_id=$2 AND t.retention_ends_at>NOW()
      AND ($3::timestamptz IS NULL OR (t.issued_at,t.session_id)<($3::timestamptz,$4::text))
      ORDER BY t.issued_at DESC,t.session_id DESC LIMIT $5`, [caseId, Number(actor.id), cursor?.issued_at ?? null, before, limit + 1])).rows;
    return { caseId, interviews: rows.slice(0, limit).map(metadata), nextBefore: rows.length > limit ? rows[limit - 1].session_id : null };
  });
}
// ownerRead(actor, caseId, sessionId, {afterSequence=0}={}): bounded public DTO.
export async function ownerRead(actor, caseId, sessionId, { afterSequence = 0 } = {}) {
  integer(afterSequence);
  return transaction(async db => {
    const r = await session(db, actor, caseId, sessionId);
    if (afterSequence > r.saved_through) fail();
    const rows = (await db.query(`SELECT * FROM public.case_live_transcript_entries WHERE session_id=$1 AND sequence>$2 ORDER BY sequence LIMIT 16`, [sessionId, afterSequence])).rows;
    const result = { caseId, interview: metadata(r), entries: [], nextSequence: afterSequence, hasMore: afterSequence < r.saved_through };
    for (const e of rows) {
      const entry = { sequence: e.sequence, speaker: e.speaker, text: Buffer.from(e.text_utf8).toString("utf8"), observedAt: e.observed_at, interrupted: e.interrupted };
      const candidate = { ...result, entries: [...result.entries, entry], nextSequence: e.sequence, hasMore: e.sequence < r.saved_through };
      if (Buffer.byteLength(JSON.stringify(candidate)) > 32768) break;
      Object.assign(result, candidate);
    }
    return result;
  });
}
// purgeExpired(limit=100): one bounded batch; caller schedules, no import-time timer.
// Physical primary-store deletion only; this makes no backup-erasure guarantee.
export async function purgeExpired(limit = 100) {
  integer(limit, 1, 1000);
  return transaction(async db => (await db.query(`WITH expired AS (
    SELECT session_id FROM public.case_live_transcripts WHERE retention_ends_at<=NOW()
    ORDER BY retention_ends_at LIMIT $1 FOR UPDATE SKIP LOCKED)
    DELETE FROM public.case_live_transcripts t USING expired e WHERE t.session_id=e.session_id RETURNING t.session_id`, [limit])).rowCount);
}
