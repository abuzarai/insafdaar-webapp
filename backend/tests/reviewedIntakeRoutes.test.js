import { jest, test, expect, beforeEach } from "@jest/globals";
import express from "express";
import request from "supertest";
let c, prior, legacyHistory, allowanceRow, paused;
const query = jest.fn(async (sql, values = []) => {
  const q = (typeof sql === "string" ? sql : sql.text).replace(/\s+/g, " ");
  if (q.startsWith("SELECT paused")) return { rows: [{ paused }] };
  if (q.startsWith("WITH moment")) return { rows: [{ daily: 0, weekly: 0, platform: 0, ...allowanceRow }] };
  if (q.startsWith("SELECT 1 FROM public.interview_admissions")) return { rows: [] };
  if (q.startsWith("SELECT * FROM public.client_cases")) return { rows: c ? [{ ...c }] : [] };
  if (q.startsWith("SELECT 1 FROM public.case_intake_sessions")) return { rows: legacyHistory ? [{ exists: 1 }] : [] };
  if (q.startsWith("SELECT request_hash")) return { rows: prior ? [prior] : [] };
  if (q.startsWith("SELECT session_id FROM public.case_intake_live_sessions WHERE session_id=$1")) return { rows: [{ session_id: values[0] }] };
  if (q.startsWith("UPDATE public.client_cases SET intake_protocol")) { c.intake_protocol = "live_v2"; c.intake_version++; }
  if (q.startsWith("UPDATE public.client_cases SET status")) c.status = "INTAKE_STARTED";
  return { rows: [], rowCount: 1 };
});
const pool = { query, connect: jest.fn(async () => ({ query, release: jest.fn() })) };
const live = { admit: jest.fn(), stop: jest.fn(), call: jest.fn() };
jest.unstable_mockModule("../db.js", () => ({ default: pool }));
jest.unstable_mockModule("../middleware/authMiddleware.js", () => ({ authMiddleware: (req, res, next) => {
  if (!req.get("Authorization")) return res.status(401).json({ error: "Unauthorized" });
  req.user = { id: 42, role: req.get("x-test-role") || "client" }; next();
} }));
jest.unstable_mockModule("../services/liveIntakeClient.js", () => ({ liveIntakeClient: live }));
const { default: router } = await import("../routes/reviewedIntake.routes.js");
const { liveTranscriptCollector } = await import("../services/liveTranscriptCollector.js");
let startCollector, endCollector;
const { digest } = await import("../services/reviewedIntake.service.js");
const app = express(); app.use(express.json()); app.use("/cases/:caseId/intake", router);
const path = "/cases/101/intake";
const post = (suffix, body) => request(app).post(path + suffix).set("Authorization", "Bearer fictional").set("Idempotency-Key", "intent-one").send(body);
const admission = { expectedVersion: 0, processingConsent: true };
beforeEach(() => {
  c = { id: 101, user_id: 42, status: "DRAFT", intake_protocol: "legacy", intake_version: 0 };
  prior = null; legacyHistory = false; allowanceRow = {}; paused = false;
  startCollector = jest.spyOn(liveTranscriptCollector, "start").mockReturnValue("pending");
  endCollector = jest.spyOn(liveTranscriptCollector, "end").mockImplementation(() => {});
  query.mockClear(); pool.connect.mockClear();
  live.admit.mockReset(); live.stop.mockReset(); live.call.mockReset();
  process.env.INTAKE_V2_ENABLED = "true";
});

test("new admission is disabled by default", async () => {
  delete process.env.INTAKE_V2_ENABLED;
  const response = await post("/sessions", admission);
  expect(response.status).toBe(404); expect(pool.connect).not.toHaveBeenCalled(); expect(live.admit).not.toHaveBeenCalled();
});

test.each(["admin", "advocate"])("%s cannot impersonate a confirming client", async role => {
  const response = await request(app).post(path + "/sessions").set("Authorization", "Bearer fictional").set("x-test-role", role).send(admission);
  expect(response.status).toBe(403); expect(pool.connect).not.toHaveBeenCalled();
});

test("unauthenticated callers cannot read intake", async () => {
  expect((await request(app).get(path + "/review")).status).toBe(401);
});

test("review responses are no-store", async () => {
  const response = await request(app).get(path + "/review").set("Authorization", "Bearer fictional");
  expect(response.status).toBe(200); expect(response.headers["cache-control"]).toBe("no-store");
});

test.each([
  { ...admission, processingConsent: false }, { ...admission, capability: "caller-injected" },
  { ...admission, expectedVersion: -1 },
  { expectedVersion: 0, syntheticConsent: true },
  { ...admission, processingConsent: "true" },
  { ...admission, processingConsent: 1 },
  { ...admission, processingConsent: null },
])("admission validates its exact input contract", async body => {
  expect((await post("/sessions", body)).status).toBe(422); expect(live.admit).not.toHaveBeenCalled();
});

test("foreign case fails before voice admission", async () => {
  c = null; expect((await post("/sessions", admission)).status).toBe(404); expect(live.admit).not.toHaveBeenCalled();
});

test("historical legacy intake is not relabeled as reviewed", async () => {
  legacyHistory = true;
  const response = await post("/sessions", admission);
  expect(response.status).toBe(409); expect(response.body.code).toBe("LEGACY_INTAKE_HISTORY");
  expect(live.admit).not.toHaveBeenCalled(); expect(c.intake_protocol).toBe("legacy");
});

test("unknown pending intent is never bootstrapped again", async () => {
  prior = { request_hash: digest(admission), response: null };
  const response = await post("/sessions", admission);
  expect(response.status).toBe(409); expect(response.body.code).toBe("ADMISSION_OUTCOME_UNKNOWN");
  expect(live.admit).not.toHaveBeenCalled();
});

test("known admission receipt replays without another bootstrap", async () => {
  prior = { request_hash: digest(admission), response: { sessionId: "known", caseVersion: 1 } };
  expect((await post("/sessions", admission)).body.sessionId).toBe("known"); expect(live.admit).not.toHaveBeenCalled();
});

test("admission reserves an intent before the external call", async () => {
  live.admit.mockImplementationOnce(async () => {
    expect(query.mock.calls.some(([sql]) => sql === "COMMIT")).toBe(true);
    expect(query.mock.calls.some(([sql]) => typeof sql === "string" && sql.includes("INSERT INTO public.case_intake_receipts"))).toBe(true);
    throw new Error("Unknown network outcome");
  });
  const response = await post("/sessions", admission);
  expect(response.status).toBe(500); expect(live.admit).toHaveBeenCalledTimes(1);
  expect(c.status).toBe("DRAFT"); expect(c.intake_protocol).toBe("live_v2");
});

test("successful admission binds a session and starts the existing case", async () => {
  live.admit.mockResolvedValueOnce({ sessionId: "known", expiresAt: "2026-12-01T00:00:00Z" });
  const response = await post("/sessions", admission);
  expect(response.status).toBe(200); expect(response.body.caseVersion).toBe(1);
  expect(c.status).toBe("INTAKE_STARTED");
  expect(query.mock.calls.some(([sql]) => typeof sql === "string" && sql.includes("INSERT INTO public.case_intake_live_sessions"))).toBe(true);
});

test("known rate rejection is durably recorded and replayed without bootstrap", async () => {
  live.admit.mockRejectedValueOnce(Object.assign(new Error("limited"), { status: 429, code: "LIVE_ADMISSION_RATE_LIMITED", definitiveAdmissionRejection: true }));
  const response = await post("/sessions", admission);
  expect(response.status).toBe(429); expect(response.body.code).toBe("LIVE_ADMISSION_RATE_LIMITED");
  const finalized = query.mock.calls.find(([sql]) => typeof sql === "string" && sql.includes("UPDATE public.case_intake_receipts SET response=$5::jsonb"));
  expect(finalized).toBeDefined();
  const rejected = JSON.parse(finalized[1][4]);
  expect(rejected).toEqual({ rejected: true, status: 429, code: "LIVE_ADMISSION_RATE_LIMITED" });
  prior = { request_hash: digest(admission), response: rejected };
  expect((await post("/sessions", admission)).status).toBe(429);
  expect(live.admit).toHaveBeenCalledTimes(1);
});

test("unknown admission failure keeps the intent quarantined", async () => {
  live.admit.mockRejectedValueOnce(Object.assign(new Error("network unknown"), { status: 502, code: "LIVE_REQUEST_FAILED" }));
  expect((await post("/sessions", admission)).status).toBe(502);
  expect(query.mock.calls.some(([sql]) => typeof sql === "string" && sql.includes("UPDATE public.case_intake_receipts SET response=$5::jsonb"))).toBe(false);
});

test.each([
  { sdp: "v=0\\r\\n", type: "offer", pc_id: null, restart_pc: false },
  { sdp: "v=0\\r\\n", type: "offer" },
])("initial SDK metadata is normalized to the strict voice contract", async payload => {
  c.intake_protocol = "live_v2"; c.status = "INTAKE_STARTED";
  live.call.mockResolvedValueOnce({ type: "answer", sdp: "v=0", pc_id: "peer" });
  expect((await post("/sessions/known/webrtc/offer", payload)).status).toBe(200);
  expect(live.call).toHaveBeenCalledWith({ id: 42, role: "client" }, 101, "known", "webrtc/offer", "POST", { sdp: "v=0\\r\\n", type: "offer" });
});

test.each([
  { sdp: "v=0", type: "offer", pc_id: "foreign", restart_pc: false },
  { sdp: "v=0", type: "offer", pc_id: null, restart_pc: true },
  { sdp: "v=0", type: "offer", pc_id: null },
  { sdp: "v=0", type: "offer", pc_id: null, restart_pc: false, requestData: {} },
  { sdp: "v=0", type: "answer" }, { sdp: "", type: "offer" },
])("unknown commands and noninitial offers never reach voice", async payload => {
  c.intake_protocol = "live_v2"; c.status = "INTAKE_STARTED";
  expect((await post("/sessions/known/webrtc/offer", payload)).status).toBe(422);
  expect(live.call).not.toHaveBeenCalled();
});

test("SDK candidate patch already matches canonical snake-case contract", async () => {
  c.intake_protocol = "live_v2"; c.status = "INTAKE_STARTED";
  const payload = { pc_id: "peer", candidates: [{ candidate: "candidate:fixture", sdp_mid: "0", sdp_mline_index: 0 }] };
  live.call.mockResolvedValueOnce({ status: "accepted" });
  const response = await request(app).patch(path + "/sessions/known/webrtc/offer").set("Authorization", "Bearer fictional").send(payload);
  expect(response.status).toBe(200);
  expect(live.call).toHaveBeenCalledWith({ id: 42, role: "client" }, 101, "known", "webrtc/offer", "PATCH", payload);
});

test("known orphan is stopped if post-admission persistence fails", async () => {
  const db = { query, release: jest.fn() };
  pool.connect.mockResolvedValueOnce(db).mockRejectedValueOnce(new Error("Database down"));
  live.admit.mockResolvedValueOnce({ sessionId: "known", expiresAt: "2026-12-01T00:00:00Z" });
  live.stop.mockResolvedValueOnce({});
  expect((await post("/sessions", admission)).status).toBe(500);
  expect(live.stop).toHaveBeenCalledWith({ id: 42, role: "client" }, 101, "known");
});

test("safety Stop reaches voice even with feature disabled and database down", async () => {
  delete process.env.INTAKE_V2_ENABLED;
  query.mockRejectedValueOnce(new Error("Database down")); live.stop.mockResolvedValueOnce({ session_id: "known", phase: "partial" });
  expect((await post("/sessions/known/stop", {})).status).toBe(200);
  expect(live.stop).toHaveBeenCalledTimes(1); expect(pool.connect).not.toHaveBeenCalled();
});

test("safety Stop response never waits for a saturated database pool", async () => {
  query.mockImplementationOnce(() => new Promise(() => {})); live.stop.mockResolvedValueOnce({ session_id: "known", phase: "partial" });
  const response = await post("/sessions/known/stop", {}).timeout({ response: 1000, deadline: 2000 });
  expect(response.status).toBe(200); expect(live.stop).toHaveBeenCalledTimes(1);
});

test.each([["revisions", { expectedVersion: 1, sessionId: ["known"] }], ["edits", { expectedVersion: 1, revisionId: ["id"], reviewedData: {} }]])("%s rejects non-string IDs at the boundary", async (operation, body) => {
  expect((await post(`/${operation}`, body)).status).toBe(422); expect(pool.connect).not.toHaveBeenCalled();
});


test("legacy admission without transcript notice never starts persistence", async () => {
  live.admit.mockResolvedValueOnce({ sessionId: "known", expiresAt: "2026-12-01T00:00:00Z" });
  const response = await post("/sessions", admission);
  expect(response.status).toBe(200); expect(startCollector).not.toHaveBeenCalled();
  expect(response.body).not.toHaveProperty("transcriptSaving");
});

test.each([null, false, 1, "", "live-transcript-v2", {}])("invalid supplied transcript notice is rejected before admission: %j", async transcriptNoticeVersion => {
  const response = await post("/sessions", { ...admission, transcriptNoticeVersion });
  expect(response.status).toBe(422); expect(live.admit).not.toHaveBeenCalled(); expect(startCollector).not.toHaveBeenCalled();
});

test("notice is audited and collector starts only after binding commit; replay never starts twice", async () => {
  const consent = { ...admission, transcriptNoticeVersion: "live-transcript-v1" };
  const issuedAt = "2026-01-01T00:00:00.000Z";
  live.admit.mockResolvedValueOnce({ sessionId: "known", expiresAt: "2026-01-01T00:05:00.000Z", issuedAt });
  startCollector.mockImplementationOnce((actor, caseId, source) => {
    expect(query.mock.calls.at(-1)[0]).toBe("COMMIT");
    expect(query.mock.calls.some(([sql]) => typeof sql === "string" && sql.includes("INSERT INTO public.case_intake_live_sessions"))).toBe(true);
    expect(actor).toEqual({ id: 42, role: "client" }); expect(caseId).toBe(101);
    expect(source).toMatchObject({ sessionId: "known", issuedAt, originalExpiry: "2026-01-01T00:05:00.000Z", noticeVersion: "live-transcript-v1" });
    return "unavailable";
  });
  const response = await post("/sessions", consent);
  expect(response.status).toBe(200); expect(response.body.transcriptSaving).toBe("unavailable");
  const final = query.mock.calls.find(([sql]) => typeof sql === "string" && sql.includes("UPDATE public.case_intake_receipts SET response=$5::jsonb"));
  const audit = JSON.parse(final[1][4]);
  expect(audit.transcriptNotice).toEqual({ actorId: 42, noticeVersion: "live-transcript-v1", acknowledgedAt: expect.any(String) });
  expect(Number.isFinite(Date.parse(audit.transcriptNotice.acknowledgedAt))).toBe(true);
  prior = { request_hash: digest(consent), response: audit };
  expect((await post("/sessions", consent)).status).toBe(200);
  expect(live.admit).toHaveBeenCalledTimes(1); expect(startCollector).toHaveBeenCalledTimes(1);
});

test("failed post-admission commit never starts collector", async () => {
  live.stop.mockResolvedValueOnce({ phase: "stopped" });
  live.admit.mockImplementationOnce(async () => { c.intake_version = 50; return { sessionId: "known", expiresAt: "2026-12-01T00:00:00Z" }; });
  const response = await post("/sessions", { ...admission, transcriptNoticeVersion: "live-transcript-v1" });
  expect(response.status).toBe(409); expect(startCollector).not.toHaveBeenCalled(); expect(live.stop).toHaveBeenCalledTimes(1);
});

test("Stop dispatch and RAM end notification precede upstream completion and SQL bookkeeping", async () => {
  let resolve;
  live.stop.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  const pending = post("/sessions/known/stop", {}).then(response => response);
  for (let i = 0; i < 30 && !resolve; i++) await new Promise(done => setImmediate(done));
  expect(endCollector).toHaveBeenCalledWith({ id: 42, role: "client" }, 101, "known");
  expect(query).not.toHaveBeenCalled();
  expect(live.stop.mock.invocationCallOrder[0]).toBeLessThan(endCollector.mock.invocationCallOrder[0]);
  resolve({ phase: "stopped" }); expect((await pending).status).toBe(200);
});

test("Prepare establishes RAM end without waiting for review result", async () => {
  c.intake_protocol = "live_v2"; c.status = "INTAKE_STARTED";
  live.call.mockResolvedValueOnce({ phase: "draft_ready" });
  expect((await post("/sessions/known/prepare", { acknowledge_unproven_tail: true })).status).toBe(200);
  expect(endCollector).toHaveBeenCalledWith({ id: 42, role: "client" }, 101, "known");
});

test("terminal initial-offer failure ends capture, but rejected duplicate is not a new voice end", async () => {
  c.intake_protocol = "live_v2"; c.status = "INTAKE_STARTED";
  live.call.mockRejectedValueOnce({ status: 502, code: "LIVE_REQUEST_FAILED" });
  expect((await post("/sessions/known/webrtc/offer", { type: "offer", sdp: "v=0" })).status).toBe(502);
  expect(endCollector).toHaveBeenCalledTimes(1); endCollector.mockClear();
  live.call.mockRejectedValueOnce({ status: 409, code: "LIVE_OFFER_ALREADY_ATTEMPTED" });
  expect((await post("/sessions/known/webrtc/offer", { type: "offer", sdp: "v=0" })).status).toBe(409);
  expect(endCollector).not.toHaveBeenCalled();
});

test.each([false, "true", 1, null])("repeat flag rejects nontrue %j",async value=>{
  expect((await post('/sessions',{...admission,newInterview:value})).status).toBe(422);
  expect(live.admit).not.toHaveBeenCalled();
});
test('limit denial is receipted and replayed even when allowance changes',async()=>{
  allowanceRow={daily:2,daily_retry:'2030-01-01T00:00:00Z'};
  const response=await post('/sessions',admission);
  expect(response.status).toBe(429);expect(response.body.code).toBe('INTERVIEW_DAILY_LIMIT');
  expect(response.headers['retry-after']).toBeDefined();
  const saved=query.mock.calls.find(([sql])=>typeof sql==='string' && sql.includes('INSERT INTO public.case_intake_receipts'));
  prior={request_hash:digest(admission),response:JSON.parse(saved[1][5])};allowanceRow={};
  expect((await post('/sessions',admission)).body).toEqual(response.body);
  expect(live.admit).not.toHaveBeenCalled();
});
test.each([
  [{session_id:'known',phase:'partial'},true],
  [{session_id:'other',phase:'partial'},false],
  [{phase:'partial'},false],
  [{session_id:'known',phase:'pending'},false],
])('only bound terminal stop acknowledgment releases durable active %j',async(result,releases)=>{
  live.stop.mockResolvedValueOnce(result);
  expect((await post('/sessions/known/stop',{})).status).toBe(200);
  expect(query.mock.calls.some(([sql])=>typeof sql==='object' && sql.text.includes('UPDATE public.interview_admissions'))).toBe(releases);
});
