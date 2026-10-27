// Real Express -> real LiveIntakeClient -> loopback HTTP contract fixture.
// No provider, real user/account, operational environment file or database.
import { jest, test, expect, beforeAll, afterAll, beforeEach } from "@jest/globals";
import http from "node:http";
import express from "express";
import request from "supertest";

const actor = { id: 42, role: "client" };
const fixtureCase = { id: 101, user_id: 42, intake_protocol: "live_v2", status: "INTAKE_STARTED", intake_version: 1 };
const query = jest.fn(async sql => {
  const text = typeof sql === "string" ? sql : sql.text;
  if (text.includes("SELECT * FROM public.client_cases")) return { rows: [fixtureCase] };
  if (text.includes("SELECT session_id FROM public.case_intake_live_sessions")) return { rows: [{ session_id: "contract-session" }] };
  return { rows: [], rowCount: 1 };
});
jest.unstable_mockModule("../db.js", () => ({ default: { query, connect: async () => ({ query, release() {} }) } }));
jest.unstable_mockModule("../middleware/authMiddleware.js", () => ({ authMiddleware: (req, res, next) => { req.user = actor; next(); } }));
const { liveIntakeClient } = await import("../services/liveIntakeClient.js");
const { default: routes } = await import("../routes/reviewedIntake.routes.js");
const app = express(); app.use(express.json()); app.use("/cases/:caseId/intake", routes);
const capability = "x".repeat(43);
let upstream, received, rejectOffer;
beforeAll(async () => {
  upstream = http.createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
    received.push({ path: req.url, method: req.method, body });
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/api/v1/live/sessions") {
      if (req.headers["x-live-bootstrap-secret"] !== "contract-bootstrap-" + "x".repeat(32)) { res.statusCode = 401; return res.end("{}"); }
      if (Object.keys(body).join() !== "processing_consent" || body.processing_consent !== true) { res.statusCode = 422; return res.end("{}"); }
      return res.end(JSON.stringify({ session_id: "contract-session", capability, expires_at: new Date(Date.now() + 120000).toISOString() }));
    }
    if (req.url !== "/api/v1/live/sessions/contract-session/webrtc/offer" || req.headers.authorization !== `Bearer ${capability}`) { res.statusCode = 401; return res.end("{}"); }
    if (req.method === "PATCH") {
      const valid = Object.keys(body).sort().join() === "candidates,pc_id" && body.pc_id === "contract-peer" &&
        Array.isArray(body.candidates) && body.candidates.length > 0 && body.candidates.length <= 32 &&
        body.candidates.every(c => Object.keys(c).sort().join() === "candidate,sdp_mid,sdp_mline_index" &&
          typeof c.candidate === "string" && typeof c.sdp_mid === "string" && Number.isInteger(c.sdp_mline_index));
      if (!valid) { res.statusCode = 422; return res.end("{}"); }
      return res.end(JSON.stringify({ status: "accepted" }));
    }
    // Same canonical initial-offer boundary as the actual Python LiveOffer DTO.
    if (rejectOffer || Object.keys(body).sort().join() !== "sdp,type" || body.type !== "offer") {
      res.statusCode = 422; return res.end(JSON.stringify({ detail: "private fixture rejection, must not be relayed" }));
    }
    res.end(JSON.stringify({ sdp: "v=0\r\n", type: "answer", pc_id: "contract-peer" }));
  });
  await new Promise(resolve => upstream.listen(0, "127.0.0.1", resolve));
});
afterAll(async () => { await new Promise(resolve => upstream.close(resolve)); });
beforeEach(async () => {
  received = []; rejectOffer = false;
  liveIntakeClient.sessions.clear(); liveIntakeClient.admitting = false;
  process.env.INTAKE_V2_ENABLED = "true";
  process.env.VOICE_LIVE_INTERNAL_URL = `http://127.0.0.1:${upstream.address().port}`;
  process.env.VOICE_LIVE_BOOTSTRAP_SECRET = "contract-bootstrap-" + "x".repeat(32);
  await liveIntakeClient.admit(actor, 101);
});
const sdkOffer = { sdp: "v=0\r\n", type: "offer", pc_id: null, restart_pc: false };
const offer = body => request(app).post("/cases/101/intake/sessions/contract-session/webrtc/offer").send(body);

test("SDK initial offer crosses actual Express/HTTP bridge as canonical JSON; only one initial attempt", async () => {
  const first = await offer(sdkOffer);
  expect(first.status).toBe(200);
  expect(first.body).toEqual({ sdp: "v=0\r\n", type: "answer", pc_id: "contract-peer" });
  expect(first.headers["cache-control"]).toBe("no-store");
  expect(received[1]).toEqual({ path: "/api/v1/live/sessions/contract-session/webrtc/offer", method: "POST", body: { sdp: sdkOffer.sdp, type: "offer" } });
  const repeated = await offer(sdkOffer);
  expect(repeated.status).toBe(409); expect(repeated.body.code).toBe("LIVE_OFFER_ALREADY_ATTEMPTED");
  expect(received).toHaveLength(2); // Bootstrap plus one offer, not another model attempt.
});

test("SDK reconnect/foreign peer metadata is rejected locally without consuming the initial attempt", async () => {
  expect((await offer({ ...sdkOffer, restart_pc: true })).status).toBe(422);
  expect((await offer({ ...sdkOffer, pc_id: "foreign-peer" })).status).toBe(422);
  expect(received).toHaveLength(1);
  expect((await offer(sdkOffer)).status).toBe(200);
  expect(received).toHaveLength(2);
});

test("SDK candidate PATCH crosses the same authenticated bridge with strict snake-case fields", async () => {
  expect((await offer(sdkOffer)).status).toBe(200);
  const payload = { pc_id: "contract-peer", candidates: [{ candidate: "offline-candidate", sdp_mid: "0", sdp_mline_index: 0 }] };
  const result = await request(app).patch("/cases/101/intake/sessions/contract-session/webrtc/offer").send(payload);
  expect(result.status).toBe(200); expect(result.body).toEqual({ status: "accepted" });
  expect(received[2]).toEqual({ path: "/api/v1/live/sessions/contract-session/webrtc/offer", method: "PATCH", body: payload });
  expect(received).toHaveLength(3);
});

test("host signaling envelope remains explicitly stricter than Python's SDP bound", async () => {
  const result = await offer({ sdp: "x".repeat(65536), type: "offer" });
  expect(result.status).toBe(413); expect(result.body.code).toBe("SIGNALING_TOO_LARGE");
  expect(received).toHaveLength(1);
});

test("actual upstream HTTP 422 stays deterministic, redacted and non-repeatable", async () => {
  rejectOffer = true;
  const rejected = await offer(sdkOffer);
  expect(rejected.status).toBe(422); expect(rejected.body.code).toBe("LIVE_REQUEST_REJECTED");
  expect(JSON.stringify(rejected.body)).not.toContain("private fixture");
  expect((await offer(sdkOffer)).status).toBe(409);
  expect(received).toHaveLength(2);
});
