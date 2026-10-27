import { jest, test, expect, beforeEach } from "@jest/globals";
import fs from "fs";

const query = jest.fn();
const fetchJob = jest.fn();
jest.unstable_mockModule("../db.js", () => ({ default: { query } }));
jest.unstable_mockModule("../services/draftingClient.js", () => ({
  getDraftingAssistantBaseUrl: jest.fn(), getDraftingTimeoutMs: jest.fn(),
  callDraftingAssistant: jest.fn(), fetchDraftJob: fetchJob,
}));
jest.unstable_mockModule("../services/documentExtraction.service.js", () => ({ enqueueDocumentExtractionJobs: jest.fn() }));
jest.unstable_mockModule("../controllers/clientDashboard/notifications/notifications.controller.js", () => ({ createClientNotification: jest.fn() }));
jest.unstable_mockModule("../utils/notify.js", () => ({ notifyClient: jest.fn(), notifyAllAdmins: jest.fn() }));
jest.unstable_mockModule("../utils/mailer.js", () => ({ sendContractSigningOtpEmail: jest.fn() }));
jest.unstable_mockModule("../services/contractService.js", () => Object.fromEntries([
  "getLatestContract", "getContractSignatures", "getContractAttachments", "logContractEvent",
  "serializeContract", "parseSignConfirmations", "assertAllSignConfirmations",
].map(name => [name, jest.fn()])));
const mkdir = jest.spyOn(fs, "mkdirSync").mockImplementation(() => undefined);
const { getPreparationAIDraftStatus: preparation } = await import("../controllers/advocateDashboard/casePreparation/casePreparation.controller.js");
const { getContractAIDraftStatusByAdvocate: contract } = await import("../controllers/advocateDashboard/contracts/contracts.controller.js");
mkdir.mockRestore();

beforeEach(() => {
  query.mockReset();
  fetchJob.mockReset();
});
function response() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
}
function req(caseId = "101") {
  return { user: { id: 77 }, params: { caseId, jobId: "fictional-job" }, body: { advocate_id: 999 } };
}
for (const [name, handler] of [["preparation", preparation], ["contract", contract]]) {
  test(`${name}: login is required before database or upstream access`, async () => {
    const res = response();
    await handler({ ...req(), user: null }, res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(query).not.toHaveBeenCalled();
    expect(fetchJob).not.toHaveBeenCalled();
  });
  test(`${name}: invalid route case fails before upstream access`, async () => {
    const res = response();
    await handler(req("-1"), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(fetchJob).not.toHaveBeenCalled();
  });
  test(`${name}: an unassigned case cannot poll a known job`, async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const res = response();
    await handler(req(), res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(fetchJob).not.toHaveBeenCalled();
  });
  test(`${name}: route case and authenticated actor scope reach upstream`, async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 101, assigned_advocate_id: 77, status: "CASE_ACTIVE" }] });
    fetchJob.mockResolvedValueOnce({ ok: true, data: { status: "queued" } });
    const res = response();
    await handler(req(), res);
    expect(fetchJob).toHaveBeenCalledWith("fictional-job", { caseId: 101, advocateId: 77 });
    expect(res.json).toHaveBeenCalledWith({ ok: true, status: "queued" });
  });
  test(`${name}: mismatched job scope does not expose a result`, async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 101, assigned_advocate_id: 77, status: "CASE_ACTIVE" }] });
    fetchJob.mockResolvedValueOnce({ ok: false, status: 404, payload: { error: "Job not found" } });
    const res = response();
    await handler(req(), res);
    expect(res.status).toHaveBeenCalledWith(410);
    expect(res.json).not.toHaveBeenCalledWith(expect.objectContaining({ draft: expect.anything() }));
  });
}

test("case preparation retains the active-case gate", async () => {
  query.mockResolvedValueOnce({ rows: [{ id: 101, status: "MATCHING_REVIEW" }] });
  const res = response();
  await preparation(req(), res);
  expect(res.status).toHaveBeenCalledWith(409);
  expect(fetchJob).not.toHaveBeenCalled();
});

test("contract polling rechecks current assignment", async () => {
  query.mockResolvedValueOnce({ rows: [{ id: 101, assigned_advocate_id: 78 }] });
  const res = response();
  await contract(req(), res);
  expect(res.status).toHaveBeenCalledWith(403);
  expect(fetchJob).not.toHaveBeenCalled();
});
