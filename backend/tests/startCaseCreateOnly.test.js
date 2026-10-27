import { jest, test, expect, beforeEach } from "@jest/globals";

const query = jest.fn();
jest.unstable_mockModule("../db.js", () => ({ default: { query } }));
jest.unstable_mockModule("../services/documentExtraction.service.js", () => ({ enqueueDocumentExtractionJobs: jest.fn() }));
const { createDraftCase } = await import("../controllers/clientDashboard/startCase/startCase.controller.js");
const saved = { id: 101, user_id: 42, status: "DRAFT", intake_protocol: "legacy", description: "Offline saved account", language: "Punjabi" };
const invoke = async body => {
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
  await createDraftCase({ user: { id: 42 }, body }, res);
  return res;
};
const writes = () => query.mock.calls.filter(([sql]) => /^\s*(INSERT|UPDATE|DELETE)/.test(sql));
beforeEach(() => { query.mockReset(); });

test.each([["legacy", "DRAFT"], ["live_v2", "INTAKE_STARTED"], ["live_v2", "MATCHING_REVIEW"]])("createOnly returns existing owned %s %s case read-only, preserving description/language", async (protocol, status) => {
  const existing = { ...saved, intake_protocol: protocol, status };
  query.mockResolvedValue({ rows: [existing] });
  const result = await invoke({ createOnly: true, description: "Must not overwrite", language: "mixed" });
  expect(result.json).toHaveBeenCalledWith({ created: false, case: existing });
  expect(query).toHaveBeenCalledTimes(1);
  expect(query.mock.calls[0][0]).toContain("WHERE user_id = $1");
  expect(query.mock.calls[0][1]).toEqual([42]);
  expect(existing.description).toBe(saved.description); expect(existing.language).toBe("Punjabi");
  expect(writes()).toHaveLength(0);
});

test("createOnly creates an empty server-owned draft with neutral metadata, not caller facts", async () => {
  const created = { ...saved, id: 102, description: "", language: "mixed" };
  query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [created] });
  const result = await invoke({ createOnly: true, title: "Ignored", description: "Ignored facts", language: "Urdu" });
  expect(result.json).toHaveBeenCalledWith({ created: true, case: created });
  expect(query.mock.calls[1][0]).toMatch(/VALUES \(\$1,NULL,'','text','mixed','DRAFT',NOW\(\)\)/);
  expect(query.mock.calls[1][1]).toEqual([42]); expect(writes()).toHaveLength(1);
});

test("a concurrent draft appearing after the read cannot reach the legacy UPDATE branch", async () => {
  let otherDraft;
  query.mockImplementation(async sql => {
    if (sql.includes("SELECT")) { otherDraft = { ...saved }; return { rows: [] }; }
    if (sql.includes("INSERT")) return { rows: [{ ...saved, id: 102, description: "", language: "mixed" }] };
    throw new Error("Unexpected mutation");
  });
  const result = await invoke({ createOnly: true });
  expect(result.json.mock.calls[0][0].created).toBe(true);
  expect(otherDraft).toEqual(saved);
  expect(query.mock.calls.some(([sql]) => sql.includes("UPDATE"))).toBe(false);
  expect(query).toHaveBeenCalledTimes(2); // No cross-tab uniqueness is claimed.
});

test.each([{ createOnly: true, caseId: 101 }, { createOnly: true, caseId: 0 }, { createOnly: "true" }])("incompatible createOnly input %j is rejected before any query", async body => {
  const result = await invoke(body);
  expect(result.status).toHaveBeenCalledWith(400); expect(query).not.toHaveBeenCalled();
});

test("ordinary legacy caller retains required description validation", async () => {
  const result = await invoke({ language: "Urdu" });
  expect(result.status).toHaveBeenCalledWith(400);
  expect(result.json).toHaveBeenCalledWith({ error: "description is required" }); expect(query).not.toHaveBeenCalled();
});

test.each([true, false])("ordinary legacy caller retains existing-draft update behavior, explicit ID=%s", async explicit => {
  const updated = { ...saved, description: "Changed offline account", language: "Urdu" };
  query.mockResolvedValueOnce({ rows: [saved] }).mockResolvedValueOnce({ rows: [updated] });
  const result = await invoke({ ...(explicit ? { caseId: 101 } : {}), description: updated.description, language: updated.language });
  expect(result.json).toHaveBeenCalledWith({ message: "Draft updated", case: updated });
  expect(query.mock.calls[1][0]).toContain("UPDATE public.client_cases");
  expect(query.mock.calls[1][1]).toEqual([101, null, updated.description, "Urdu", 42]);
});

test("ordinary legacy caller retains create behavior", async () => {
  query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [saved] });
  const result = await invoke({ description: saved.description, language: saved.language });
  expect(result.json).toHaveBeenCalledWith({ message: "Draft created", case: saved });
  expect(query.mock.calls[1][1]).toEqual([42, null, saved.description, saved.language]);
});

test("uncertain create failure never falls through to UPDATE or silently retries", async () => {
  query.mockResolvedValueOnce({ rows: [] }).mockRejectedValueOnce(new Error("Offline unknown commit"));
  const result = await invoke({ createOnly: true });
  expect(result.status).toHaveBeenCalledWith(500); expect(query).toHaveBeenCalledTimes(2);
  expect(query.mock.calls.some(([sql]) => sql.includes("UPDATE"))).toBe(false);
});
