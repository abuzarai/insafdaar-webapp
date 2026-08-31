// Regression tests for audit P1 security boundaries:
//  #1 client KYC self-verify, #2 interviews IDOR, #3 guest-chat impersonation,
//  #4 OTP brute force lockout, #5 SMTP TLS verification, #6 webhook fail-closed + dedupe.
import { jest, describe, test, expect, beforeEach } from "@jest/globals";
import request from "supertest";
import jwt from "jsonwebtoken";
import { createHash } from "crypto";

// Deterministic env BEFORE dotenv.loads and route modules are imported.
process.env.JWT_SECRET = "security-test-jwt-secret";
process.env.VOICE_WEBHOOK_SECRET = "security-test-webhook-secret";

const dbQueryMock = jest.fn();
const dbConnectMock = jest.fn();

jest.unstable_mockModule("../db.js", () => ({
  default: {
    query: dbQueryMock,
    connect: dbConnectMock,
  },
}));

const bcryptCompareMock = jest.fn();
jest.unstable_mockModule("bcryptjs", () => ({
  default: {
    compare: bcryptCompareMock,
    hash: jest.fn(async () => "otp-hash"),
  },
}));

const appModule = await import("./helpers/buildTestApp.js");
const { buildTestApp } = appModule;

function toCanonicalJson(value) {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) {
    return `[${value.map((v) => toCanonicalJson(v)).join(",")}]`;
  }
  if (typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${toCanonicalJson(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function computeResultHash(sessionId, transcript, analysis) {
  const base = `${sessionId || ""}|${transcript || ""}|${toCanonicalJson(analysis || null)}`;
  return createHash("sha256").update(base).digest("hex");
}

describe("P1 security boundaries", () => {
  let app;
  let clientToken;

  beforeEach(() => {
    jest.clearAllMocks();
    dbQueryMock.mockReset();
    dbConnectMock.mockReset();
    bcryptCompareMock.mockReset();
    app = buildTestApp();
    clientToken = jwt.sign({ id: 42, email: "client@test.local", role: "client" }, process.env.JWT_SECRET);
    dbConnectMock.mockResolvedValue({ query: jest.fn(), release: jest.fn() });
  });

  const allSql = () => dbQueryMock.mock.calls.map((c) => String(c[0])).join("\n");

  // ── #1 KYC self-verify ──────────────────────────────────────────
  describe("#1 client cannot self-verify documents", () => {
    test("PUT /profile ignores identityDocStatus/addressProofStatus from the body", async () => {
      dbQueryMock
        .mockResolvedValueOnce({ rows: [{ id: 1 }] }) // upsert client_profiles
        .mockResolvedValueOnce({ rows: [] }); // sync client_details

      const res = await request(app)
        .put("/api/client/profile")
        .set("Authorization", `Bearer ${clientToken}`)
        .send({ profile: { phone: "03001234567", identityDocStatus: "VERIFIED", addressProofStatus: "VERIFIED" } });

      expect(res.status).toBe(200);
      const sql = allSql();
      expect(sql).not.toMatch(/identity_doc_status|address_proof_status|VERIFIED/i);
    });

    test("a plain update never rewrites existing verification status", async () => {
      dbQueryMock
        .mockResolvedValueOnce({ rows: [{ id: 1 }] })
        .mockResolvedValueOnce({ rows: [] });

      const res = await request(app)
        .put("/api/client/profile")
        .set("Authorization", `Bearer ${clientToken}`)
        .send({ profile: { address: "Lahore" } });

      expect(res.status).toBe(200);
      expect(allSql()).not.toMatch(/identity_doc_status|address_proof_status/i);
    });
  });

  // ── #2 interviews IDOR ──────────────────────────────────────────
  describe("#2 interviews are ownership-scoped", () => {
    test("POST /start rejects a case the caller does not own", async () => {
      dbQueryMock.mockResolvedValueOnce({ rows: [] }); // ownership check fails

      const res = await request(app)
        .post("/api/interviews/start")
        .set("Authorization", `Bearer ${clientToken}`)
        .send({ sessionId: "s-1", caseId: 999 });

      expect(res.status).toBe(404);
    });

    test("POST /start accepts an owned case", async () => {
      dbQueryMock
        .mockResolvedValueOnce({ rows: [{ id: 7 }] }) // owned case
        .mockResolvedValueOnce({ rows: [{ id: 1, session_id: "s-1", status: "STARTED", created_at: new Date().toISOString() }] });

      const res = await request(app)
        .post("/api/interviews/start")
        .set("Authorization", `Bearer ${clientToken}`)
        .send({ sessionId: "s-1", caseId: 7 });

      expect(res.status).toBe(201);
    });

    test("GET /:sessionId filters by owner", async () => {
      dbQueryMock.mockResolvedValueOnce({ rows: [] });

      const res = await request(app)
        .get("/api/interviews/s-1")
        .set("Authorization", `Bearer ${clientToken}`);

      expect(res.status).toBe(404);
      expect(allSql()).toMatch(/user_id = \$2/);
    });

    test("GET /case/:caseId filters by owner", async () => {
      dbQueryMock.mockResolvedValueOnce({ rows: [] });

      const res = await request(app)
        .get("/api/interviews/case/7")
        .set("Authorization", `Bearer ${clientToken}`);

      expect(res.status).toBe(200);
      expect(allSql()).toMatch(/user_id = \$2/);
    });

    test("POST /complete rejects a session owned by another user", async () => {
      dbQueryMock.mockResolvedValueOnce({ rows: [{ id: 1, user_id: 99, case_id: 7 }] });

      const res = await request(app)
        .post("/api/interviews/complete")
        .set("Authorization", `Bearer ${clientToken}`)
        .send({ sessionId: "s-1", transcript: "hi" });

      expect(res.status).toBe(403);
    });

    test("POST /complete rejects a target case the caller does not own", async () => {
      dbQueryMock
        .mockResolvedValueOnce({ rows: [] }) // no session row yet
        .mockResolvedValueOnce({ rows: [] }); // case ownership fails

      const res = await request(app)
        .post("/api/interviews/complete")
        .set("Authorization", `Bearer ${clientToken}`)
        .send({ sessionId: "s-1", caseId: 999, transcript: "hi" });

      expect(res.status).toBe(403);
    });

    test("POST /complete persists for an owned session and case", async () => {
      dbQueryMock
        .mockResolvedValueOnce({ rows: [{ id: 1, user_id: 42, case_id: 7 }] }) // session
        .mockResolvedValueOnce({ rows: [{ id: 7 }] }) // owned case
        .mockResolvedValueOnce({ rows: [{ id: 1, case_id: 7, status: "COMPLETED", completed_at: new Date().toISOString(), completion_source: "fallback", result_hash: "h" }] }) // update session
        .mockResolvedValueOnce({ rows: [] }); // update client_cases

      const res = await request(app)
        .post("/api/interviews/complete")
        .set("Authorization", `Bearer ${clientToken}`)
        .send({ sessionId: "s-1", transcript: "hi", analysis: { legal_domain: "civil" } });

      expect(res.status).toBe(200);
    });
  });

  // ── #3 guest-chat impersonation ─────────────────────────────────
  describe("#3 guest chat cannot impersonate users", () => {
    test("x-chat-owner-id with a user: prefix is rejected for guests", async () => {
      const res = await request(app)
        .get("/api/legal-assistant/conversations")
        .set("x-chat-owner-id", "user:5");

      expect(res.status).toBe(400);
      expect(dbQueryMock).not.toHaveBeenCalled();
    });

    test("a plain anonymous owner id is accepted (guest flow intact)", async () => {
      dbQueryMock
        .mockResolvedValueOnce({ rows: [] }) // ensure conversations table
        .mockResolvedValueOnce({ rows: [] }) // ensure index
        .mockResolvedValueOnce({ rows: [] }); // list conversations

      const res = await request(app)
        .get("/api/legal-assistant/conversations")
        .set("x-chat-owner-id", "anon-abc-123");

      expect(res.status).toBe(200);
    });

    test("logged-in users are scoped to their own user: namespace", async () => {
      dbQueryMock.mockResolvedValueOnce({ rows: [] }); // mention: ensure tables already ran

      const res = await request(app)
        .get("/api/legal-assistant/conversations")
        .set("Authorization", `Bearer ${clientToken}`)
        .set("x-chat-owner-id", "user:1"); // header is ignored when a JWT is present

      expect(res.status).toBe(200);
      expect(allSql()).toMatch(/\$1/);
      expect(dbQueryMock.mock.calls[0][1][0]).toBe("user:42");
    });
  });

  // ── #4 OTP brute-force lockout ──────────────────────────────────
  describe("#4 OTP verification has a lockout", () => {
    const future = new Date(Date.now() + 600000).toISOString();
    const otpRow = (overrides = {}) => ({
      id: 5,
      otp_hash: "h",
      expires_at: future,
      used: false,
      attempts: 0,
      locked_until: null,
      ...overrides,
    });

    test("a wrong OTP increments the attempt counter", async () => {
      dbQueryMock
        .mockResolvedValueOnce({ rows: [] }) // ensure lockout columns (first call)
        .mockResolvedValueOnce({ rows: [{ id: 1, email_verified: false }] }) // user
        .mockResolvedValueOnce({ rows: [otpRow({ attempts: 1 })] }) // latest otp
        .mockResolvedValueOnce({ rows: [] }); // increment attempts
      bcryptCompareMock.mockResolvedValue(false);

      const res = await request(app)
        .post("/api/auth/verify-otp")
        .send({ email: "a@b.co", otp: "000000" });

      expect(res.status).toBe(400);
      expect(allSql()).toMatch(/SET attempts=\$1/);
    });

    test("reaching the attempt cap locks the OTP and returns 429", async () => {
      dbQueryMock
        .mockResolvedValueOnce({ rows: [{ id: 1, email_verified: false }] }) // user (columns already ensured)
        .mockResolvedValueOnce({ rows: [otpRow({ attempts: 4 })] }) // latest otp
        .mockResolvedValueOnce({ rows: [] }); // lock
      bcryptCompareMock.mockResolvedValue(false);

      const res = await request(app)
        .post("/api/auth/verify-otp")
        .send({ email: "a@b.co", otp: "000000" });

      expect(res.status).toBe(429);
      expect(allSql()).toMatch(/locked_until/);
    });

    test("a locked OTP is rejected before comparison", async () => {
      dbQueryMock
        .mockResolvedValueOnce({ rows: [{ id: 1, email_verified: false }] })
        .mockResolvedValueOnce({ rows: [otpRow({ attempts: 5, locked_until: future })] });

      const res = await request(app)
        .post("/api/auth/verify-otp")
        .send({ email: "a@b.co", otp: "000000" });

      expect(res.status).toBe(429);
      expect(bcryptCompareMock).not.toHaveBeenCalled();
    });

    test("a correct OTP still verifies", async () => {
      dbQueryMock
        .mockResolvedValueOnce({ rows: [{ id: 1, email_verified: false }] })
        .mockResolvedValueOnce({ rows: [otpRow()] }) // latest otp
        .mockResolvedValueOnce({ rows: [] }) // mark user verified
        .mockResolvedValueOnce({ rows: [] }); // mark otp used
      bcryptCompareMock.mockResolvedValue(true);

      const res = await request(app)
        .post("/api/auth/verify-otp")
        .send({ email: "a@b.co", otp: "123456" });

      expect(res.status).toBe(200);
    });
  });

  // ── #5 SMTP TLS verification ────────────────────────────────────
  describe("#5 SMTP TLS verification is enabled", () => {
    test("transporter does not disable certificate verification", async () => {
      const { transporter } = await import("../utils/mailer.js");
      expect(transporter.options.tls?.rejectUnauthorized).not.toBe(false);
    });
  });

  // ── #6 webhook fail-closed + idempotency ────────────────────────
  describe("#6 webhook fails closed and dedupes", () => {
    const body = { session_id: "s-9", transcript: "hello", analysis: { a: 1 } };
    const hash = computeResultHash("s-9", "hello", { a: 1 });

    test("rejects when no secret header is sent", async () => {
      const res = await request(app).post("/api/webhooks/interview-complete").send(body);
      expect(res.status).toBe(403);
      expect(dbQueryMock).not.toHaveBeenCalled();
    });

    test("rejects a wrong secret", async () => {
      const res = await request(app)
        .post("/api/webhooks/interview-complete")
        .set("x-webhook-secret", "wrong")
        .send(body);
      expect(res.status).toBe(403);
    });

    test("processes a fresh delivery", async () => {
      dbQueryMock
        .mockResolvedValueOnce({ rows: [] }) // duplicate check: no existing row
        .mockResolvedValueOnce({ rows: [{ id: 1, case_id: null, completion_source: "webhook", result_hash: hash }] }) // update session
        .mockResolvedValueOnce({ rows: [] }); // nothing to update
      // (client_cases update skipped: case_id is null)

      const res = await request(app)
        .post("/api/webhooks/interview-complete")
        .set("x-webhook-secret", "security-test-webhook-secret")
        .send(body);

      expect(res.status).toBe(200);
      expect(res.body.duplicated).toBeUndefined();
    });

    test("ignores a duplicate delivery with the same result hash", async () => {
      dbQueryMock.mockResolvedValueOnce({ rows: [{ result_hash: hash }] }); // duplicate check hits

      const res = await request(app)
        .post("/api/webhooks/interview-complete")
        .set("x-webhook-secret", "security-test-webhook-secret")
        .send(body);

      expect(res.status).toBe(200);
      expect(res.body.duplicated).toBe(true);
      expect(dbQueryMock.mock.calls.length).toBe(1); // no UPDATE issued
    });
  });
});