import { jest, describe, test, expect, beforeEach } from "@jest/globals";
import request from "supertest";
import jwt from "jsonwebtoken";

const dbQueryMock = jest.fn();

jest.unstable_mockModule("../../db.js", () => ({
  default: {
    query: dbQueryMock,
  },
}));

const appModule = await import("../helpers/buildTestApp.js");
const { buildTestApp } = appModule;

describe("Integration flow: intake to AI to matching prep", () => {
  let app;
  const token = jwt.sign({ id: 301, email: "flow@test.com", role: "client" }, process.env.JWT_SECRET);

  beforeEach(() => {
    jest.clearAllMocks();
    dbQueryMock.mockReset();
    app = buildTestApp();
  });

  test("test_case_intake_to_ai_processing_flow", async () => {
    dbQueryMock
      .mockResolvedValueOnce({ rows: [{ id: 555 }], rowCount: 1 }) // start: case ownership check
      .mockResolvedValueOnce({
        rows: [
          {
            id: 901,
            session_id: "session-flow-1",
            status: "STARTED",
            created_at: "2026-04-27T10:00:00.000Z",
          },
        ],
        rowCount: 1,
      })
      .mockResolvedValueOnce({
        rows: [{ id: 901, user_id: 301, case_id: 555 }],
        rowCount: 1,
      }) // complete: session ownership lookup
      .mockResolvedValueOnce({ rows: [{ id: 555 }], rowCount: 1 }) // complete: case ownership check
      .mockResolvedValueOnce({
        rows: [
          {
            id: 901,
            case_id: 555,
            session_id: "session-flow-1",
            status: "COMPLETED",
            completed_at: "2026-04-27T10:01:00.000Z",
            completion_source: "fallback",
            result_hash: "result-hash-1",
          },
        ],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });

    const startResponse = await request(app)
      .post("/api/interviews/start")
      .set("Authorization", `Bearer ${token}`)
      .send({
        sessionId: "session-flow-1",
        caseId: 555,
        wsUrl: "wss://voice-agent/session-flow-1",
        language: "English",
      });

    expect(startResponse.status).toBe(201);
    expect(startResponse.body.session.status).toBe("STARTED");

    const completeResponse = await request(app)
      .post("/api/interviews/complete")
      .set("Authorization", `Bearer ${token}`)
      .send({
        sessionId: "session-flow-1",
        caseId: 555,
        transcript: "I need help with unpaid dues from a property dispute.",
        analysis: {
          legal_domain: "property",
          urgency: "high",
        },
      });

    expect(completeResponse.status).toBe(200);
    expect(completeResponse.body.message).toBe("Interview completion persisted");
    expect(completeResponse.body.session.status).toBe("COMPLETED");
    expect(completeResponse.body.session.case_id).toBe(555);
  });
});
