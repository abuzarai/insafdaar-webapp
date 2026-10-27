import { jest } from "@jest/globals";
import express from "express";
import request from "supertest";

let state, snapshot, failInsert, dbRole, ownerId, bindingExpiry;
const now = Date.now();
const issued = new Date(now - 10000).toISOString(), expiry = new Date(now + 60000).toISOString();
const db = { release: jest.fn(), query: jest.fn(async (sql, p = []) => {
  if (sql === "BEGIN") { snapshot = structuredClone(state); return { rows: [] }; }
  if (sql === "ROLLBACK") { state = snapshot; return { rows: [] }; }
  if (sql === "COMMIT" || sql.startsWith("SET LOCAL")) return { rows: [] };
  if (sql.includes("SELECT c.id")) return { rows: dbRole === "client" && p[1] === ownerId ? [{ id: 7 }] : [] };
  if (sql.includes("SELECT session_id FROM public.case_intake_live_sessions")) return { rows: p[0] === "sid" && p[1] === 7 && p[2] === 3 && bindingExpiry <= p[3] ? [{ session_id: "sid" }] : [] };
  if (sql.startsWith("INSERT INTO public.case_live_transcripts")) {
    state.session ??= { session_id: p[0], case_id: p[1], actor_user_id: p[2], issued_at: p[3], session_expires_at: p[4], retention_ends_at: new Date(Date.parse(p[4]) + 90 * 86400000).toISOString(), notice_version: p[5], acknowledged_at: p[6], ended_at: null, saved_through: 0, text_bytes: 0, last_captured_sequence: 0, sealed: false, seal_reason: null, truncated: false, collection_state: "collecting" };
    return { rows: [] };
  }
  if (sql.includes("SELECT t.*")) {
    const r = state.session;
    return { rows: r && r.retention_ends_at > new Date().toISOString() && (sql.includes("t.session_id=$1") ? p[0] === r.session_id && p[1] === r.case_id && p[2] === r.actor_user_id : p[0] === r.case_id && p[1] === r.actor_user_id) ? [structuredClone(r)] : [] };
  }
  if (sql.startsWith("SELECT * FROM public.case_live_transcript_entries")) return { rows: state.entries.filter(e => sql.includes("sequence=$2") ? e.sequence === p[1] : e.sequence > p[1]).slice(0, 16) };
  if (sql.startsWith("INSERT INTO public.case_live_transcript_entries")) {
    if (failInsert === p[1]) throw new Error("sensitive SQL detail");
    state.entries.push({ session_id: p[0], sequence: p[1], speaker: p[2], text_utf8: Buffer.from(p[3]), observed_at: p[4], interrupted: p[5] }); return { rows: [] };
  }
  if (sql.startsWith("UPDATE public.case_live_transcripts")) {
    if (sql.includes("saved_through=$2")) Object.assign(state.session, { saved_through: p[1], text_bytes: p[2], last_captured_sequence: p[3], sealed: p[4], seal_reason: p[5], truncated: p[6], collection_state: p[7], sealed_at: p[8] });
    if (sql.includes("ended_at=$2")) Object.assign(state.session, { ended_at: p[1], retention_ends_at: p[2] });
    if (sql.includes("collection_state='partial'")) state.session.collection_state = "partial";
    return { rows: [structuredClone(state.session)] };
  }
  if (sql.startsWith("WITH expired")) {
    const expired = state.session?.retention_ends_at <= new Date().toISOString();
    if (expired) { state.session = null; state.entries = []; }
    return { rowCount: expired ? 1 : 0 };
  }
  throw new Error(`Unrecognized test SQL: ${sql}`);
}) };
jest.unstable_mockModule("../db.js", () => ({ default: { connect: jest.fn(async () => db) } }));
jest.unstable_mockModule("../middleware/authMiddleware.js", () => ({ authMiddleware: (req, res, next) => { req.user = { id: 3, role: "client" }; next(); } }));
const service = await import("../services/liveTranscript.service.js");
const { default: router } = await import("../routes/liveTranscript.routes.js");
const actor = { id: 3, role: "client" };
const source = { sessionId: "sid", noticeVersion: "live-transcript-v1", acknowledgedAt: issued, issuedAt: issued, originalExpiry: expiry };
const entry = (sequence, text = " original متن ") => ({ sequence, speaker: "user", text, observed_at: issued, interrupted: false });
const batch = (entries = [entry(1)], after = 0, extra = {}) => ({ version: 1, session_id: "sid", after_sequence: after, entries, next_sequence: after + entries.length, last_captured_sequence: after + entries.length, earliest_available_sequence: 1, sealed: false, seal_reason: null, sealed_at: null, truncated: false, input_tail_complete: false, has_more: false, ...extra });
beforeEach(async () => { state = { session: null, entries: [] }; failInsert = null; dbRole = "client"; ownerId = 3; bindingExpiry = expiry; db.query.mockClear(); await service.registerSource(actor, 7, source); });

test("committed binding required and registration replay cannot alter notice or expiry", async () => {
  await expect(service.registerSource(actor, 7, { ...source, originalExpiry: issued })).rejects.toMatchObject({ code: "TRANSCRIPT_NOT_FOUND" });
  await expect(service.registerSource(actor, 7, { ...source, acknowledgedAt: new Date(now - 5000).toISOString() })).rejects.toMatchObject({ code: "TRANSCRIPT_CONFLICT" });
});
test("registration after Stop-shortened binding keeps trusted original expiry and fallback retention", async () => {
  state.session = null;
  bindingExpiry = new Date(now - 1000).toISOString();
  const result = await service.registerSource(actor, 7, source);
  expect(result.sessionExpiresAt).toBe(expiry);
  expect(result.retentionEndsAt).toBe(new Date(Date.parse(expiry) + 90 * 86400000).toISOString());
  expect(result.endedAt).toBeNull();
  expect((await service.ownerRead(actor, 7, "sid")).interview.retentionEndsAt).toBe(result.retentionEndsAt);
  await expect(service.registerSource(actor, 7, { ...source, originalExpiry: new Date(now + 120000).toISOString() })).rejects.toMatchObject({ code: "TRANSCRIPT_CONFLICT" });
  state.session = null;
  bindingExpiry = new Date(Date.parse(expiry) + 1).toISOString();
  await expect(service.registerSource(actor, 7, source)).rejects.toMatchObject({ code: "TRANSCRIPT_NOT_FOUND" });
});
test("NUL source bytes round-trip and replay unchanged within encoded and aggregate byte bounds", async () => {
  const text = "\u0000".repeat(4096);
  const value = batch([entry(1, text)]);
  expect(Buffer.byteLength(JSON.stringify(value))).toBeLessThanOrEqual(32768);
  expect(() => service.validateBatch(value, "sid", 0)).not.toThrow();
  expect(() => service.validateBatch(batch([entry(1, text), entry(2, text)]), "sid", 0)).toThrow("INVALID_TRANSCRIPT");
  state.session.text_bytes = 262144 - 4096;
  await service.saveBatch(actor, 7, "sid", 0, value);
  expect(Buffer.isBuffer(state.entries[0].text_utf8)).toBe(true);
  expect(state.entries[0].text_utf8.equals(Buffer.alloc(4096))).toBe(true);
  expect(state.session.text_bytes).toBe(262144);
  await service.saveBatch(actor, 7, "sid", 0, value);
  expect(state.entries).toHaveLength(1);
  expect(state.session.text_bytes).toBe(262144);
  const result = await service.ownerRead(actor, 7, "sid");
  expect(result.entries[0].text).toBe(text);
  expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(32768);
  expect(JSON.parse(JSON.stringify(result)).entries[0].text).toBe(text);
  await expect(service.saveBatch(actor, 7, "sid", 0, batch([entry(1, text.slice(1) + "x")]))).rejects.toMatchObject({ code: "TRANSCRIPT_CONFLICT" });
  await expect(service.saveBatch(actor, 7, "sid", 1, batch([entry(2, "\u0000")], 1))).rejects.toMatchObject({ code: "INVALID_TRANSCRIPT" });
  expect(state.entries).toHaveLength(1); expect(state.session.saved_through).toBe(1);
});
test("immutable replay, conflict and gaps; contiguous ACK, no MAX sequence", async () => {
  expect((await service.saveBatch(actor, 7, "sid", 0, batch())).savedThrough).toBe(1);
  await service.saveBatch(actor, 7, "sid", 0, batch());
  expect(state.entries).toHaveLength(1);
  await expect(service.saveBatch(actor, 7, "sid", 0, batch([entry(1, "changed")]))).rejects.toMatchObject({ code: "TRANSCRIPT_CONFLICT" });
  await expect(service.saveBatch(actor, 7, "sid", 2, batch([entry(3)], 2))).rejects.toMatchObject({ code: "TRANSCRIPT_CONFLICT" });
  expect(db.query.mock.calls.some(([sql]) => sql.includes("MAX("))).toBe(false);
});
test("older identical replay cannot rewind captured/sealed metadata; microseconds remain immutable", async () => {
  const first = batch([{ ...entry(1), observed_at: issued.replace(/\.\d{3}Z$/, ".123456Z") }]);
  await service.saveBatch(actor, 7, "sid", 0, first);
  await service.saveBatch(actor, 7, "sid", 1, batch([entry(2)], 1, { sealed: true, seal_reason: "stopped", sealed_at: issued }));
  const replay = await service.saveBatch(actor, 7, "sid", 0, first);
  expect(replay.savedThrough).toBe(2); expect(replay.sealed).toBe(true); expect(replay.lastCapturedSequence).toBe(2);
  expect((await service.ownerRead(actor, 7, "sid")).entries[0].observedAt).toMatch(/123456Z$/);
  await expect(service.saveBatch(actor, 7, "sid", 0, batch([{ ...first.entries[0], observed_at: first.entries[0].observed_at.replace("123456", "123457") }]))).rejects.toMatchObject({ code: "TRANSCRIPT_CONFLICT" });
});
test("failed transaction rolls back entries AND ACK and sanitizes DB errors", async () => {
  failInsert = 2;
  await expect(service.saveBatch(actor, 7, "sid", 0, batch([entry(1), entry(2)]))).rejects.toMatchObject({ message: "TRANSCRIPT_UNAVAILABLE", status: 503 });
  expect(state.entries).toEqual([]); expect(state.session.saved_through).toBe(0);
});
test("strict source keys, sid, cursors, types, timestamps and Unicode/codepoint/encoded bounds", () => {
  expect(() => service.validateBatch(batch([entry(1, "😀".repeat(4096))]), "sid", 0)).not.toThrow();
  for (const value of [batch([entry(1, "😀".repeat(4097))]), batch([entry(1, "\ud800")]), batch([], 0, { version: true }), batch([], 0, { input_tail_complete: true }), batch([], 0, { next_sequence: 1 }), batch([], 0, { extra: 1 }), batch([entry(2)]), batch([ { ...entry(1), observed_at: "yesterday" } ]), batch([ { ...entry(1), interrupted: 0 } ]), batch(Array.from({ length: 17 }, (_, i) => entry(i + 1))), batch([entry(1, '"'.repeat(4096)), entry(2, '"'.repeat(4096)), entry(3, '"'.repeat(4096)), entry(4, '"'.repeat(4096))])]) {
    expect(() => service.validateBatch(value, "sid", 0)).toThrow("INVALID_TRANSCRIPT");
  }
  expect(() => service.validateBatch(batch(), "foreign", 0)).toThrow();
  expect(() => service.validateBatch(batch(), "sid", "0")).toThrow();
});
test("aggregate UTF8 session bound is transactional", async () => {
  state.session.text_bytes = 262144;
  await expect(service.saveBatch(actor, 7, "sid", 0, batch())).rejects.toMatchObject({ code: "INVALID_TRANSCRIPT" });
  expect(state.session.saved_through).toBe(0);
});
test("fresh DB ownership and role, actor binding; no submitted/editable/liveTTL guard", async () => {
  state.session.session_expires_at = new Date(now - 1000).toISOString();
  state.session.submitted_intake_revision_id = "submitted";
  expect((await service.ownerRead(actor, 7, "sid")).interview.sessionId).toBe("sid");
  for (const role of ["admin", "advocate"]) await expect(service.ownerRead({ ...actor, role }, 7, "sid")).rejects.toMatchObject({ status: 403 });
  dbRole = "admin"; await expect(service.ownerList(actor, 7)).rejects.toMatchObject({ status: 404 });
  dbRole = "client"; ownerId = 4; await expect(service.ownerRead(actor, 7, "sid")).rejects.toMatchObject({ status: 404 });
  ownerId = 3; state.session.actor_user_id = 4; await expect(service.ownerRead(actor, 7, "sid")).rejects.toMatchObject({ status: 404 });
});
test("first end wins; 90 days fixed; limit sealing is not end; partial truthfulness", async () => {
  await service.saveBatch(actor, 7, "sid", 0, batch([], 0, { sealed: true, seal_reason: "limit", sealed_at: issued, truncated: true }));
  expect(state.session.ended_at).toBeNull();
  const fallback = state.session.retention_ends_at;
  await service.ownerRead(actor, 7, "sid"); expect(state.session.retention_ends_at).toBe(fallback);
  const end = new Date(now).toISOString();
  const first = await service.markEnded(actor, 7, "sid", end);
  expect(first.retentionEndsAt).toBe(new Date(now + 90 * 86400000).toISOString());
  expect((await service.markEnded(actor, 7, "sid", expiry)).endedAt).toBe(end);
  expect((await service.markPartial(actor, 7, "sid")).collectionState).toBe("partial");
});
test("expiry enforced before independent bounded purge", async () => {
  state.session.retention_ends_at = issued;
  await expect(service.ownerRead(actor, 7, "sid")).rejects.toMatchObject({ status: 404 });
  expect((await service.ownerList(actor, 7)).interviews).toEqual([]);
  await expect(service.ownerList(actor, 7, { before: "foreign" })).rejects.toMatchObject({ status: 404 });
  expect(await service.purgeExpired(1)).toBe(1); expect(state.entries).toEqual([]);
});
test("read pagination bounds full JSON response and preserves source text", async () => {
  const entries = Array.from({ length: 8 }, (_, i) => entry(i + 1, "😀".repeat(1000)));
  await service.saveBatch(actor, 7, "sid", 0, batch(entries.slice(0, 4), 0, { last_captured_sequence: 8, has_more: true }));
  await service.saveBatch(actor, 7, "sid", 4, batch(entries.slice(4), 4));
  const result = await service.ownerRead(actor, 7, "sid");
  expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(32768);
  expect(result.hasMore).toBe(true); expect(result.entries[0].text).toBe(entries[0].text);
  const next = await service.ownerRead(actor, 7, "sid", { afterSequence: result.nextSequence }); expect(next.hasMore).toBe(false);
});
test("read-only mergeParams router, strict public cursor, no-store including errors", async () => {
  const app = express(); app.use("/cases/:caseId/intake-v2", router);
  const response = await request(app).get("/cases/7/intake-v2/transcripts/sid?afterSequence=0");
  expect(response.status).toBe(200); expect(response.headers["cache-control"]).toBe("no-store"); expect(response.body.caseId).toBe(7);
  const bad = await request(app).get("/cases/7/intake-v2/transcripts/sid?afterSequence=1e0");
  expect(bad.status).toBe(422); expect(bad.headers["cache-control"]).toBe("no-store");
  expect((await request(app).post("/cases/7/intake-v2/transcripts/sid").send({ text: "not accepted" })).status).toBe(404);
});
