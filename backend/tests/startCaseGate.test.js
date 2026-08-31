// Regression test for audit #20: a client cannot self-mark a case
// interview_completed (skipping the AI intake) without a real completed
// voice session.
import { jest, describe, test, expect, beforeEach } from "@jest/globals";
import request from "supertest";
import express from "express";
import jwt from "jsonwebtoken";

process.env.JWT_SECRET = "gate-test-jwt-secret";

const dbQueryMock = jest.fn();

jest.unstable_mockModule("../db.js", () => ({
  default: { query: dbQueryMock },
}));

jest.unstable_mockModule("../services/documentExtraction.service.js", () => ({
  enqueueDocumentExtractionJobs: jest.fn(async () => {}),
}));

const { default: startCaseRoutes } = await import("../routes/clientDashboard/startCase/startCase.routes.js");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/client/dashboard/start-case", startCaseRoutes);
  return app;
}

describe("#20 interview_completed self-mark gate", () => {
  let app;
  const token = jwt.sign({ id: 42, email: "c@t.co", role: "client" }, process.env.JWT_SECRET);

  beforeEach(() => {
    jest.clearAllMocks();
    dbQueryMock.mockReset();
    app = buildApp();
  });

  test("rejects marking complete when no completed voice session exists", async () => {
    dbQueryMock
      .mockResolvedValueOnce({ rows: [] }) // ensurePreferenceColumns (ALTER)
      .mockResolvedValueOnce({ rows: [] }); // session gate: none found

    const res = await request(app)
      .post("/api/client/dashboard/start-case/interview/complete")
      .set("Authorization", `Bearer ${token}`)
      .send({ caseId: 5, legalDomain: "civil" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INTERVIEW_NOT_COMPLETED");
    expect(dbQueryMock.mock.calls[1][0]).toMatch(/case_intake_sessions/);
  });

  test("allows marking complete only after a completed session is persisted", async () => {
    // ensurePreferenceColumns already ran in the first test (module cache).
    dbQueryMock
      .mockResolvedValueOnce({ rows: [{ done: 1 }] }) // session gate: completed session exists
      .mockResolvedValueOnce({
        rows: [{ id: 5, status: "MATCHING_REVIEW", interview_completed: true, legal_domain: "civil" }],
      }); // update client_cases

    const res = await request(app)
      .post("/api/client/dashboard/start-case/interview/complete")
      .set("Authorization", `Bearer ${token}`)
      .send({ caseId: 5, legalDomain: "civil" });

    expect(res.status).toBe(200);
    expect(res.body.case.status).toBe("MATCHING_REVIEW");
    expect(res.body.case.interview_completed).toBe(true);
  });

  test("a session without transcript/analysis never satisfies the gate", async () => {
    dbQueryMock
      .mockResolvedValueOnce({ rows: [] }) // ensurePreferenceColumns (ALTER)
      .mockResolvedValueOnce({ rows: [] }); // gate: session row exists but was never populated

    const res = await request(app)
      .post("/api/client/dashboard/start-case/interview/complete")
      .set("Authorization", `Bearer ${token}`)
      .send({ caseId: 5 });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INTERVIEW_NOT_COMPLETED");
  });
});