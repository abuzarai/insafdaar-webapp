import React from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import ReviewedIntakePanel from "./ReviewedIntakePanel";
import i18n from "../../context/i18n";
const exportPreview = (root: ReturnType<typeof render>, name: string) => {
  if (process.env.VOICE_LAYOUT_PREVIEW !== "1") return;
  require("fs").writeFileSync(`/tmp/insafdaar-voice-${name}-preview.html`, `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Fictional case interview preview</title></head><body><main style="max-width:1100px;margin:24px auto">${root.container.innerHTML}</main></body></html>`);
};
const mockVoices: any[] = [];
let mockConnect = true;
jest.mock("./reviewedVoice", () => ({ ReviewedVoice: class {
  options: any; stopped = false;
  constructor(options: any) { this.options = options; mockVoices.push(this); }
  start = jest.fn(async () => {
    try {
      const value = await this.options.admit();
      if (!this.stopped) { this.options.onAdmitted(value); if (mockConnect) this.options.onConnected(); }
    } catch (error) {
      if (!this.stopped) { this.options.onFailure("admission", error instanceof Error ? error.message : "unavailable"); void this.stop(); }
    }
  });
  prepare = jest.fn(async () => { if (this.stopped) return false; this.options.onPrepared(); return true; });
  stop = jest.fn(() => { this.stopped = true; this.options.onStopped(); return Promise.resolve(); });
  play = jest.fn(async () => {});
} }));
const revision = (id = "revision-one") => ({ revisionId: id, contentHash: `hash-${id}`,
  reviewedData: { issue_summary: "A tenancy dispute", primary_language: "mixed", legal_domain: "property_law",
    facts: { alias_name: null, issue_category: null, issue_description: "The landlord withheld the deposit", timeline: null, parties: null,
      location: null, financial_impact: null, previous_action: null, urgency: null, documentation: null, desired_outcome: null },
    key_entities: { parties: [], locations: [], dates: [], amounts: [] } }, modelSuggestions: { adr_suitable: false } });
const reply = (data: any, status = 200) => Promise.resolve({ ok: status < 400, status, json: async () => structuredClone(data) });
const deferred = () => {
  let resolve!: (value: any) => void;
  const promise = new Promise<any>(r => { resolve = r; });
  return { promise, resolve };
};
let server: any, serial: number, fetchMock: jest.Mock;
const postCalls = () => fetchMock.mock.calls.filter(([, options]) => options.method === "POST");
const stages = () => postCalls().map(([url]) => url.split("/").pop());
const confirm = () => screen.getByRole("button", { name: "Confirm & find a lawyer" });
const recovery = () => screen.getByRole("button", { name: "Check status" });
const open = async (submitted = jest.fn()) => {
  const root = render(<ReviewedIntakePanel caseId={101} onSubmitted={submitted} />);
  await waitFor(() => expect(confirm()).toBeEnabled()); return { root, submitted };
};
const startInterview = async (language = "English") => {
  server.revision = null;
  const submitted = jest.fn();
  const root = render(<ReviewedIntakePanel caseId={101} language={language} onSubmitted={submitted} />);
  await screen.findByText(/By choosing Start interview/);
  await waitFor(() => expect(screen.getByRole("button", { name: "Start interview" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Start interview" }));
  await screen.findByText(/Interview connected/);
  return { root, submitted };
};
beforeEach(() => {
  void i18n.changeLanguage("en");
  mockVoices.length = 0; mockConnect = true; serial = 0;
  server = { enabled: true, protocol: "live_v2", status: "INTAKE_STARTED", caseVersion: 2,
    revision: revision(), confirmation: null, submittedRevisionId: null };
  localStorage.setItem("token", "test-token");
  Object.defineProperty(global, "crypto", { configurable: true, value: { randomUUID: () => `intent-${++serial}` } });
  Object.defineProperty(AbortSignal, "timeout", { configurable: true, value: () => new AbortController().signal });
  // CRA's jsdom predates structuredClone; all IO is mocked and offline.
  Object.defineProperty(global, "structuredClone", { configurable: true, value: (v: any) => JSON.parse(JSON.stringify(v)) });
  const receipts = new Map<string, any>();
  fetchMock = jest.fn(async (url: string, options: any) => {
    if (options.method === "GET") return reply(server);
    const body = JSON.parse(options.body), key = options.headers["Idempotency-Key"];
    const operation = url.split("/").pop();
    if (receipts.has(key)) {
      const prior = receipts.get(key);
      return prior.body === options.body && prior.operation === operation ? reply(prior.receipt) : reply({ code: "INTENT_CONFLICT" }, 409);
    }
    if (body.expectedVersion !== server.caseVersion) return reply({ code: "STALE_CASE_VERSION" }, 409);
    if (body.revisionId && body.revisionId !== server.revision?.revisionId) return reply({ code: "STALE_REVISION" }, 409);
    let receipt: any;
    if (operation === "sessions") {
      server.caseVersion++;
      receipt = { sessionId: mockVoices.length > 1 ? `test-session-${mockVoices.length}` : "test-session", caseVersion: server.caseVersion, expiresAt: new Date(Date.now() + 300000).toISOString() };
    } else if (operation === "revisions" || operation === "edits") {
      server.caseVersion++; server.confirmation = null;
      server.revision = operation === "revisions" ? revision("saved-proposal") : { ...revision("revision-two"), reviewedData: body.reviewedData };
      receipt = { ...server.revision, caseVersion: server.caseVersion, confirmed: false };
    } else if (operation === "confirmations") {
      server.caseVersion++;
      server.confirmation = { confirmationId: "confirmation-one", revisionId: server.revision.revisionId, contentHash: server.revision.contentHash };
      receipt = { ...server.confirmation, caseVersion: server.caseVersion };
    } else if (operation === "submissions") {
      if (body.confirmationId !== server.confirmation?.confirmationId) return reply({ code: "CURRENT_CONFIRMATION_REQUIRED" }, 409);
      server.caseVersion++; server.submittedRevisionId = server.revision.revisionId; server.status = "MATCHING_REVIEW";
      receipt = { ...server.confirmation, caseVersion: server.caseVersion, status: server.status };
    } else throw new Error(`Unexpected request: ${operation}`);
    receipts.set(key, { body: options.body, operation, receipt: structuredClone(receipt) });
    return reply(receipt);
  });
  global.fetch = fetchMock;
});

test("opening and reopening a saved summary never submits it or exposes technical details", async () => {
  const { root } = await open();
  expect(mockVoices).toHaveLength(0); expect(postCalls()).toHaveLength(0);
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Prepare|Save edits|Confirm reviewed|Submit for matching/ })).not.toBeInTheDocument();
  expect(screen.getByLabelText("Issue summary")).toHaveTextContent("A tenancy dispute");
  expect(screen.queryByText(/Support details|Revision:|Receipt hash:|hash-revision-one/)).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Load saved intake" })).not.toBeInTheDocument();
  expect(screen.queryByText("revision-one", { exact: true })).not.toBeInTheDocument();
  exportPreview(root, "review");
  root.unmount(); await open();
  expect(postCalls()).toHaveLength(0); expect(fetchMock.mock.calls[0][1].cache).toBe("no-store");
});

test("disabled feature has no voice fallback and read-only saved facts", async () => {
  server.enabled = false;
  render(<ReviewedIntakePanel caseId={101} onSubmitted={jest.fn()} />);
  await screen.findByLabelText("Issue summary");
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument(); expect(confirm()).toBeDisabled();
  expect(mockVoices).toHaveLength(0); expect(postCalls()).toHaveLength(0);
});

test("confirmation and submission are separate fresh-key receipt-bound operations from one click", async () => {
  const { submitted } = await open();
  const confirmButton = confirm();
  fireEvent.click(confirmButton); fireEvent.click(confirmButton);
  expect(screen.queryByRole("button", { name: "Confirm & find a lawyer" })).not.toBeInTheDocument();
  await screen.findByText(/Your submitted case details can no longer be edited/);
  expect(stages()).toEqual(["confirmations", "submissions"]);
  expect(JSON.parse(postCalls()[0][1].body)).toEqual({ revisionId: "revision-one", expectedVersion: 2, acknowledgmentVersion: "review-v1", acknowledgeReview: true });
  expect(JSON.parse(postCalls()[1][1].body)).toEqual({ expectedVersion: 3, revisionId: "revision-one", confirmationId: "confirmation-one" });
  expect(postCalls()[1][1].headers["Idempotency-Key"]).not.toBe(postCalls()[0][1].headers["Idempotency-Key"]);
  expect(submitted).toHaveBeenCalledTimes(1); expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
});

test("dirty Unicode edits save first, then confirm and submit only the new receipt", async () => {
  const { submitted } = await open();
  fireEvent.click(screen.getByRole("button", { name: "Make changes" }));
  fireEvent.change(screen.getByLabelText("Issue summary"), { target: { value: "کرایہ داری کا تنازع" } });
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await screen.findByText(/Changes saved/);
  expect(stages()).toEqual(["edits"]); expect(submitted).not.toHaveBeenCalled();
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  fireEvent.click(confirm()); await screen.findByText(/Your submitted case details can no longer be edited/);
  expect(stages()).toEqual(["edits", "confirmations", "submissions"]);
  expect(JSON.parse(postCalls()[0][1].body)).toMatchObject({ expectedVersion: 2, revisionId: "revision-one", reviewedData: { issue_summary: "کرایہ داری کا تنازع" } });
  expect(JSON.parse(postCalls()[1][1].body)).toMatchObject({ expectedVersion: 3, revisionId: "revision-two" });
  expect(JSON.parse(postCalls()[2][1].body)).toEqual({ expectedVersion: 4, revisionId: "revision-two", confirmationId: "confirmation-one" });
  expect(new Set(postCalls().map(([, options]) => options.headers["Idempotency-Key"])).size).toBe(3);
  expect(submitted).toHaveBeenCalledTimes(1);
});

test.each([
  ["Issue summary", 4096], ["What happened", 2048], ["People", 4096],
] as const)("overlength %s stays editable and cannot save until corrected", async (name, limit) => {
  const { submitted } = await open();
  fireEvent.click(screen.getByRole("button", { name: "Make changes" }));
  const field = screen.getByRole("textbox", { name });
  const overlength = "\u{1F600}".repeat(limit + 1);
  fireEvent.change(field, { target: { value: overlength } });
  expect(field).toHaveValue(overlength);
  expect(field).toHaveAttribute("aria-invalid", "true");
  const saveButton = screen.getByRole("button", { name: "Save changes" });
  expect(saveButton).toBeDisabled();
  fireEvent.click(saveButton);
  expect(postCalls()).toHaveLength(0);
  expect(submitted).not.toHaveBeenCalled();
  const corrected = "\u{1F600}".repeat(limit);
  fireEvent.change(field, { target: { value: corrected } });
  expect(saveButton).toBeEnabled();
  fireEvent.click(saveButton);
  await screen.findByText(/Changes saved/);
  expect(stages()).toEqual(["edits"]);
  const saved = JSON.parse(postCalls()[0][1].body).reviewedData;
  expect(name === "Issue summary" ? saved.issue_summary : name === "What happened" ? saved.facts.issue_description : saved.key_entities.parties[0]).toBe(corrected);
  fireEvent.click(confirm());
  await screen.findByText(/Your submitted case details can no longer be edited/);
  expect(stages()).toEqual(["edits", "confirmations", "submissions"]);
  expect(submitted).toHaveBeenCalledTimes(1);
});

test("a restored confirmation is not silently adopted for submission", async () => {
  server.confirmation = { confirmationId: "another-tab-confirmation", revisionId: "revision-one", contentHash: server.revision.contentHash };
  await open(); fireEvent.click(confirm()); await screen.findByText(/Your submitted case details can no longer be edited/);
  expect(stages()).toEqual(["confirmations", "submissions"]);
  expect(JSON.parse(postCalls()[1][1].body).confirmationId).toBe("confirmation-one");
});

test("Finish double-click prepares once and durably saves once, never confirms or submits", async () => {
  const { submitted, root } = await startInterview("Urdu");
  expect(screen.getByRole("heading", { name: "Tell us about your case" })).toBeInTheDocument();
  expect(root.container.querySelector(".voice-orb")).not.toBeInTheDocument();
  expect(root.container.querySelector(".state-speaking, .state-listening")).not.toBeInTheDocument();
  expect(screen.queryByLabelText(/I heard a response/)).not.toBeInTheDocument();
  const prepare = deferred(); mockVoices[0].prepare.mockReturnValue(prepare.promise);
  const button = screen.getByRole("button", { name: "End interview" });
  fireEvent.click(button); fireEvent.click(button);
  expect(mockVoices[0].prepare).toHaveBeenCalledTimes(1);
  expect(screen.queryByText(/Draft summary saved/)).not.toBeInTheDocument();
  await act(async () => { prepare.resolve(true); });
  await screen.findByLabelText("Issue summary");
  expect(stages()).toEqual(["sessions", "revisions"]);
  expect(JSON.parse(postCalls()[1][1].body)).toEqual({ sessionId: "test-session", expectedVersion: 3 });
  expect(mockVoices[0].stop).toHaveBeenCalledTimes(1); expect(submitted).not.toHaveBeenCalled();
  expect(root.container.querySelector(".reviewed-voice-session")).not.toBeInTheDocument();
  expect(confirm()).toBeEnabled();
});

test("signaling still supplies a POST Request before SDK attaches SDP", async () => {
  await startInterview();
  expect(JSON.parse(postCalls()[0][1].body)).toEqual({ expectedVersion: 2, processingConsent: true, transcriptNoticeVersion: "live-transcript-v1" });
  const { endpoint } = mockVoices[0].options.offer("test-session");
  expect(endpoint.method).toBe("POST"); expect(endpoint.headers.get("Authorization")).toBe("Bearer test-token");
  expect(() => new Request(new Request(endpoint.url), { body: "test-sdp" })).toThrow();
  const withBody = new Request(endpoint, { body: JSON.stringify({ type: "offer", sdp: "test-sdp" }) });
  expect(withBody.method).toBe("POST"); expect(await withBody.json()).toEqual({ type: "offer", sdp: "test-sdp" });
});

test("Stop during Prepare suppresses media immediately and prevents late automatic Save", async () => {
  await startInterview(); const prepare = deferred(); mockVoices[0].prepare.mockReturnValue(prepare.promise);
  fireEvent.click(screen.getByRole("button", { name: "End interview" }));
  fireEvent.click(screen.getByRole("button", { name: /Stop/ }));
  expect(mockVoices[0].stop).toHaveBeenCalledTimes(1);
  await act(async () => { prepare.resolve(true); });
  expect(stages()).toEqual(["sessions"]); expect(screen.queryByLabelText("Issue summary")).not.toBeInTheDocument();
});

test("failed or unknown Prepare never retries generation or claims a saved summary", async () => {
  await startInterview();
  mockVoices[0].prepare.mockImplementation(async () => { mockVoices[0].options.onFailure("prepare", "unavailable"); mockVoices[0].stop(); return false; });
  fireEvent.click(screen.getByRole("button", { name: "End interview" }));
  await screen.findByText(/It has not been saved here/);
  expect(mockVoices[0].prepare).toHaveBeenCalledTimes(1); expect(stages()).toEqual(["sessions"]);
  expect(screen.queryByRole("button", { name: "End interview" })).not.toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "We couldn’t finish this step" })).toHaveFocus();
  expect(document.querySelector(".voice-orb")).toBeNull();
});

test("Stop while Save is pending keeps known saved facts but never confirms them", async () => {
  await startInterview(); const ordinary = fetchMock.getMockImplementation()!, save = deferred();
  fetchMock.mockImplementation((url: string, options: any) => url.endsWith("/revisions") ? save.promise : ordinary(url, options));
  fireEvent.click(screen.getByRole("button", { name: "End interview" }));
  await waitFor(() => expect(stages()).toEqual(["sessions", "revisions"]));
  fireEvent.click(screen.getByRole("button", { name: /Stop/ })); expect(mockVoices[0].stop).toHaveBeenCalledTimes(1);
  await act(async () => { save.resolve(await reply({ ...revision("saved-proposal"), caseVersion: 4 })); });
  await screen.findByLabelText("Issue summary"); expect(stages()).toEqual(["sessions", "revisions"]);
});

test.each(["edits", "confirmations", "submissions"])("lost %s reply recovers exact intent explicitly, then continues without model work", async operation => {
  const { submitted } = await open();
  if (operation === "edits") { fireEvent.click(screen.getByRole("button", { name: "Make changes" })); fireEvent.change(screen.getByLabelText("Issue summary"), { target: { value: "Corrected summary" } }); }
  const ordinary = fetchMock.getMockImplementation()!; let lost = false;
  fetchMock.mockImplementation(async (url: string, options: any) => {
    const result = await ordinary(url, options);
    if (url.endsWith(`/${operation}`) && !lost) { lost = true; throw new TypeError("Lost response"); }
    return result;
  });
  fireEvent.click(operation === "edits" ? screen.getByRole("button", { name: "Save changes" }) : confirm()); await waitFor(() => expect(recovery()).toBeEnabled());
  expect(submitted).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: /Refresh details|Load saved intake/ })).not.toBeInTheDocument();
  const original = postCalls().find(([url]) => url.endsWith(`/${operation}`))![1];
  const countBeforeRecovery = postCalls().length;
  await act(async () => { await Promise.resolve(); }); expect(postCalls()).toHaveLength(countBeforeRecovery);
  fireEvent.click(recovery());
  if (operation === "edits") { await screen.findByText(/Changes saved/); expect(submitted).not.toHaveBeenCalled(); fireEvent.click(confirm()); }
  await screen.findByText(/Your submitted case details can no longer be edited/);
  const attempts = postCalls().filter(([url]) => url.endsWith(`/${operation}`));
  expect(attempts).toHaveLength(2);
  expect(attempts[1][1].body).toBe(original.body);
  expect(attempts[1][1].headers["Idempotency-Key"]).toBe(original.headers["Idempotency-Key"]);
  expect(mockVoices).toHaveLength(0); expect(submitted).toHaveBeenCalledTimes(1);
  expect(fetchMock.mock.calls.filter(([, options]) => options.method === "GET")).toHaveLength(1);
});

test("lost Save response recovers the durable save without another Prepare", async () => {
  await startInterview(); const ordinary = fetchMock.getMockImplementation()!; let lost = false;
  fetchMock.mockImplementation(async (url: string, options: any) => {
    const result = await ordinary(url, options);
    if (url.endsWith("/revisions") && !lost) { lost = true; throw new TypeError("Lost reply"); } return result;
  });
  fireEvent.click(screen.getByRole("button", { name: "End interview" }));
  await waitFor(() => expect(recovery()).toBeEnabled());
  expect(screen.queryByLabelText("Issue summary")).not.toBeInTheDocument();
  fireEvent.click(recovery()); await screen.findByLabelText("Issue summary");
  expect(mockVoices[0].prepare).toHaveBeenCalledTimes(1); expect(stages()).toEqual(["sessions", "revisions", "revisions"]);
  expect(postCalls()[2][1].body).toBe(postCalls()[1][1].body);
  expect(postCalls()[2][1].headers["Idempotency-Key"]).toBe(postCalls()[1][1].headers["Idempotency-Key"]);
});

test("a stale reviewed selection is rejected, never silently replaced or submitted", async () => {
  const { submitted } = await open(); server.caseVersion++; server.revision = revision("another-tab");
  fireEvent.click(confirm()); await screen.findByText(/Request rejected/);
  expect(stages()).toEqual(["confirmations"]); expect(submitted).not.toHaveBeenCalled();
  expect(screen.getByLabelText("Issue summary")).toHaveTextContent("A tenancy dispute");
  expect(screen.queryByRole("button", { name: "Check status" })).not.toBeInTheDocument();
});

test.each(["edits", "confirmations"])("concurrent selection after %s cannot redirect the next operation", async operation => {
  const { submitted } = await open();
  if (operation === "edits") { fireEvent.click(screen.getByRole("button", { name: "Make changes" })); fireEvent.change(screen.getByLabelText("Issue summary"), { target: { value: "Reviewed correction" } }); }
  const ordinary = fetchMock.getMockImplementation()!;
  fetchMock.mockImplementation(async (url: string, options: any) => {
    const result = await ordinary(url, options);
    if (url.endsWith(`/${operation}`)) { server.caseVersion++; server.revision = revision("another-tab"); }
    return result;
  });
  fireEvent.click(operation === "edits" ? screen.getByRole("button", { name: "Save changes" }) : confirm());
  if (operation === "edits") { await screen.findByText(/Changes saved/); fireEvent.click(confirm()); }
  await screen.findByText(/Request rejected/);
  const last = JSON.parse(postCalls()[postCalls().length - 1][1].body);
  expect(last.revisionId).toBe(operation === "edits" ? "revision-two" : "revision-one");
  expect(last.expectedVersion).toBe(3); expect(submitted).not.toHaveBeenCalled();
  expect(fetchMock.mock.calls.filter(([, options]) => options.method === "GET")).toHaveLength(1);
});

test("lost confirmation plus a concurrent selection replays its own receipt, not the other tab's", async () => {
  const { submitted } = await open(); const ordinary = fetchMock.getMockImplementation()!; let lost = false;
  fetchMock.mockImplementation(async (url: string, options: any) => {
    const result = await ordinary(url, options);
    if (url.endsWith("/confirmations") && !lost) {
      lost = true; server.caseVersion++; server.revision = revision("another-tab"); throw new TypeError("Lost reply");
    } return result;
  });
  fireEvent.click(confirm()); await waitFor(() => expect(recovery()).toBeEnabled());
  fireEvent.click(recovery()); await screen.findByText(/Request rejected/);
  expect(JSON.parse(postCalls()[2][1].body)).toEqual({ expectedVersion: 3, revisionId: "revision-one", confirmationId: "confirmation-one" });
  expect(submitted).not.toHaveBeenCalled();
});

test.each(["edits", "confirmations", "submissions"])("Stop during pending %s prevents any automatic next operation or matching", async operation => {
  const { submitted } = await open();
  if (operation === "edits") { fireEvent.click(screen.getByRole("button", { name: "Make changes" })); fireEvent.change(screen.getByLabelText("Issue summary"), { target: { value: "Corrected summary" } }); }
  const ordinary = fetchMock.getMockImplementation()!, result = deferred();
  fetchMock.mockImplementation((url: string, options: any) => url.endsWith(`/${operation}`) ? result.promise : ordinary(url, options));
  fireEvent.click(operation === "edits" ? screen.getByRole("button", { name: "Save changes" }) : confirm());
  await waitFor(() => expect(stages()).toContain(operation));
  const stop = screen.getByRole("button", { name: /Stop/ }); expect(stop).toBeEnabled(); fireEvent.click(stop);
  const count = postCalls().length;
  await act(async () => {
    const receipt = operation === "edits" ? { ...revision("revision-two"), caseVersion: 3 } : {
      confirmationId: "confirmation-one", revisionId: "revision-one", contentHash: "hash-revision-one", caseVersion: operation === "confirmations" ? 3 : 4, status: "MATCHING_REVIEW" };
    result.resolve(await reply(receipt));
  });
  expect(postCalls()).toHaveLength(count); expect(submitted).not.toHaveBeenCalled();
  if (operation === "confirmations") expect(recovery()).toBeEnabled();
  else expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
});

test("Continue after a stopped confirmation sends only the already-bound submission", async () => {
  await open(); const ordinary = fetchMock.getMockImplementation()!, confirmed = deferred();
  fetchMock.mockImplementation((url: string, options: any) => url.endsWith("/confirmations") ? confirmed.promise : ordinary(url, options));
  fireEvent.click(confirm()); fireEvent.click(screen.getByRole("button", { name: /Stop/ }));
  await act(async () => { confirmed.resolve(await ordinary(...postCalls()[0])); });
  await waitFor(() => expect(recovery()).toBeEnabled());
  fireEvent.click(recovery()); await screen.findByText(/Your submitted case details can no longer be edited/);
  expect(stages()).toEqual(["confirmations", "submissions"]);
});

test("explicit invalid-input rejection unlocks corrections rather than repeating invalid data", async () => {
  await open(); const ordinary = fetchMock.getMockImplementation()!;
  fireEvent.click(screen.getByRole("button", { name: "Make changes" }));
  fetchMock.mockImplementation((url: string, options: any) => url.endsWith("/edits") ? reply({ code: "INVALID_INTAKE" }, 422) : ordinary(url, options));
  fireEvent.change(screen.getByLabelText("Issue summary"), { target: { value: " " } }); fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await screen.findByText(/Request rejected/);
  expect(screen.queryByRole("button", { name: "Check status" })).not.toBeInTheDocument();
  expect(screen.getByLabelText("Issue summary")).toBeEnabled(); expect(postCalls()).toHaveLength(1);
  const requestsBeforeCancel = fetchMock.mock.calls.length;
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.getByRole("heading", { name: "Review your case" })).toBeInTheDocument();
  expect(screen.getByLabelText("Issue summary")).toHaveTextContent("A tenancy dispute");
  expect(confirm()).toBeEnabled();
  await waitFor(() => expect(screen.getByRole("button", { name: "Make changes" })).toHaveFocus());
  expect(screen.queryByText(/Request rejected/)).not.toBeInTheDocument();
  expect(fetchMock.mock.calls).toHaveLength(requestsBeforeCancel);
});

test.each(["confirmations", "submissions"])("late %s after unmount cannot advance or match", async operation => {
  const { root, submitted } = await open(); const ordinary = fetchMock.getMockImplementation()!, result = deferred();
  fetchMock.mockImplementation((url: string, options: any) => url.endsWith(`/${operation}`) ? result.promise : ordinary(url, options));
  fireEvent.click(confirm()); await waitFor(() => expect(stages()).toContain(operation)); const count = postCalls().length;
  root.unmount(); await act(async () => { result.resolve(await reply({ caseVersion: 3 })); });
  expect(submitted).not.toHaveBeenCalled(); expect(postCalls()).toHaveLength(count);
});

test("changing cases fences late receipts and callbacks to the old case", async () => {
  const { root, submitted } = await open(); const ordinary = fetchMock.getMockImplementation()!, result = deferred();
  fetchMock.mockImplementation((url: string, options: any) => url.endsWith("/confirmations") ? result.promise : ordinary(url, options));
  fireEvent.click(confirm()); root.rerender(<ReviewedIntakePanel caseId={202} onSubmitted={submitted} />);
  await screen.findByLabelText("Issue summary");
  await act(async () => { result.resolve(await reply({ confirmationId: "old-confirmation", revisionId: "revision-one", caseVersion: 3 })); });
  expect(stages()).toEqual(["confirmations"]); expect(submitted).not.toHaveBeenCalled(); expect(confirm()).toBeEnabled();
});

test("unmount while Prepare is pending never sends a Save", async () => {
  const { root } = await startInterview(); const prepare = deferred(); mockVoices[0].prepare.mockReturnValue(prepare.promise);
  fireEvent.click(screen.getByRole("button", { name: "End interview" })); root.unmount();
  await act(async () => { prepare.resolve(true); });
  expect(stages()).toEqual(["sessions"]); expect(mockVoices[0].stop).toHaveBeenCalledTimes(1);
});

test("a frozen reload stays read-only and does not automatically trigger matching", async () => {
  server.submittedRevisionId = "revision-one"; server.status = "MATCHING_REVIEW";
  const submitted = jest.fn(); render(<ReviewedIntakePanel caseId={101} onSubmitted={submitted} />);
  await screen.findByText(/Your submitted case details can no longer be edited/);
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument(); expect(screen.queryByRole("button", { name: "Confirm & find a lawyer" })).not.toBeInTheDocument();
  expect(postCalls()).toHaveLength(0); expect(submitted).not.toHaveBeenCalled();
});

test("matching failure preserves the frozen submission and offers explicit matching retry", async () => {
  const submitted = jest.fn().mockRejectedValue(new Error("Matching unavailable")); await open(submitted);
  fireEvent.click(confirm()); await screen.findByText(/lawyers could not be loaded/);
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument(); expect(stages()).toEqual(["confirmations", "submissions"]);
  submitted.mockResolvedValue(undefined); fireEvent.click(screen.getByRole("button", { name: "Find lawyers" }));
  await waitFor(() => expect(submitted).toHaveBeenCalledTimes(2)); expect(stages()).toEqual(["confirmations", "submissions"]);
});

test("a rejected submission never claims success or starts matching", async () => {
  const { submitted } = await open(); const ordinary = fetchMock.getMockImplementation()!;
  fetchMock.mockImplementation((url: string, options: any) => url.endsWith("/submissions") ? reply({ code: "CURRENT_CONFIRMATION_REQUIRED" }, 409) : ordinary(url, options));
  fireEvent.click(confirm()); await screen.findByText(/Request rejected/);
  expect(screen.queryByText(/Your submitted case details can no longer be edited/)).not.toBeInTheDocument(); expect(submitted).not.toHaveBeenCalled();
});

test("legal facts, intents and receipts are never persisted in browser storage", async () => {
  const save = jest.spyOn(Storage.prototype, "setItem"), sessionSave = jest.spyOn(Storage.prototype, "removeItem");
  await open(); fireEvent.click(screen.getByRole("button", { name: "Make changes" })); fireEvent.change(screen.getByLabelText("Issue summary"), { target: { value: "Confidential case information" } });
  fireEvent.click(screen.getByRole("button", { name: "Save changes" })); await screen.findByText(/Changes saved/);
  fireEvent.click(confirm()); await screen.findByText(/Your submitted case details can no longer be edited/);
  expect(save).not.toHaveBeenCalled(); expect(sessionSave).not.toHaveBeenCalled(); save.mockRestore(); sessionSave.mockRestore();
});

test("saved-state reload fences confirming until the explicit read finishes", async () => {
  await open(); const ordinary = fetchMock.getMockImplementation()!, read = deferred();
  fetchMock.mockImplementation((url: string, options: any) => url.endsWith("/confirmations") ? reply({ code: "CASE_VERSION_CONFLICT" }, 409) : ordinary(url, options));
  fireEvent.click(confirm()); await screen.findByText(/Request rejected/);
  fetchMock.mockImplementation((url: string, options: any) => options.method === "GET" ? read.promise : ordinary(url, options));
  fireEvent.click(screen.getByRole("button", { name: "Refresh details" }));
  expect(confirm()).toBeDisabled(); fireEvent.click(confirm()); expect(postCalls()).toHaveLength(1);
  server.caseVersion++; server.revision = revision("explicitly-reloaded");
  await act(async () => { read.resolve(await reply(server)); });
  await waitFor(() => expect(confirm()).toBeEnabled()); fireEvent.click(confirm());
  await screen.findByText(/Your submitted case details can no longer be edited/);
  expect(JSON.parse(postCalls()[1][1].body)).toMatchObject({ expectedVersion: 3, revisionId: "explicitly-reloaded" });
});

test("StrictMode's abandoned initial read cannot overwrite a current review or unlock a pending read", async () => {
  const first = deferred(), second = deferred();
  fetchMock.mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise);
  render(<React.StrictMode><ReviewedIntakePanel caseId={101} onSubmitted={jest.fn()} /></React.StrictMode>);
  await act(async () => { first.resolve(await reply({ ...server, revision: revision("abandoned") })); });
  expect(screen.queryByLabelText("Issue summary")).not.toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Loading your case…" })).toBeInTheDocument();
  await act(async () => { second.resolve(await reply(server)); });
  await waitFor(() => expect(confirm()).toBeEnabled());
  expect(screen.getByLabelText("Issue summary")).toHaveTextContent("A tenancy dispute"); expect(postCalls()).toHaveLength(0);
});

test("Stop remains available during admission and a late admission cannot start a workflow", async () => {
  server.revision = null; const ordinary = fetchMock.getMockImplementation()!, admission = deferred();
  fetchMock.mockImplementation((url: string, options: any) => url.endsWith("/sessions") ? admission.promise : ordinary(url, options));
  render(<ReviewedIntakePanel caseId={101} onSubmitted={jest.fn()} />);
  await screen.findByText(/By choosing Start interview/);
  await waitFor(() => expect(screen.getByRole("button", { name: "Start interview" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Start interview" }));
  expect(screen.queryByRole("button", { name: "End interview" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /Stop/ }));
  expect(mockVoices[0].stop).toHaveBeenCalledTimes(1);
  await act(async () => { admission.resolve(await reply({ sessionId: "late", caseVersion: 3 })); });
  expect(stages()).toEqual(["sessions"]); expect(mockVoices[0].prepare).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: "End interview" })).not.toBeInTheDocument();
});

test("saved review has two primary choices, stored prose, optional unknowns and no editor", async () => {
  await open();
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  expect(screen.getByLabelText("Issue summary")).toHaveTextContent("A tenancy dispute");
  expect(screen.getByText("Preferred name")).not.toBeVisible();
  expect(screen.getAllByText("Not provided").length).toBeGreaterThan(0);
  expect(screen.getAllByText("None provided")).toHaveLength(4);
  expect(screen.getByRole("button", { name: "Make changes" })).toBeEnabled();
  expect(confirm()).toBeEnabled();
  expect(screen.getByRole("heading", { name: "Review your case" })).toHaveFocus();
});

test("Cancel discards only unsaved editing and returns focus without requests", async () => {
  await open(); fireEvent.click(screen.getByRole("button", { name: "Make changes" }));
  expect(screen.getByLabelText("Issue summary")).toHaveFocus();
  fireEvent.change(screen.getByLabelText("Issue summary"), { target: { value: "Unsaved correction" } });
  expect(screen.queryByRole("button", { name: "Confirm & find a lawyer" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.getByLabelText("Issue summary")).toHaveTextContent("A tenancy dispute");
  expect(postCalls()).toHaveLength(0);
  await waitFor(() => expect(screen.getByRole("button", { name: "Make changes" })).toHaveFocus());
});

test.each(["manual", "agent"])("%s completion shares focused loader through Prepare and durable Save; races never regenerate", async source => {
  await startInterview();
  const prepare = deferred(), save = deferred(), ordinary = fetchMock.getMockImplementation()!;
  mockVoices[0].prepare.mockReturnValue(prepare.promise);
  fetchMock.mockImplementation((url: string, options: any) => url.endsWith("/revisions") ? save.promise : ordinary(url, options));
  if (source === "manual") fireEvent.click(screen.getByRole("button", { name: "End interview" }));
  else act(() => { mockVoices[0].options.onInterviewFinished(); });
  act(() => { mockVoices[0].options.onInterviewFinished(); mockVoices[0].options.onInterviewFinished(); });
  expect(mockVoices[0].prepare).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("heading", { name: "Preparing your summary" })).toHaveFocus();
  expect(screen.queryByRole("button", { name: "End interview" })).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Issue summary")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Stop now" })).toBeEnabled();
  await act(async () => { prepare.resolve(true); });
  await waitFor(() => expect(stages()).toEqual(["sessions", "revisions"]));
  expect(screen.getByRole("heading", { name: "Preparing your summary" })).toBeInTheDocument();
  await act(async () => { save.resolve(await reply({ ...revision("prepared-once"), caseVersion: 4 })); });
  expect(screen.getByRole("heading", { name: "Review your case" })).toHaveFocus();
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  act(() => { mockVoices[0].options.onInterviewFinished(); });
  expect(stages()).toEqual(["sessions", "revisions"]);
});

test("agent callback after unmount or case replacement cannot prepare", async () => {
  const { root, submitted } = await startInterview();
  const oldVoice = mockVoices[0];
  root.rerender(<ReviewedIntakePanel caseId={202} onSubmitted={submitted} />);
  await screen.findByRole("heading", { name: "Tell us what happened" });
  act(() => { oldVoice.options.onInterviewFinished(); });
  expect(oldVoice.prepare).not.toHaveBeenCalled();
  expect(stages()).toEqual(["sessions"]);
  root.unmount(); act(() => { oldVoice.options.onInterviewFinished(); });
  expect(oldVoice.prepare).not.toHaveBeenCalled();
});

test("sent edit cannot be cancelled, Stop remains independent, receipt returns to review", async () => {
  await open(); fireEvent.click(screen.getByRole("button", { name: "Make changes" }));
  const save = deferred(), ordinary = fetchMock.getMockImplementation()!;
  fetchMock.mockImplementation((url: string, options: any) => url.endsWith("/edits") ? save.promise : ordinary(url, options));
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Stop" })).toBeEnabled();
  await act(async () => { save.resolve(await reply({ ...revision("edited"), caseVersion: 3 })); });
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  expect(stages()).toEqual(["edits"]); expect(confirm()).toBeEnabled();
});

test("narrative comes first, compact details omit verbatim overlaps, and all stored data stays inspectable", async () => {
  server.revision.reviewedData.issue_summary = "A fictional account in Example City involving Person A.";
  server.revision.reviewedData.facts.location = "Example City";
  server.revision.reviewedData.facts.timeline = "An uncertain date";
  server.revision.reviewedData.facts.issue_description = server.revision.reviewedData.issue_summary;
  server.revision.reviewedData.key_entities.locations = ["Example City"];
  server.revision.reviewedData.key_entities.parties = ["Person A"];
  await open();
  const narrative = screen.getByLabelText("Issue summary");
  const important = screen.getByRole("region", { name: "Key details" });
  expect(narrative.compareDocumentPosition(important) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(important).not.toHaveTextContent("Example City");
  expect(important).not.toHaveTextContent("Person A");
  const additional = screen.getByText("More details").closest("details")!;
  expect(additional).not.toHaveAttribute("open");
  expect(screen.getByText("Preferred name").closest("details")).toBe(additional);
  fireEvent.click(screen.getByText("More details"));
  expect(additional).toHaveAttribute("open");
  expect(additional).toHaveTextContent("Not provided");
  expect(additional).toHaveTextContent("None provided");
  expect(additional).toHaveTextContent("Person A");
  expect(additional).toHaveTextContent(server.revision.reviewedData.issue_summary);
  expect(screen.queryByText(/rental agreement|60,000|ready for matching/i)).not.toBeInTheDocument();
  expect(postCalls()).toHaveLength(0);
});

test.each([
  ["Edit Issue summary", "Issue summary", "A revised fictional account", "summary"],
  ["Edit Location", "Location", "Example Town (as stated)", "fact"],
  ["Edit Dates", "Dates", "A date described in words\nAnother uncertain date", "entity"],
])("contextual %s prefills its DTO field and saves the full untouched snapshot", async (buttonName, fieldName, value, kind) => {
  server.revision.reviewedData.facts.location = "Example City";
  server.revision.reviewedData.facts.financial_impact = "An amount not yet agreed";
  server.revision.reviewedData.key_entities.dates = ["A date described in words"];
  const original = structuredClone(server.revision.reviewedData);
  await open();
  fireEvent.click(screen.getByRole("button", { name: buttonName }));
  expect(screen.getAllByRole("textbox")).toHaveLength(1);
  const field = screen.getByLabelText(fieldName);
  expect(field).toHaveFocus();
  expect(field).toHaveValue(kind === "summary" ? original.issue_summary : kind === "fact" ? original.facts.location : original.key_entities.dates.join("\n"));
  fireEvent.change(field, { target: { value } });
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await screen.findByText(/Changes saved/);
  const expected = structuredClone(original);
  if (kind === "summary") expected.issue_summary = value;
  else if (kind === "fact") expected.facts.location = value;
  else expected.key_entities.dates = value.split("\n");
  expect(JSON.parse(postCalls()[0][1].body)).toEqual({ expectedVersion: 2, revisionId: "revision-one", reviewedData: expected });
  expect(stages()).toEqual(["edits"]);
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  expect(confirm()).toBeEnabled();
  expect(screen.getByRole("heading", { name: "Review your case" })).toHaveFocus();
});

test("optional additions and settings use the existing DTO and preserve unknown nulls", async () => {
  await open();
  fireEvent.click(screen.getByText("More details"));
  fireEvent.click(screen.getByRole("button", { name: "Add Timeline" }));
  expect(screen.getByLabelText("Timeline")).toHaveValue("");
  fireEvent.change(screen.getByLabelText("Timeline"), { target: { value: "Date not known precisely" } });
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await screen.findByText(/Changes saved/);
  const sent = JSON.parse(postCalls()[0][1].body).reviewedData;
  expect(sent.facts.timeline).toBe("Date not known precisely");
  expect(sent.facts.alias_name).toBeNull(); expect(sent.facts.financial_impact).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Edit Language and legal area" }));
  expect(screen.getByLabelText("Preferred language")).toHaveValue("mixed");
  expect(screen.getByLabelText("Suggested area of law")).toHaveValue("property_law");
  fireEvent.change(screen.getByLabelText("Preferred language"), { target: { value: "urdu" } });
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() => expect(stages()).toEqual(["edits", "edits"]));
  await waitFor(() => expect(screen.queryByRole("combobox")).not.toBeInTheDocument());
  expect(JSON.parse(postCalls()[1][1].body).reviewedData).toEqual({ ...sent, primary_language: "urdu" });
});

test.each([false, true])("contextual Cancel restores saved data and exact trigger focus after rejection=%s", async rejected => {
  server.revision.reviewedData.facts.timeline = "Original uncertain timeline";
  await open();
  fireEvent.click(screen.getByRole("button", { name: "Edit Timeline" }));
  fireEvent.change(screen.getByLabelText("Timeline"), { target: { value: "Unsaved timeline" } });
  if (rejected) {
    const ordinary = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation((url: string, options: any) => url.endsWith("/edits") ? reply({ code: "INVALID_INTAKE" }, 422) : ordinary(url, options));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await screen.findByText(/Request rejected/);
  }
  const before = fetchMock.mock.calls.length;
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.getByText("Original uncertain timeline")).toBeInTheDocument();
  expect(screen.queryByText("Unsaved timeline")).not.toBeInTheDocument();
  expect(confirm()).toBeEnabled();
  await waitFor(() => expect(screen.getByRole("button", { name: "Edit Timeline" })).toHaveFocus());
  expect(fetchMock.mock.calls).toHaveLength(before);
});

test("presentation callback contains stages only, and callback identity cannot restart the owned voice", async () => {
  const stagesSeen = jest.fn(); server.revision = null;
  const submitted = jest.fn();
  const root = render(<ReviewedIntakePanel caseId={101} onSubmitted={submitted} onPresentationStage={stagesSeen} />);
  await screen.findByRole("button", { name: "Start interview" });
  fireEvent.click(screen.getByRole("button", { name: "Start interview" }));
  await screen.findByText(/Interview connected/);
  root.rerender(<ReviewedIntakePanel caseId={101} onSubmitted={() => submitted()} onPresentationStage={stage => stagesSeen(stage)} />);
  expect(mockVoices).toHaveLength(1);
  expect(mockVoices[0].stop).not.toHaveBeenCalled();
  const prepare = deferred(); mockVoices[0].prepare.mockReturnValue(prepare.promise);
  fireEvent.click(screen.getByRole("button", { name: "End interview" }));
  expect(stagesSeen.mock.calls.map(([stage]) => stage)).toEqual(["loading", "ready", "interview", "preparing"]);
  expect(stagesSeen.mock.calls.every(args => args.length === 1)).toBe(true);
  await act(async () => { prepare.resolve(true); });
  await screen.findByLabelText("Issue summary");
  expect(stagesSeen).toHaveBeenLastCalledWith("review");
});

test("UI language follows i18n, not the interview language, and switching it never mutates or reconnects", async () => {
  await startInterview("Urdu");
  expect(screen.getByRole("heading", { name: "Tell us about your case" })).toBeInTheDocument();
  await act(async () => { await i18n.changeLanguage("ur"); });
  expect(screen.getByRole("heading", { name: "آپ کی صوتی گفتگو" })).toBeInTheDocument();
  expect(screen.getByRole("region", { name: "Reviewed voice intake" })).toHaveAttribute("dir", "rtl");
  expect(mockVoices).toHaveLength(1); expect(stages()).toEqual(["sessions"]);
});

test("Cancel from an optional addition retains the open disclosure and returns focus to Add, not a different editor", async () => {
  await open();
  fireEvent.click(screen.getByText("More details"));
  fireEvent.click(screen.getByRole("button", { name: "Add Location" }));
  fireEvent.change(screen.getByLabelText("Location"), { target: { value: "An unsaved optional location" } });
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Add Location" })).toHaveFocus());
  expect(screen.getByText("More details").closest("details")).toHaveAttribute("open");
  expect(screen.queryByText("An unsaved optional location")).not.toBeInTheDocument();
  expect(postCalls()).toHaveLength(0);
});

test.each(["creation", "review"])("a different case revokes fresh Start during %s and isolates late results", async pendingAt => {
  server.revision = null;
  const creation = deferred(), review = deferred();
  const createCase = jest.fn(() => creation.promise);
  const original = fetchMock.getMockImplementation()!;
  if (pendingAt === "review") fetchMock.mockImplementation((url: string, options: any) => url.includes("/101/") ? review.promise : original(url, options));
  const root = render(<ReviewedIntakePanel caseId={null} createCase={createCase} onSubmitted={jest.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Start interview" }));
  if (pendingAt === "review") {
    await act(async () => { creation.resolve({ caseId: 101, created: true }); });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  }
  root.rerender(<ReviewedIntakePanel caseId={202} onSubmitted={jest.fn()} />);
  await screen.findByText(/By choosing Start interview/);
  await act(async () => {
    if (pendingAt === "creation") creation.resolve({ caseId: 101, created: true });
    else review.resolve(await reply({ ...server, status: "DRAFT" }));
  });
  expect(mockVoices).toHaveLength(0); expect(postCalls()).toHaveLength(0);
  expect(screen.getByRole("button", { name: "Start interview" })).toBeEnabled();
  expect(fetchMock.mock.calls.some(([url]) => /\/(null|undefined)\//.test(url))).toBe(false);
  expect(fetchMock.mock.calls.filter(([url]) => url.includes("/101/"))).toHaveLength(pendingAt === "review" ? 1 : 0);
  expect(fetchMock.mock.calls.some(([url]) => url.includes("/202/"))).toBe(true);
});

test("versioned processing/storage notice needs only deliberate Start; review acknowledgement remains receipt-bound", async () => {
  server.revision = null;
  render(<ReviewedIntakePanel caseId={101} onSubmitted={jest.fn()} />);
  await screen.findByText(/By choosing Start interview/);
  expect(screen.getByText(/90 days after the interview ends/)).toBeInTheDocument();
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  expect(postCalls()).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "Start interview" }));
  await screen.findByText(/Interview connected/);
  expect(JSON.parse(postCalls()[0][1].body)).toEqual({ expectedVersion: 2, processingConsent: true, transcriptNoticeVersion: "live-transcript-v1" });
  await act(async () => mockVoices[0].options.onTranscript([{ sequence: 1, speaker: "user", text: "اصل original", observedAt: "2026-01-01T00:00:00Z", interrupted: false }]));
  expect(screen.getByText("اصل original")).toHaveAttribute("dir", "auto");
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Stop/ })); });
  expect(screen.getByText("اصل original")).toBeInTheDocument();
  expect(stages()).toEqual(["sessions"]);
});

test.each([
  ["media-preload", "unavailable", "Voice media could not be loaded"],
  ["device-init", "NotAllowedError", "Check microphone permission"],
  ["microphone-check", "NotReadableError", "The microphone was not ready"],
  ["signaling", "private-provider-payload", "The voice connection could not be established"],
])("preconnect %s failure has safe guidance and no empty transcript/save controls", async (stage, reason, guidance) => {
  mockConnect = false; server.revision = null;
  render(<ReviewedIntakePanel caseId={101} onSubmitted={jest.fn()} />);
  fireEvent.click(await screen.findByRole("button", { name: "Start interview" }));
  await screen.findByText("Connecting — conversation text will appear here.");
  await act(async () => { mockVoices[0].options.onFailure(stage, reason); await mockVoices[0].stop(); });
  expect(screen.getByRole("alert")).toHaveTextContent(guidance);
  expect(screen.getByRole("heading", { name: "Your interview could not continue" })).toBeInTheDocument();
  expect(screen.queryByRole("region", { name: "Interview conversation" })).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Transcript text")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Check.*saved transcript/ })).not.toBeInTheDocument();
  expect(screen.queryByText(/Saving delayed/)).not.toBeInTheDocument();
  expect(screen.queryByText(/private-provider-payload/)).not.toBeInTheDocument();
  expect(stages()).toEqual(["sessions"]);
});

test("blocked autoplay offers an explicit playback action without another interview", async () => {
  await startInterview();
  act(() => mockVoices[0].options.onPlaybackBlocked());
  fireEvent.click(screen.getByRole("button", { name: "Play assistant audio" }));
  expect(mockVoices[0].play).toHaveBeenCalledTimes(1);
  expect(mockVoices).toHaveLength(1); expect(stages()).toEqual(["sessions"]);
  expect(screen.getByRole("button", { name: "Stop now" })).toBeEnabled();
});

test("Stop retains saved-read feedback for a connected interview whose live events were all missed", async () => {
  await startInterview();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Stop now" })); });
  expect(screen.getByRole("region", { name: "Interview conversation" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Check saved transcript" })).toBeInTheDocument();
  expect(stages()).toEqual(["sessions"]);
});

test.each(["Stop", "disconnect"])("live turns and retained %s text stay in the same interview canvas", async end => {
  await startInterview();
  const canvas = screen.getByRole("region", { name: "Interview conversation" });
  expect(canvas).toContainElement(screen.getByText("Listening — speak naturally."));
  expect(screen.queryByRole("button", { name: "Check saved transcript" })).not.toBeInTheDocument();
  await act(async () => mockVoices[0].options.onTranscript([{ sequence: 1, speaker: "user", text: "اصل conversation", observedAt: "2026-01-01T00:00:00Z", interrupted: false }]));
  const text = screen.getByText("اصل conversation");
  expect(canvas).toContainElement(text);
  expect(canvas).toContainElement(screen.getByRole("button", { name: "Stop now" }));
  expect(canvas.querySelector(".transcript-panel")).toBeNull();
  await act(async () => {
    if (end === "Stop") fireEvent.click(screen.getByRole("button", { name: "Stop now" }));
    else { mockVoices[0].options.onFailure("conversation", "unavailable"); await mockVoices[0].stop(); }
  });
  expect(screen.getByRole("region", { name: "Interview conversation" })).toBe(canvas);
  expect(canvas).toContainElement(text);
  expect(canvas).toHaveTextContent(end === "Stop" ? "Interview ended — captured text remains below." : "Interview disconnected — captured text remains below.");
  expect(canvas).toContainElement(screen.getByRole("button", { name: "Check saved transcript" }));
});

test("conversation-first layout groups connected controls and exports an opt-in fictional DOM preview", async () => {
  const { root } = await startInterview();
  await act(async () => mockVoices[0].options.onTranscript([
    { sequence: 1, speaker: "assistant", text: "Tell me what brought you here, in your own words.", observedAt: "2026-01-01T00:00:00Z", interrupted: false },
    { sequence: 2, speaker: "user", text: "مجھے ایک فرضی نوٹس ملا ہے۔\nThis is fictional preview text, not case facts.", observedAt: "2026-01-01T00:00:01Z", interrupted: false },
    { sequence: 3, speaker: "assistant", text: "Let’s take it one step at a time. What would you like to understand?", observedAt: "2026-01-01T00:00:02Z", interrupted: false },
  ]));
  const canvas = screen.getByRole("region", { name: "Interview conversation" });
  const controls = screen.getByRole("group", { name: "Interview controls" });
  expect(canvas).toContainElement(controls);
  expect(controls).toContainElement(screen.getByRole("button", { name: "End interview" }));
  expect(controls).toContainElement(screen.getByRole("button", { name: "Stop now" }));
  expect(screen.getByText("Connected", { exact: true })).toBeInTheDocument();
  expect(canvas.querySelector(".voice-orb")).toBeNull();
  expect(canvas.querySelectorAll(".transcript-text")).toHaveLength(1);
  expect(canvas.querySelector(".transcript-turn-user")).toHaveTextContent("فرضی");
  expect(screen.getByRole("heading", { name: "Tell us about your case" })).toHaveFocus();
  expect(screen.queryByLabelText("Interview guidance")).not.toBeInTheDocument();
  expect(stages()).toEqual(["sessions"]);
  exportPreview(root, "layout");
});

test("ready layout keeps the explicit processing notice beside Start without extra consent controls", async () => {
  server.revision = null;
  const root = render(<ReviewedIntakePanel caseId={101} onSubmitted={jest.fn()} />);
  const start = await screen.findByRole("button", { name: "Start interview" });
  await waitFor(() => expect(start).toBeEnabled());
  expect(start).toHaveAccessibleDescription(/By choosing Start interview/);
  expect(start.closest(".reviewed-voice-session")).toContainElement(screen.getByText(/By choosing Start interview/));
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  expect(screen.queryByText("Not started", { exact: true })).not.toBeInTheDocument();
  expect(screen.queryByText("live-transcript-v1", { exact: true })).not.toBeInTheDocument();
  expect(screen.getByText(/Describe your legal issue/)).toBeInTheDocument();
  expect(screen.queryByLabelText("Interview guidance")).not.toBeInTheDocument();
  expect(screen.queryByText(/Support details|Receipt hash:|Revision:/)).not.toBeInTheDocument();
  expect(postCalls()).toHaveLength(0);
  exportPreview(root, "ready");
});

const beginRepeat = async () => {
  fireEvent.click(screen.getByRole("button", { name: "Start a new interview" }));
  fireEvent.click(screen.getByRole("button", { name: "Start new interview" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "End interview" })).toBeEnabled());
};

test("repeat confirmation preserves the summary, carries the notice, and cancels without requests", async () => {
  const { root } = await open();
  const trigger = screen.getByRole("button", { name: "Start a new interview" });
  trigger.focus(); fireEvent.click(trigger);
  expect(screen.getByRole("dialog", { name: "Start a new interview?" })).toBeInTheDocument();
  expect(screen.getByText(/Your current summary will stay saved/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Start new interview" })).toHaveAccessibleDescription(/By choosing Start interview/);
  expect(screen.getByRole("heading", { name: "Start a new interview?" })).toHaveFocus();
  exportPreview(root, "repeat-dialog");
  const cancel = screen.getByRole("button", { name: "Keep current summary" }), start = screen.getByRole("button", { name: "Start new interview" });
  start.focus(); fireEvent.keyDown(start, { key: "Tab" }); expect(cancel).toHaveFocus();
  fireEvent.keyDown(cancel, { key: "Tab", shiftKey: true }); expect(start).toHaveFocus();
  fireEvent.keyDown(window, { key: "Escape" });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument(); expect(trigger).toHaveFocus();
  expect(screen.getByLabelText("Issue summary")).toHaveTextContent("A tenancy dispute");
  expect(mockVoices).toHaveLength(0); expect(postCalls()).toHaveLength(0);
});

test("confirmed repeat refreshes the version and reserves one deliberate same-case attempt", async () => {
  await open(); fireEvent.click(screen.getByRole("button", { name: "Start a new interview" }));
  server.caseVersion = 9;
  const start = screen.getByRole("button", { name: "Start new interview" }); fireEvent.click(start); fireEvent.click(start);
  await waitFor(() => expect(mockVoices).toHaveLength(1));
  await screen.findByText(/Interview connected/);
  expect(stages()).toEqual(["sessions"]);
  expect(JSON.parse(postCalls()[0][1].body)).toEqual({ expectedVersion: 9, processingConsent: true, transcriptNoticeVersion: "live-transcript-v1", newInterview: true });
  expect(postCalls()[0][0]).toContain("/101/intake-v2/sessions");
  expect(server.revision.revisionId).toBe("revision-one");
  expect(screen.queryByLabelText("Issue summary")).not.toBeInTheDocument();
});

test("two interviews use separate voice objects and session IDs, each with one Prepare and fresh review", async () => {
  await startInterview(); fireEvent.click(screen.getByRole("button", { name: "End interview" }));
  await screen.findByLabelText("Issue summary");
  expect(stages()).toEqual(["sessions", "revisions"]);
  await beginRepeat();
  expect(mockVoices).toHaveLength(2); expect(mockVoices[1].prepare).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "End interview" }));
  await screen.findByLabelText("Issue summary");
  expect(mockVoices[0].prepare).toHaveBeenCalledTimes(1); expect(mockVoices[1].prepare).toHaveBeenCalledTimes(1);
  expect(stages()).toEqual(["sessions", "revisions", "sessions", "revisions"]);
  expect(JSON.parse(postCalls()[3][1].body).sessionId).toBe("test-session-2");
  fireEvent.click(confirm()); await screen.findByText(/Your submitted case details can no longer be edited/);
  expect(stages()).toEqual(["sessions", "revisions", "sessions", "revisions", "confirmations", "submissions"]);
  expect(JSON.parse(postCalls()[4][1].body)).toMatchObject({ revisionId: "saved-proposal", acknowledgeReview: true, expectedVersion: 6 });
  expect(screen.queryByRole("button", { name: "Start a new interview" })).not.toBeInTheDocument();
});

test("retired voice callbacks cannot change or finish the next interview or leak its old text", async () => {
  await startInterview(); const old = mockVoices[0];
  await act(async () => old.options.onTranscript([{ sequence: 1, speaker: "user", text: "Previous interview text", observedAt: new Date().toISOString(), interrupted: false }]));
  fireEvent.click(screen.getByRole("button", { name: "Stop now" })); await beginRepeat();
  await act(async () => {
    old.options.onAdmitted({ sessionId: "retired-session", caseVersion: 99 }); old.options.onConnected();
    old.options.onTranscript([{ sequence: 2, speaker: "assistant", text: "Retired callback text", observedAt: new Date().toISOString(), interrupted: false }]);
    old.options.onPrepared(); old.options.onInterviewFinished(); old.options.onStopped(); old.options.onFailure("prepare", "unavailable"); old.options.onPlaybackBlocked();
  });
  expect(screen.getByRole("button", { name: "End interview" })).toBeEnabled();
  expect(screen.queryByText("Previous interview text")).not.toBeInTheDocument();
  expect(screen.queryByText("Retired callback text")).not.toBeInTheDocument();
  expect(mockVoices[1].prepare).not.toHaveBeenCalled(); expect(stages()).toEqual(["sessions", "sessions"]);
});

test("a repeat waits for old media cleanup before reading or admitting the next call", async () => {
  await startInterview(); fireEvent.click(screen.getByRole("button", { name: "Stop now" }));
  const closing = deferred(); mockVoices[0].stop.mockImplementation(() => closing.promise);
  fireEvent.click(screen.getByRole("button", { name: "Start a new interview" })); fireEvent.click(screen.getByRole("button", { name: "Start new interview" }));
  await act(async () => { await Promise.resolve(); }); expect(mockVoices).toHaveLength(1); expect(stages()).toEqual(["sessions"]);
  await act(async () => closing.resolve(undefined));
  await waitFor(() => expect(mockVoices).toHaveLength(2));
  expect(stages()).toEqual(["sessions", "sessions"]);
});

test("a failed replacement leaves the previous summary available for deliberate review", async () => {
  await open(); await beginRepeat();
  const voice = mockVoices[0];
  voice.prepare.mockImplementationOnce(async () => { voice.options.onFailure("prepare", "unavailable"); await voice.stop(); return false; });
  fireEvent.click(screen.getByRole("button", { name: "End interview" }));
  await screen.findByText(/Your saved summary is unchanged/);
  expect(screen.getByLabelText("Issue summary")).toHaveTextContent("A tenancy dispute");
  expect(server.revision.revisionId).toBe("revision-one"); expect(stages()).toEqual(["sessions"]);
  fireEvent.click(screen.getByRole("button", { name: "Review saved summary" })); expect(confirm()).toBeEnabled();
});

test.each(["daily_limit", "weekly_limit", "platform_limit", "active_interview", "paused"])("%s blocks interviews but not saved review, and availability checks never start calls", async reason => {
  server.interviewAllowance = { canStart: false, reason, retryAt: "2030-01-07T00:00:00Z", hasPreviousInterview: true };
  const { root } = await open();
  if (reason === "weekly_limit") exportPreview(root, "interview-limit");
  expect(screen.getByRole("button", { name: "Start a new interview" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Make changes" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "Start a new interview" })); expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  server.interviewAllowance = { canStart: true, reason: null, retryAt: null, hasPreviousInterview: true };
  fireEvent.click(screen.getByRole("button", { name: "Check availability" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Start a new interview" })).toBeEnabled());
  expect(mockVoices).toHaveLength(0); expect(postCalls()).toHaveLength(0);
});

test("a quota change during confirmation is checked before any new admission", async () => {
  await open(); fireEvent.click(screen.getByRole("button", { name: "Start a new interview" }));
  server.interviewAllowance = { canStart: false, reason: "weekly_limit", retryAt: "2030-01-07T00:00:00Z", hasPreviousInterview: true };
  fireEvent.click(screen.getByRole("button", { name: "Start new interview" }));
  await screen.findByText(/Interview limit reached/);
  expect(mockVoices).toHaveLength(0); expect(postCalls()).toHaveLength(0); expect(confirm()).toBeEnabled();
});

test("server admission denial shows a useful limit message without retries or disabling corrections", async () => {
  await open(); const ordinary = fetchMock.getMockImplementation()!;
  fetchMock.mockImplementation((url: string, options: any) => url.endsWith("/sessions") ? reply({ code: "INTERVIEW_DAILY_LIMIT", retryAt: "2030-01-07T00:00:00Z" }, 429) : ordinary(url, options));
  fireEvent.click(screen.getByRole("button", { name: "Start a new interview" })); fireEvent.click(screen.getByRole("button", { name: "Start new interview" }));
  await screen.findByText(/Interview limit reached/);
  expect(stages()).toEqual(["sessions"]); expect(screen.getByRole("button", { name: "Make changes" })).toBeEnabled();
  expect(screen.queryByText(/INTERVIEW_DAILY_LIMIT/)).not.toBeInTheDocument();
  await act(async () => { await Promise.resolve(); }); expect(stages()).toEqual(["sessions"]);
});

test("a resumed interrupted case needs confirmation even without a saved summary", async () => {
  server.revision = null; server.interviewAllowance = { canStart: true, reason: null, retryAt: null, hasPreviousInterview: true };
  render(<ReviewedIntakePanel caseId={101} onSubmitted={jest.fn()} />);
  fireEvent.click(await screen.findByRole("button", { name: "Start a new interview" }));
  expect(screen.getByText(/another interview for this case/)).toBeInTheDocument();
  expect(screen.queryByText(/Your current summary will stay saved/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" })); expect(postCalls()).toHaveLength(0);
});

test("Stop while checking a repeat revokes that Start even when the read finishes late", async () => {
  await open(); const ordinary = fetchMock.getMockImplementation()!, read = deferred();
  fetchMock.mockImplementation((url: string, options: any) => options.method === "GET" ? read.promise : ordinary(url, options));
  fireEvent.click(screen.getByRole("button", { name: "Start a new interview" })); fireEvent.click(screen.getByRole("button", { name: "Start new interview" }));
  await waitFor(() => expect(fetchMock.mock.calls.filter(([,o]) => o.method === "GET")).toHaveLength(2));
  fireEvent.click(screen.getByRole("button", { name: "Stop" }));
  await act(async () => read.resolve(await reply(server)));
  expect(mockVoices).toHaveLength(0); expect(postCalls()).toHaveLength(0); expect(confirm()).toBeEnabled();
});
