import { jest, test, expect, beforeEach } from "@jest/globals";
import express from "express";
import request from "supertest";
let c, accepted, run;
const query = jest.fn(async (sql, params = []) => {
  const q = sql.replace(/\s+/g, " ").trim();
  if (q.includes("JOIN public.case_intake_revisions")) return { rows: accepted ? [accepted] : [] };
  if (q.startsWith("SELECT 1 FROM case_intake_sessions")) return { rows: [] };
  if (q.includes("FROM public.users")) return { rows: [] };
  if (q.includes("FROM public.client_cases") || q.startsWith("SELECT id, intake_protocol FROM client_cases")) return { rows: [c] };
  if (q.includes("FROM case_intake_sessions")) return { rows: [{ id: 7, user_id: 42, case_id: 101, intake_protocol: "live_v2" }] };
  if (q.includes("FROM public.case_matching_runs")) return { rows: run ? [run] : [] };
  if (q.includes("INSERT INTO public.case_matching_runs")) return { rows: [{ id: 900, input_snapshot: JSON.parse(params[3]) }] };
  return { rows: [], rowCount: 0 };
});
const release = jest.fn();
const pool = { query, connect: jest.fn(async () => ({ query, release })) };
jest.unstable_mockModule("../db.js", () => ({ default: pool }));
jest.unstable_mockModule("../middleware/authMiddleware.js", () => ({ authMiddleware: (req, res, next) => {
  req.user = { id: 42, role: "client" }; next();
} }));
jest.unstable_mockModule("../services/documentExtraction.service.js", () => ({ enqueueDocumentExtractionJobs: jest.fn() }));
jest.unstable_mockModule("../utils/mailer.js", () => ({ sendNotificationEmail: jest.fn(() => { throw new Error("Email prohibited in offline tests"); }) }));
jest.unstable_mockModule("../services/liveIntakeClient.js", () => ({ liveIntakeClient: {} }));
const { default: clientRoutes } = await import("../routes/clientDashboard/startCase/startCase.routes.js");
const { default: interviews } = await import("../routes/interviews.js");
const { default: webhooks } = await import("../routes/webhooks.js");
const { adminAssignAdvocateToCase, adminListCaseMatchCandidates } = await import("../controllers/admin/client-access/start-case/startCase.admin.controller.js");
const app = express(); app.use(express.json());
app.use((req, res, next) => { req.user = { id: 42, role: "admin" }; next(); });
app.use("/client", clientRoutes); app.use("/interviews", interviews); app.use("/webhooks", webhooks);
app.post("/admin/assign", adminAssignAdvocateToCase); app.get("/admin/candidates", adminListCaseMatchCandidates);
beforeEach(() => {
  query.mockClear(); release.mockClear(); pool.connect.mockClear();
  c = { id: 101, user_id: 42, intake_protocol: "live_v2", intake_version: 3, status: "INTAKE_STARTED", interview_completed: false, submitted_intake_revision_id: null };
  accepted = null; run = null; process.env.VOICE_WEBHOOK_SECRET = "synthetic-only";
});
const mutations = () => query.mock.calls.filter(([sql]) => /^\s*(INSERT|UPDATE|DELETE)/.test(sql));
function submitted() {
  c.status = "MATCHING_REVIEW"; c.interview_completed = true; c.submitted_intake_revision_id = "submitted-revision";
  accepted = { id: "submitted-revision", content_hash: "a".repeat(64), reviewed_data: {
    issue_summary: "Client-reviewed fictional issue", primary_language: "mixed", legal_domain: "other", facts: {}, key_entities: {} },
    source_proposal: { analysis: { issue_summary: "Unreviewed model description" } }, created_at: "2026-01-01" };
}

test.each([
  ["/client/draft", { caseId: 101, description: "Overwrite attempt", language: "Urdu" }],
  ["/client/ai/start", { caseId: 101 }],
  ["/interviews/start", { caseId: 101, sessionId: "fictional" }],
  ["/interviews/complete", { caseId: 101, sessionId: "fictional", analysis: { issue_summary: "Unreviewed" } }],
])("%s cannot mutate reviewed intake through a legacy path", async (path, body) => {
  const result = await request(app).post(path).send(body);
  expect(result.status).toBe(409); expect(result.body.code).toBe("INTAKE_V2_ROUTE_REQUIRED"); expect(mutations()).toHaveLength(0);
});

test("legacy mark-complete cannot promote a reviewed case", async () => {
  const result = await request(app).post("/client/interview/complete").send({ caseId: 101 });
  expect(result.status).toBe(400); expect(result.body.code).toBe("INTERVIEW_NOT_COMPLETED");
  expect(query.mock.calls[0][0]).toContain("c.intake_protocol='legacy'"); expect(mutations()).toHaveLength(0);
});

test("even authenticated legacy webhook delivery cannot replace accepted data", async () => {
  submitted();
  const result = await request(app).post("/webhooks/interview-complete").set("x-webhook-secret", "synthetic-only")
    .send({ session_id: "fictional", transcript: "Fictional attempted overwrite", analysis: {} });
  expect(result.status).toBe(409); expect(mutations()).toHaveLength(0);
});

test("admin cannot assign an advocate before client submission", async () => {
  const result = await request(app).post("/admin/assign").send({ caseId: 101, advocateId: 77 });
  expect(result.status).toBe(409); expect(mutations()).toHaveLength(0); expect(release).toHaveBeenCalledTimes(1);
});

test("matching requires a real submitted record, not a forged completion flag", async () => {
  c.interview_completed = true;
  const result = await request(app).get("/client/matching?caseId=101");
  expect(result.status).toBe(409); expect(mutations()).toHaveLength(0);
});

test.each(["client", "admin"])("%s rejects a cached shortlist whose revision/hash no longer matches", async audience => {
  submitted(); run = { id: 900, input_snapshot: { intakeRevisionId: "submitted-revision", intakeContentHash: "wrong-hash" } };
  const result = audience === "client"
    ? await request(app).post("/client/matching/select").send({ caseId: 101, advocateId: 77 })
    : await request(app).get("/admin/candidates?caseId=101");
  expect(result.status).toBe(409); expect(mutations()).toHaveLength(0);
});

test("no available advocates does not erase a committed submission", async () => {
  submitted(); const pointer = c.submitted_intake_revision_id;
  const result = await request(app).get("/client/matching?caseId=101");
  expect(result.status).toBe(409); expect(result.body.error).toMatch(/No advocate/);
  expect(c.submitted_intake_revision_id).toBe(pointer);
  expect(query.mock.calls.some(([sql]) => sql === "ROLLBACK")).toBe(true);
  const insert = query.mock.calls.find(([sql]) => sql.includes("INSERT INTO public.case_matching_runs"));
  expect(JSON.parse(insert[1][3])).toMatchObject({ intakeRevisionId: pointer, intakeContentHash: "a".repeat(64), analysis: { issue_summary: "Client-reviewed fictional issue" } });
});
