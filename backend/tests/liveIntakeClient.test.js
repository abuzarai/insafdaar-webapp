import { jest, test, expect, beforeEach } from "@jest/globals";
const query = jest.fn(() => { throw new Error("Database forbidden"); });
jest.unstable_mockModule("../db.js", () => ({ default: { query } }));
const { LiveIntakeClient } = await import("../services/liveIntakeClient.js");
let bridge, fetchMock;
const actor = { id: 42 };
const issued = () => ({ session_id: "owned-session", capability: "a".repeat(43), expires_at: new Date(Date.now() + 120000).toISOString() });
beforeEach(() => {
  bridge = new LiveIntakeClient();
  process.env.VOICE_LIVE_INTERNAL_URL = "http://voice.invalid";
  process.env.VOICE_LIVE_BOOTSTRAP_SECRET = "fictional-bootstrap-secret-0000000000";
  fetchMock = jest.spyOn(globalThis, "fetch").mockImplementation(() => { throw new Error("Unmocked outbound network forbidden"); });
});
const respond = value => fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(value)));

test("admission retains capability only in process memory", async () => {
  respond(issued()); const result = await bridge.admit(actor, 101);
  expect(result).not.toHaveProperty("capability");
  expect(bridge.sessions.get(result.sessionId).capability).toBe("a".repeat(43));
  const [, options] = fetchMock.mock.calls[0];
  expect(options.redirect).toBe("error"); expect(options.cache).toBe("no-store");
  expect(JSON.parse(options.body)).toEqual({ processing_consent: true });
});

test("foreign safety stop cannot delete another user's capability", async () => {
  respond(issued()); const result = await bridge.admit(actor, 101);
  await expect(bridge.stop({ id: 43 }, 101, result.sessionId)).rejects.toMatchObject({ status: 404 });
  expect(bridge.sessions.has(result.sessionId)).toBe(true);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test("safety stop works without database access and clears local capability", async () => {
  respond(issued()); const result = await bridge.admit(actor, 101); respond({ phase: "partial" });
  await bridge.stop(actor, 101, result.sessionId);
  expect(bridge.sessions.size).toBe(0); expect(query).not.toHaveBeenCalled();
});

test("unknown network outcome is never retried", async () => {
  await expect(bridge.admit(actor, 101)).rejects.toMatchObject({ code: "LIVE_REQUEST_FAILED" });
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test("local admission is bounded to one active capability", async () => {
  respond(issued()); await bridge.admit(actor, 101);
  await expect(bridge.admit({ id: 43 }, 102)).rejects.toMatchObject({ code: "LIVE_BUSY" });
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test("process restart loses capability rather than reconstructing authority from caller data", async () => {
  respond(issued()); const result = await bridge.admit(actor, 101);
  await expect(new LiveIntakeClient().call(actor, 101, result.sessionId, "audio-draft")).rejects.toMatchObject({ status: 404 });
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test("expired session refuses another operation", async () => {
  respond(issued()); const result = await bridge.admit(actor, 101);
  bridge.sessions.get(result.sessionId).expiresAt = Date.now() - 1;
  await expect(bridge.call(actor, 101, result.sessionId, "audio-draft")).rejects.toMatchObject({ code: "LIVE_SESSION_EXPIRED" });
});

test("oversized upstream responses are bounded", async () => {
  fetchMock.mockResolvedValueOnce(new Response("a".repeat(100001)));
  await expect(bridge.admit(actor, 101)).rejects.toMatchObject({ code: "LIVE_RESPONSE_TOO_LARGE" });
});

test.each([400, 401, 403, 404, 409, 413, 415, 422, 429])("trusted admission HTTP %i stays a definite rejection, not a retryable 502", async status => {
  fetchMock.mockResolvedValueOnce(new Response("private upstream body must not escape", { status }));
  await expect(bridge.admit(actor, 101)).rejects.toMatchObject({ status, definitiveAdmissionRejection: true,
    code: status === 429 ? "LIVE_ADMISSION_RATE_LIMITED" : "LIVE_REQUEST_REJECTED" });
  expect(bridge.sessions.size).toBe(0); expect(fetchMock).toHaveBeenCalledTimes(1);
});

test("upstream signaling validation is not mislabeled as gateway failure", async () => {
  respond(issued()); await bridge.admit(actor, 101);
  fetchMock.mockResolvedValueOnce(new Response("private rejection", { status: 422 }));
  await expect(bridge.call(actor, 101, "owned-session", "webrtc/offer", "POST", { sdp: "v=0", type: "offer" })).rejects.toMatchObject({ status: 422, code: "LIVE_REQUEST_REJECTED" });
  await expect(bridge.call(actor, 101, "owned-session", "webrtc/offer", "POST", { sdp: "v=0", type: "offer" })).rejects.toMatchObject({ status: 409, code: "LIVE_OFFER_ALREADY_ATTEMPTED" });
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

test("concurrent SDK offers cannot create a second upstream attempt", async () => {
  respond(issued()); await bridge.admit(actor, 101);
  let finish; fetchMock.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const first = bridge.call(actor, 101, "owned-session", "webrtc/offer", "POST", { sdp: "v=0", type: "offer" });
  await expect(bridge.call(actor, 101, "owned-session", "webrtc/offer", "POST", { sdp: "v=0", type: "offer" })).rejects.toMatchObject({ status: 409 });
  finish(new Response(JSON.stringify({ type: "answer", sdp: "v=0", pc_id: "owned" }))); await first;
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

test("network ambiguity still quarantines admission and is never called a definite rejection", async () => {
  await expect(bridge.admit(actor, 101)).rejects.toMatchObject({ status: 502, code: "LIVE_REQUEST_FAILED" });
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test("invalid internal URL fails without a network request", async () => {
  process.env.VOICE_LIVE_INTERNAL_URL = "file:///tmp/not-a-service";
  await expect(bridge.admit(actor, 101)).rejects.toMatchObject({ code: "LIVE_NOT_CONFIGURED" });
  expect(fetchMock).not.toHaveBeenCalled();
});

test.each([500, 502, 503])("admission HTTP %i is uncertain, not an authoritative rejection", async status => {
  fetchMock.mockResolvedValueOnce(new Response("private upstream failure", { status }));
  let failure;
  try { await bridge.admit(actor, 101); } catch (error) { failure = error; }
  expect(failure).toMatchObject({ status: status === 503 ? 503 : 502, code: "LIVE_REQUEST_REJECTED" });
  expect(failure.definitiveAdmissionRejection).toBe(false);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test("uncertain initial offer consumes its attempt but still permits candidate PATCH and Stop", async () => {
  respond(issued()); await bridge.admit(actor, 101);
  await expect(bridge.call(actor, 101, "owned-session", "webrtc/offer", "POST", { sdp: "v=0", type: "offer" })).rejects.toMatchObject({ code: "LIVE_REQUEST_FAILED" });
  await expect(bridge.call(actor, 101, "owned-session", "webrtc/offer", "POST", { sdp: "v=0", type: "offer" })).rejects.toMatchObject({ code: "LIVE_OFFER_ALREADY_ATTEMPTED" });
  const patch = { pc_id: "owned-peer", candidates: [{ candidate: "", sdp_mid: "0", sdp_mline_index: 0 }] };
  respond({ status: "accepted" });
  await bridge.call(actor, 101, "owned-session", "webrtc/offer", "PATCH", patch);
  expect(fetchMock.mock.calls[2][1].method).toBe("PATCH");
  expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toEqual(patch);
  respond({ phase: "partial" }); await bridge.stop(actor, 101, "owned-session");
  expect(fetchMock).toHaveBeenCalledTimes(4); expect(bridge.sessions.size).toBe(0);
});

test("transcript-only handle survives Stop but cannot restore live operation authority", async () => {
  respond(issued()); const result = await bridge.admit(actor, 101);
  const reader = bridge.transcriptReader(actor, 101, result.sessionId);
  respond({ phase: "stopped" }); await bridge.stop(actor, 101, result.sessionId);
  respond({ synthetic: true }); expect(await reader.read(7)).toEqual({ synthetic: true });
  const [url, options] = fetchMock.mock.calls.at(-1);
  expect(url.pathname).toBe("/api/v1/live/sessions/owned-session/transcript/read");
  expect(options.method).toBe("POST"); expect(JSON.parse(options.body)).toEqual({ after_sequence: 7 });
  expect(options.headers.Authorization).toBe(`Bearer ${"a".repeat(43)}`);
  expect(options.redirect).toBe("error"); expect(options.credentials).toBe("omit");
  await expect(bridge.call(actor, 101, result.sessionId, "audio-draft")).rejects.toMatchObject({ status: 404 });
  expect(() => bridge.transcriptReader(actor, 101, result.sessionId)).toThrow();
  reader.clear(); expect(() => reader.read(7)).toThrow();
});

test("transcript read has separate 32KiB response boundary", async () => {
  respond(issued()); const result = await bridge.admit(actor, 101);
  const reader = bridge.transcriptReader(actor, 101, result.sessionId);
  fetchMock.mockResolvedValueOnce(new Response("x".repeat(32769)));
  await expect(reader.read(0)).rejects.toMatchObject({ code: "LIVE_RESPONSE_TOO_LARGE" });
  reader.clear();
});

test("transcript handle and original session authority independently expire at original TTL", async () => {
  jest.useFakeTimers();
  try {
    respond({ ...issued(), expires_at: new Date(Date.now() + 1000).toISOString() });
    const result = await bridge.admit(actor, 101);
    const reader = bridge.transcriptReader(actor, 101, result.sessionId);
    await jest.advanceTimersByTimeAsync(1000);
    expect(bridge.sessions.size).toBe(0); expect(() => reader.read(0)).toThrow();
  } finally { jest.useRealTimers(); }
});

test("read timeout is bounded to five seconds and original remaining TTL", async () => {
  jest.useFakeTimers();
  try {
    respond({ ...issued(), expires_at: new Date(Date.now() + 2000).toISOString() });
    const result = await bridge.admit(actor, 101), reader = bridge.transcriptReader(actor, 101, result.sessionId);
    const timeout = jest.spyOn(AbortSignal, "timeout"); respond({ synthetic: true }); await reader.read(0);
    expect(timeout).toHaveBeenLastCalledWith(2000); timeout.mockRestore(); reader.clear();
  } finally { jest.useRealTimers(); }
});

test("Prepare is reserved once even after an ambiguous provider outcome", async () => {
  respond(issued()); await bridge.admit(actor, 101);
  await expect(bridge.call(actor, 101, "owned-session", "audio-draft", "POST", {})).rejects.toMatchObject({ code: "LIVE_REQUEST_FAILED" });
  await expect(bridge.call(actor, 101, "owned-session", "audio-draft", "POST", {})).rejects.toMatchObject({ code: "LIVE_PREPARE_ALREADY_ATTEMPTED" });
  expect(fetchMock).toHaveBeenCalledTimes(2);
});
