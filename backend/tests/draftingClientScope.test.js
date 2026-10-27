import { jest, test, expect, beforeEach, afterEach } from "@jest/globals";
import { fetchDraftJob, callDraftingAssistant } from "../services/draftingClient.js";

let fetchMock;
beforeEach(() => {
  process.env.DRAFTING_ASSISTANT_URL = "http://drafting.invalid";
  process.env.INTERNAL_API_KEY = "fictional-internal-key";
  fetchMock = jest.spyOn(globalThis, "fetch").mockImplementation(() => {
    throw new Error("Unmocked network request forbidden");
  });
});
afterEach(() => fetchMock.mockRestore());

test("poll encodes job ID and forwards explicit actor/case scope", async () => {
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ status: "queued" })));
  expect((await fetchDraftJob("id/with?syntax", { caseId: 101, advocateId: 77 })).ok).toBe(true);
  const [url, options] = fetchMock.mock.calls[0];
  expect(url).toBe("http://drafting.invalid/draft/generate/id%2Fwith%3Fsyntax?case_id=101&advocate_id=77");
  expect(options.headers["x-internal-key"]).toBe("fictional-internal-key");
});

test.each([{}, { caseId: -1, advocateId: 77 }, { caseId: 101, advocateId: 1.5 }])(
  "invalid scope never reaches the network: %j", async scope => {
    expect((await fetchDraftJob("known-job", scope)).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  }
);

test.each([403, 404, 409])("resource error %i survives the BFF boundary", async status => {
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ detail: "Scope denied" }), { status }));
  const result = await callDraftingAssistant("/draft/save", {});
  expect(result.ok).toBe(false);
  expect(result.status).toBe(status);
});

test("upstream internal authentication error is not presented as a user login failure", async () => {
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ detail: "Bad internal key" }), { status: 401 }));
  expect((await callDraftingAssistant("/draft/init", {})).status).toBe(502);
});
