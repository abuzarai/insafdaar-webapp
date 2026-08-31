import { jest, describe, test, expect, beforeEach } from "@jest/globals";
import request from "supertest";
import jwt from "jsonwebtoken";

const dbQueryMock = jest.fn();

jest.unstable_mockModule("../db.js", () => ({
  default: {
    query: dbQueryMock,
  },
}));

const appModule = await import("./helpers/buildTestApp.js");
const { buildTestApp } = appModule;

describe("Case initiation and AI processing API tests", () => {
  let app;
  const authToken = jwt.sign(
    { id: 42, email: "client@example.com", role: "client" },
    process.env.JWT_SECRET
  );

  beforeEach(() => {
    jest.clearAllMocks();
    dbQueryMock.mockReset();
    app = buildTestApp();
    global.fetch = jest.fn();
    process.env.LEGAL_ASSISTANT_GUEST_PROMPT_LIMIT = "3";
  });

  test("test_interview_start_session_success", async () => {
    dbQueryMock
      .mockResolvedValueOnce({ rows: [{ id: 500 }], rowCount: 1 }) // case ownership check
      .mockResolvedValueOnce({
        rows: [
          {
            id: 11,
            session_id: "sess-1001",
            status: "STARTED",
            created_at: "2026-04-27T10:00:00.000Z",
          },
        ],
        rowCount: 1,
      });

    const payload = {
      sessionId: "sess-1001",
      caseId: 500,
      wsUrl: "wss://voice.insafdaar.ai/session/sess-1001",
      language: "English",
    };

    const response = await request(app)
      .post("/api/interviews/start")
      .set("Authorization", `Bearer ${authToken}`)
      .send(payload);

    expect(response.status).toBe(201);
    expect(response.body.message).toBe("Session stored");
    expect(response.body.session).toMatchObject({
      session_id: "sess-1001",
      status: "STARTED",
    });
  });

  test("test_interview_start_missing_session_id", async () => {
    const response = await request(app)
      .post("/api/interviews/start")
      .set("Authorization", `Bearer ${authToken}`)
      .send({ caseId: 500 });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("sessionId is required");
  });

  test("test_interview_complete_persists_fallback_data", async () => {
    dbQueryMock
      .mockResolvedValueOnce({
        rows: [{ id: 89, user_id: 42, case_id: 777 }],
        rowCount: 1,
      }) // session ownership lookup
      .mockResolvedValueOnce({ rows: [{ id: 777 }], rowCount: 1 }) // case ownership check
      .mockResolvedValueOnce({
        rows: [
          {
            id: 89,
            case_id: 777,
            session_id: "sess-5005",
            status: "COMPLETED",
            completed_at: "2026-04-27T09:00:00.000Z",
            completion_source: "fallback",
            result_hash: "abc123hash",
          },
        ],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });

    const payload = {
      sessionId: "sess-5005",
      caseId: 777,
      transcript: "I need legal help regarding tenancy eviction notice in Lahore.",
      analysis: {
        legal_domain: "tenant law",
        urgency: "medium",
      },
      audioUrl: "https://cdn.example.com/audio/sess-5005.wav",
    };

    const response = await request(app)
      .post("/api/interviews/complete")
      .set("Authorization", `Bearer ${authToken}`)
      .send(payload);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      message: "Interview completion persisted",
      source: "fallback",
    });
    expect(response.body.session.status).toBe("COMPLETED");
  });

  test("test_legal_assistant_query_guest_success", async () => {
    dbQueryMock.mockImplementation(async (sql) => {
      const queryText = String(sql || "");
      if (queryText.includes("legal_assistant_guest_usage") && queryText.includes("SELECT")) {
        return { rows: [{ prompt_count: 1 }], rowCount: 1 };
      }
      if (queryText.includes("legal_assistant_guest_usage") && queryText.includes("INSERT INTO")) {
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });

    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        query: "What are tenancy rights in Pakistan?",
        mode: "legal",
        answer: "Under Pakistani tenancy law, eviction requires legal notice.",
        citations: ["Rent Restriction Ordinance"],
        sources: [{ title: "Punjab Rent Law", link: "https://example.org/law" }],
      }),
    });

    const response = await request(app)
      .post("/api/legal-assistant/query")
      .set("x-chat-owner-id", "guest-user-1")
      .send({ query: "What are tenancy rights in Pakistan?", k: 3 });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      mode: "legal",
      answer: expect.stringContaining("tenancy law"),
    });
    expect(response.body.citations).toHaveLength(1);
  });

  test("test_legal_assistant_guest_limit_reached", async () => {
    process.env.LEGAL_ASSISTANT_GUEST_PROMPT_LIMIT = "1";
    dbQueryMock.mockImplementation(async (sql) => {
      const queryText = String(sql || "");
      if (queryText.includes("legal_assistant_guest_usage") && queryText.includes("SELECT")) {
        return { rows: [{ prompt_count: 1 }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });

    const response = await request(app)
      .post("/api/legal-assistant/query")
      .set("x-chat-owner-id", "guest-user-2")
      .send({ query: "Need legal guidance", k: 5 });

    expect(response.status).toBe(403);
    expect(response.body.code).toBe("GUEST_LIMIT_REACHED");
  });

  test("test_create_and_list_conversation_success", async () => {
    dbQueryMock.mockImplementation(async (sql) => {
      const queryText = String(sql || "");
      if (queryText.includes("INSERT INTO legal_assistant_conversations")) {
        return {
          rows: [
            {
              id: "conv-1",
              title: "New tenancy dispute",
              messages: [{ role: "user", content: "I got an eviction notice" }],
              created_at: "2026-04-27T10:00:00.000Z",
              updated_at: "2026-04-27T10:00:00.000Z",
            },
          ],
          rowCount: 1,
        };
      }
      if (queryText.includes("FROM legal_assistant_conversations") && queryText.includes("ORDER BY")) {
        return {
          rows: [
            {
              id: "conv-1",
              title: "New tenancy dispute",
              created_at: "2026-04-27T10:00:00.000Z",
              updated_at: "2026-04-27T10:00:00.000Z",
            },
          ],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    });

    const createResponse = await request(app)
      .post("/api/legal-assistant/conversations")
      .set("x-chat-owner-id", "guest-user-3")
      .send({
        title: "New tenancy dispute",
        messages: [{ role: "user", content: "I got an eviction notice" }],
      });

    expect(createResponse.status).toBe(201);
    expect(createResponse.body.id).toEqual(expect.any(String));

    const listResponse = await request(app)
      .get("/api/legal-assistant/conversations")
      .set("x-chat-owner-id", "guest-user-3");

    expect(listResponse.status).toBe(200);
    expect(Array.isArray(listResponse.body)).toBe(true);
    expect(listResponse.body[0]).toMatchObject({ id: "conv-1" });
  });
});
