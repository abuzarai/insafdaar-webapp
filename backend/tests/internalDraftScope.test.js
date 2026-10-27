import { jest, describe, test, expect, beforeEach } from "@jest/globals";
import express from "express";
import request from "supertest";

const query = jest.fn();
jest.unstable_mockModule("../db.js", () => ({ default: { query } }));
const { default: router } = await import("../routes/internalDraft.routes.js");
const app = express();
app.use(express.json());
app.use("/internal/draft", router);

beforeEach(() => {
  query.mockReset();
  process.env.INTERNAL_API_KEY = "fictional-internal-key";
});
const post = (path, body, key = "fictional-internal-key") => request(app)
  .post(`/internal/draft/${path}`).set("x-internal-key", key).send(body);
const scope = { case_id: 101, advocate_id: 77 };
const owned = { rows: [{ id: 101, user_id: 501 }], rowCount: 1 };

test.each([-1, 1.5])("case context rejects invalid identity %i before database access", async case_id => {
  expect((await post("case-context", { ...scope, case_id })).status).toBe(400);
  expect(query).not.toHaveBeenCalled();
});

for (const path of ["documents", "intake-analysis", "save"]) {
  describe(path, () => {
    test("requires service authentication before database access", async () => {
      expect((await post(path, scope, "wrong")).status).toBe(403);
      expect(query).not.toHaveBeenCalled();
    });
    test("requires positive case and actor identities", async () => {
      expect((await post(path, { case_id: 101 })).status).toBe(400);
      expect((await post(path, { ...scope, case_id: -1 })).status).toBe(400);
      expect(query).not.toHaveBeenCalled();
    });
    test("denies unassigned cases before reading or writing resources", async () => {
      query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
      expect((await post(path, scope)).status).toBe(404);
      expect(query).toHaveBeenCalledTimes(1);
      expect(query.mock.calls[0][0]).toMatch(/assigned_advocate_id = \$2/);
      expect(query.mock.calls[0][1]).toEqual([101, 77]);
    });
  });
}

test("documents derive client owner from the authorized case, ignoring supplied user_id", async () => {
  query.mockResolvedValueOnce(owned)
    .mockResolvedValueOnce({ rows: [{ id: 1 }], rowCount: 1 })
    .mockResolvedValueOnce({ rows: [{ id: 2 }], rowCount: 1 });
  const response = await post("documents", { ...scope, user_id: 999 });
  expect(response.status).toBe(200);
  expect(query.mock.calls[1][1]).toEqual([101]);
  expect(query.mock.calls[2][1]).toEqual([501]);
  expect(response.body.client_documents).toEqual([{ id: 2 }]);
});

test("documents no longer require independently supplied user_id", async () => {
  query.mockResolvedValueOnce(owned).mockResolvedValue({ rows: [], rowCount: 0 });
  expect((await post("documents", scope)).status).toBe(200);
});

test("intake reads only after assignment authorization", async () => {
  query.mockResolvedValueOnce(owned).mockResolvedValueOnce({ rows: [], rowCount: 0 });
  const response = await post("intake-analysis", scope);
  expect(response.status).toBe(200);
  expect(response.body).toEqual({ analysis: null, transcript: null });
  expect(query.mock.calls[1][1]).toEqual([101]);
});

test.each([0, 1])("save cannot rebind an existing generation across cases or actors (%i)", async rowCount => {
  query.mockResolvedValueOnce(owned).mockResolvedValueOnce({ rows: [], rowCount });
  const response = await post("save", {
    ...scope, generation_id: "fictional-gen", document_type: "Plaint", draft_json: {},
  });
  expect(response.status).toBe(rowCount ? 200 : 409);
  const sql = query.mock.calls[1][0];
  expect(sql).toMatch(/WHERE id = \$1 AND assigned_advocate_id = \$5/);
  expect(sql).toMatch(/WHERE draft_sessions.case_id = EXCLUDED.case_id/);
  expect(sql).toMatch(/AND draft_sessions.advocate_id = EXCLUDED.advocate_id/);
  expect(sql).not.toMatch(/SET case_id =/);
});
