import React from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import axios from "axios";
import StartCaseSection from "./StartCaseSection";
import i18n from "../../../context/i18n";
import Header from "../../../header";

const mockNavigate = jest.fn();
// CRA's resolver predates this router's package exports; only navigation is stubbed.
jest.mock("react-router-dom", () => ({
  useNavigate: () => mockNavigate,
  useLocation: () => ({ pathname: "/client-dashboard" }),
  Link: ({ to, children, className }: any) => <a href={to} className={className}>{children}</a>,
  NavLink: ({ to, children, className }: any) => <a href={to} className={typeof className === "function" ? className({ isActive: false }) : className}>{children}</a>,
}), { virtual: true });

jest.mock("axios", () => ({ __esModule: true, default: { get: jest.fn(), post: jest.fn() } }));
// Real parent, panel and submission adapter; media and HTTP are fictional/offline.
const mockVoices: any[] = [];
jest.mock("../../VoiceInterview/reviewedVoice", () => ({ ReviewedVoice: class {
  options: any;
  constructor(options: any) { this.options = options; mockVoices.push(this); }
  start = jest.fn(async () => { this.options.onAdmitted(await this.options.admit()); this.options.onConnected(); });
  prepare = jest.fn(async () => true);
  stop = jest.fn(() => { this.options.onStopped(); return Promise.resolve(); });
} }));
const get = axios.get as jest.Mock;
const post = axios.post as jest.Mock;
let failMatching: boolean, matchingRequests: number, fetchMock: jest.Mock;
let language: string, restoredSubmitted: boolean, hasRevision: boolean, freshEntry: boolean;
const reviewedData = { issue_summary: "Deposit withheld by landlord", primary_language: "english", legal_domain: "property_law",
  facts: { alias_name: null, issue_category: null, issue_description: "Deposit withheld", timeline: null, parties: null, location: null,
    financial_impact: null, previous_action: null, urgency: null, documentation: null, desired_outcome: null },
  key_entities: { parties: [], locations: [], dates: [], amounts: [] } };
const candidate = { id: 1, rank_position: 1, total_score: 80, score_breakdown: {}, reasons: [], advocate_id: 9,
  advocate_name: "Offline Advocate", advocate_email: "offline@example.invalid" };
const response = (data: object) => Promise.resolve({ ok: true, status: 200, json: async () => data });
const deferred = () => { let resolve!: (value: any) => void; const promise = new Promise<any>(r => { resolve = r; }); return { promise, resolve }; };
const mutations = () => fetchMock.mock.calls.filter(([, options]) => options.method === "POST");
beforeEach(() => {
  jest.clearAllMocks(); localStorage.clear(); localStorage.setItem("token", "offline-token");
  void i18n.changeLanguage("en");
  failMatching = false; matchingRequests = 0; mockVoices.length = 0;
  freshEntry = false; language = "English"; restoredSubmitted = false; hasRevision = true; let serial = 0;
  Object.defineProperty(global, "crypto", { configurable: true, value: { randomUUID: () => `matching-test-${++serial}` } });
  Object.defineProperty(AbortSignal, "timeout", { configurable: true, value: () => new AbortController().signal });
  Object.defineProperty(global, "structuredClone", { configurable: true, value: (v: any) => JSON.parse(JSON.stringify(v)) });
  get.mockImplementation(async (url: string) => {
    if (url.endsWith("/active") && freshEntry) return { data: { case: null } };
    if (url.endsWith("/active")) return { data: { case: { id: 101, intake_protocol: language === "English" ? "live_v2" : "legacy", language, description: "" } } };
    if (url.includes("/documents?")) return { data: { documents: [] } };
    if (url.includes("/voice?")) return { data: { voiceNotes: [] } };
    if (url.includes("/matching?")) {
      matchingRequests++;
      if (failMatching) throw new Error("Network Error");
      return { data: { candidates: [candidate] } };
    }
    throw new Error(`Unexpected Axios request ${url}`);
  });
  post.mockImplementation(async (url: string) => {
    if (url.endsWith("/documents/upload") || url.endsWith("/voice/upload")) return { data: {} };
    if (url.endsWith("/draft")) return { data: { created: true, case: { id: 101, intake_protocol: "legacy", status: "DRAFT", language: "mixed" } } };
    throw new Error(`Unexpected Axios mutation ${url}`);
  });
  fetchMock = jest.fn((url: string, options: any) => {
    if (url.endsWith("/review")) return response({ enabled: true, protocol: "live_v2", status: restoredSubmitted ? "MATCHING_REVIEW" : freshEntry ? "DRAFT" : "INTAKE_STARTED", caseVersion: 2,
      submittedRevisionId: restoredSubmitted ? "saved-revision" : null, confirmation: null,
      revision: hasRevision ? { revisionId: "saved-revision", contentHash: "saved-hash", reviewedData, modelSuggestions: null } : null });
    if (url.endsWith("/sessions")) return response({ caseVersion: 3, sessionId: "offline-session" });
    if (url.endsWith("/revisions")) return response({ caseVersion: 4, revisionId: "saved-revision", contentHash: "saved-hash", reviewedData });
    if (url.endsWith("/confirmations")) return response({ caseVersion: 3, revisionId: "saved-revision", contentHash: "saved-hash", confirmationId: "own-confirmation" });
    if (url.endsWith("/submissions")) {
      expect(JSON.parse(options.body)).toEqual({ expectedVersion: 3, revisionId: "saved-revision", confirmationId: "own-confirmation" });
      return response({ caseVersion: 4, revisionId: "saved-revision", contentHash: "saved-hash", confirmationId: "own-confirmation", status: "MATCHING_REVIEW" });
    }
    throw new Error(`Unexpected intake request ${url}`);
  });
  global.fetch = fetchMock;
});
const open = async () => {
  render(<StartCaseSection />);
  await waitFor(() => expect(screen.getByRole("button", { name: "Confirm & find a lawyer" })).toBeEnabled());
  expect(matchingRequests).toBe(0);
  await waitFor(() => expect(screen.queryByRole("heading", { name: "Select Language" })).not.toBeInTheDocument());
};

test("actual parent matching failure freezes submitted facts and retries without resubmission", async () => {
  await open(); failMatching = true;
  fireEvent.click(screen.getByRole("button", { name: "Confirm & find a lawyer" }));
  await screen.findByText(/Your intake is submitted, but lawyers could not be loaded/);
  expect(await screen.findByRole("alert")).toHaveTextContent("Lawyers could not be loaded. Please retry.");
  expect(screen.queryByRole("textbox", { name: "Issue summary" })).not.toBeInTheDocument();
  expect(screen.getByText(/Your submitted case details can no longer be edited/)).toBeInTheDocument();
  expect(screen.queryByText(/No shortlisted advocates/)).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Confirm & find a lawyer" })).not.toBeInTheDocument();
  expect(matchingRequests).toBe(1);
  expect(mutations().map(([url]) => url.split("/").pop())).toEqual(["confirmations", "submissions"]);
  failMatching = false;
  fireEvent.click(screen.getByRole("button", { name: "Find lawyers" }));
  await screen.findByText(/Offline Advocate/);
  await screen.findByRole("heading", { name: "Your case has been submitted" });
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.queryByText(/Your intake is submitted, but lawyers could not be loaded/)).not.toBeInTheDocument();
  expect(screen.queryByRole("textbox", { name: "Issue summary" })).not.toBeInTheDocument(); expect(matchingRequests).toBe(2);
  expect(mutations()).toHaveLength(2);
});

test("restored submitted review allows explicit matching load and independent Refresh, never resubmits", async () => {
  restoredSubmitted = true;
  render(<StartCaseSection />);
  await screen.findByText(/Your submitted case details can no longer be edited/);
  expect(matchingRequests).toBe(0); expect(mutations()).toHaveLength(0);
  expect(screen.queryByRole("button", { name: "Make changes" })).not.toBeInTheDocument();
  failMatching = true;
  fireEvent.click(await screen.findByRole("button", { name: "Refresh" }));
  await screen.findByRole("alert");
  expect(screen.queryByText(/No shortlisted advocates/)).not.toBeInTheDocument();
  failMatching = false; fireEvent.click(await screen.findByRole("button", { name: "Refresh" }));
  await screen.findByText(/Offline Advocate/); expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(mutations()).toHaveLength(0);
});

test("review is the main task; matching and testing reset are absent; optional uploads do not start matching", async () => {
  await open();
  expect(screen.queryByRole("heading", { name: /Matched Lawyers/ })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Refresh" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Reset" })).not.toBeInTheDocument();
  const support = screen.getByText("Supporting documents & history (optional)").closest("details")!;
  expect(support).not.toHaveAttribute("open");
  const intake = screen.getByRole("region", { name: "Reviewed voice intake" });
  expect(intake.compareDocumentPosition(support) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  fireEvent.click(screen.getByText("Supporting documents & history (optional)"));
  expect(support).toHaveAttribute("open");
  expect(screen.getByRole("heading", { name: "Uploaded Documents" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Uploaded Voice Notes" })).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("EVIDENCE"), { target: { files: [new File(["fictional offline evidence"], "offline.pdf", { type: "application/pdf" })] } });
  await screen.findByText("EVIDENCE uploaded");
  expect(post).toHaveBeenCalledTimes(1); expect(matchingRequests).toBe(0); expect(mutations()).toHaveLength(0);
});

test("interview and preparation hide supporting controls and matching until a durable reviewed submission", async () => {
  hasRevision = false;
  render(<StartCaseSection />);
  await screen.findByText(/By choosing Start interview/);
  expect(await screen.findByText("Supporting documents & history (optional)")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Start interview" }));
  await screen.findByText(/Interview connected/);
  expect(screen.queryByText("Supporting documents & history (optional)")).not.toBeInTheDocument();
  expect(screen.queryByText("Supporting Documents")).not.toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: /Matched Lawyers/ })).not.toBeInTheDocument();
  const prepare = deferred(), save = deferred(); mockVoices[0].prepare.mockReturnValue(prepare.promise);
  const ordinary = fetchMock.getMockImplementation()!;
  fetchMock.mockImplementation((url: string, options: any) => url.endsWith("/revisions") ? save.promise : ordinary(url, options));
  fireEvent.click(screen.getByRole("button", { name: "End interview" }));
  expect(screen.getByRole("heading", { name: "Preparing your summary" })).toHaveFocus();
  expect(screen.queryByText("Supporting documents & history (optional)")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Stop now" })).toBeEnabled();
  await act(async () => { prepare.resolve(true); });
  await waitFor(() => expect(mutations().map(([url]) => url.split("/").pop())).toEqual(["sessions", "revisions"]));
  expect(screen.queryByText("Supporting documents & history (optional)")).not.toBeInTheDocument();
  await act(async () => { save.resolve(await response({ caseVersion: 4, revisionId: "saved-revision", contentHash: "saved-hash", reviewedData })); });
  await screen.findByLabelText("Issue summary");
  expect(await screen.findByText("Supporting documents & history (optional)")).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: /Matched Lawyers/ })).not.toBeInTheDocument();
  expect(matchingRequests).toBe(0); expect(mockVoices).toHaveLength(1);
});

test("legacy non-AI voice note keeps recording, preview, upload, description, documents and history reachable", async () => {
  language = "Punjabi";
  const track = { stop: jest.fn() };
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: jest.fn(async () => ({ getTracks: () => [track] })) } });
  Object.defineProperty(window, "AudioContext", { configurable: true, value: class {
    createAnalyser = () => ({ fftSize: 2048, disconnect: jest.fn() });
    createMediaStreamSource = () => ({ connect: jest.fn(), disconnect: jest.fn() });
    close = async () => {};
  } });
  const raf = jest.spyOn(window, "requestAnimationFrame").mockReturnValue(1);
  Object.defineProperty(global, "MediaRecorder", { configurable: true, value: class {
    ondataavailable: any; onstop: any;
    start = () => {};
    pause = () => {}; resume = () => {};
    stop = () => { this.ondataavailable({ data: new Blob(["offline voice fixture"]) }); void this.onstop(); };
  } });
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: jest.fn(() => "blob:offline-fixture") });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: jest.fn() });
  render(<StartCaseSection />);
  await screen.findByText("Voice Note");
  expect(screen.queryByRole("region", { name: "Reviewed voice intake" })).not.toBeInTheDocument();
  const record = screen.getByRole("button", { name: "Record" });
  fireEvent.click(record); await screen.findByRole("button", { name: "Pause" });
  fireEvent.click(screen.getByRole("button", { name: "Pause" }));
  fireEvent.click(screen.getByRole("button", { name: "Resume" }));
  fireEvent.click(screen.getByRole("button", { name: "Stop" }));
  await screen.findByText(/Recording finished/);
  expect(screen.getByRole("button", { name: "Play" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "Upload" }));
  await screen.findByText("Voice note uploaded");
  const upload = post.mock.calls.find(([url]) => url.endsWith("/voice/upload"))!;
  expect(upload[1].get("caseId")).toBe("101"); expect(upload[1].get("language")).toBe("Punjabi");
  expect(upload[1].get("audio")).toBeInstanceOf(Blob);
  expect(track.stop).toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Save description" })).toBeInTheDocument();
  expect(screen.getByLabelText("EVIDENCE")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Uploaded Voice Notes" })).toBeInTheDocument();
  expect(fetchMock).not.toHaveBeenCalled();
  raf.mockRestore();
});

test("pending confirmation and rejected submission never reveal matching or bypass the server receipt", async () => {
  await open();
  const confirmation = deferred(), ordinary = fetchMock.getMockImplementation()!;
  fetchMock.mockImplementation((url: string, options: any) => {
    if (url.endsWith("/confirmations")) return confirmation.promise;
    if (url.endsWith("/submissions")) return Promise.resolve({ ok: false, status: 409, json: async () => ({ code: "CURRENT_CONFIRMATION_REQUIRED" }) });
    return ordinary(url, options);
  });
  fireEvent.click(screen.getByRole("button", { name: "Confirm & find a lawyer" }));
  expect(screen.queryByRole("heading", { name: /Matched Lawyers/ })).not.toBeInTheDocument();
  await waitFor(() => expect(screen.queryByText("Supporting documents & history (optional)")).not.toBeInTheDocument());
  expect(screen.getByRole("button", { name: "Stop" })).toBeEnabled();
  await act(async () => { confirmation.resolve(await response({ caseVersion: 3, revisionId: "saved-revision", contentHash: "saved-hash", confirmationId: "own-confirmation" })); });
  await screen.findByText(/Request rejected/);
  expect(screen.queryByRole("heading", { name: /Matched Lawyers/ })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Refresh" })).not.toBeInTheDocument();
  expect(matchingRequests).toBe(0);
  expect(mutations().map(([url]) => url.split("/").pop())).toEqual(["confirmations", "submissions"]);
});

const readyFresh = async (strict = false) => {
  freshEntry = true; hasRevision = false;
  const root = render(strict ? <React.StrictMode><StartCaseSection /></React.StrictMode> : <StartCaseSection />);
  await screen.findByText(/By choosing Start interview/);
  return root;
};
const deliberateStart = () => {
  fireEvent.click(screen.getByRole("button", { name: "Start interview" }));
};
const draftReceipt = (overrides = {}) => ({ data: { created: true, case: { id: 101, intake_protocol: "legacy", status: "DRAFT", language: "mixed", ...overrides } } });

test("fresh StrictMode entry has bilingual notice and explicit Start, no picker or pre-Start writes", async () => {
  const root = await readyFresh(true);
  expect(screen.getByText(/Describe your legal issue in English, Urdu, or both/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Start interview" })).toBeEnabled();
  expect(screen.queryByRole("heading", { name: "Select Language" })).not.toBeInTheDocument();
  expect(screen.queryByText("Interview / Voice")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Continue" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Save description" })).not.toBeInTheDocument();
  root.rerender(<React.StrictMode><StartCaseSection /></React.StrictMode>);
  await act(async () => { await i18n.changeLanguage("ur"); });
  expect(screen.getByText(/اپنا قانونی معاملہ اردو، انگریزی یا دونوں زبانوں میں بتائیں/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "گفتگو شروع کریں" })).toBeEnabled();
  expect(post).not.toHaveBeenCalled(); expect(fetchMock).not.toHaveBeenCalled(); expect(mockVoices).toHaveLength(0);
  expect(localStorage.getItem("start_case_state_v2")).toBeNull();
});

test.each([
  ["missing prior case", 410], ["cross-account case", 420], ["foreign case", 430], ["nonnumeric case", "obsolete-id"],
])("authoritative empty active case ignores cached %s and preserves unsaved local state", async (_label, cachedId) => {
  const cached = JSON.stringify({ caseId: cachedId, selectedLanguage: "Punjabi", description: "Offline unsaved legacy description." });
  localStorage.setItem("start_case_state_v2", cached);
  localStorage.setItem("unrelated-fixture", "keep");
  const root = await readyFresh(true);
  expect(screen.queryByText(/Case ID:/)).not.toBeInTheDocument();
  expect(screen.queryByText("Voice Note")).not.toBeInTheDocument();
  expect(get.mock.calls.every(([url]) => url.endsWith("/active"))).toBe(true);
  expect(post).not.toHaveBeenCalled(); expect(fetchMock).not.toHaveBeenCalled(); expect(mockVoices).toHaveLength(0);
  expect(localStorage.getItem("start_case_state_v2")).toBe(cached);
  expect(localStorage.getItem("unrelated-fixture")).toBe("keep");
  root.unmount();
  await readyFresh();
  expect(screen.queryByText(/Case ID:/)).not.toBeInTheDocument();
  expect(post).not.toHaveBeenCalled(); expect(fetchMock).not.toHaveBeenCalled();
});

test.each(["ready", "review", "submitted", "legacy"])("valid server %s active case outranks a foreign cached ID", async state => {
  localStorage.setItem("start_case_state_v2", JSON.stringify({ caseId: 430, selectedLanguage: "Punjabi", description: "Offline foreign cache." }));
  hasRevision = state !== "ready"; restoredSubmitted = state === "submitted";
  if (state === "legacy") language = "Punjabi";
  render(<React.StrictMode><StartCaseSection /></React.StrictMode>);
  if (state === "legacy") await screen.findByText("Voice Note");
  else if (state === "ready") await screen.findByText(/By choosing Start interview/);
  else await screen.findByLabelText("Issue summary");
  expect(screen.getByText("Case ID: 101")).toBeInTheDocument();
  expect(get.mock.calls.every(([url]) => !url.includes("430"))).toBe(true);
  expect(fetchMock.mock.calls.every(([url]) => url.includes("/101/intake-v2/review"))).toBe(true);
  if (state === "legacy") expect(screen.getByPlaceholderText("Write 3–5 lines about your issue...")).toHaveValue("");
  expect(post).not.toHaveBeenCalled(); expect(mutations()).toHaveLength(0); expect(mockVoices).toHaveLength(0);
});

test.each([
  ["rejected request", null], ["missing case field", { data: {} }], ["missing data", {}],
  ["missing ID", { data: { case: {} } }], ["nonnumeric ID", { data: { case: { id: "obsolete-id" } } }],
  ["invalid ID", { data: { case: { id: -1 } } }], ["zero ID", { data: { case: { id: 0 } } }],
  ["unsafe ID", { data: { case: { id: Number.MAX_SAFE_INTEGER + 1 } } }], ["numeric string ID", { data: { case: { id: "101" } } }],
  ["invalid language", { data: { case: { id: 101, language: {} } } }],
  ["invalid description", { data: { case: { id: 101, description: {} } } }],
  ["unknown protocol", { data: { case: { id: 101, intake_protocol: "other" } } }],
])("%s shows a retryable check error without binding stale case or claiming no case", async (_label, activeResponse) => {
  const cached = JSON.stringify({ caseId: 410, selectedLanguage: "English", description: "Offline unsaved text." });
  localStorage.setItem("start_case_state_v2", cached);
  if (activeResponse === null) get.mockRejectedValue(new Error("Offline active check failed"));
  else get.mockResolvedValue(activeResponse);
  const root = render(<React.StrictMode><StartCaseSection /></React.StrictMode>);
  await screen.findByText("Saved case could not be checked. Reload before starting an interview. No call was started.");
  expect(screen.queryByText(/Case ID:/)).not.toBeInTheDocument();
  expect(screen.queryByRole("region", { name: "Reviewed voice intake" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Start interview" })).not.toBeInTheDocument();
  expect(get.mock.calls.every(([url]) => url.endsWith("/active"))).toBe(true);
  expect(post).not.toHaveBeenCalled(); expect(fetchMock).not.toHaveBeenCalled(); expect(mockVoices).toHaveLength(0);
  expect(localStorage.getItem("start_case_state_v2")).toBe(cached);
  root.unmount(); // Follow the Reload guidance: a new authoritative check can recover, still without a call.
  get.mockResolvedValue({ data: { case: null } });
  await readyFresh();
  expect(screen.queryByText(/Case ID:/)).not.toBeInTheDocument();
  expect(post).not.toHaveBeenCalled(); expect(fetchMock).not.toHaveBeenCalled();
});

test("StrictMode ignores an obsolete active response and unmount prevents late case binding", async () => {
  const obsolete = deferred();
  get.mockImplementationOnce(() => obsolete.promise);
  freshEntry = true; hasRevision = false;
  const root = render(<React.StrictMode><StartCaseSection /></React.StrictMode>);
  await screen.findByText(/By choosing Start interview/);
  await act(async () => { obsolete.resolve({ data: { case: { id: 410, language: "English", intake_protocol: "live_v2" } } }); });
  expect(screen.queryByText(/Case ID:/)).not.toBeInTheDocument();
  expect(fetchMock).not.toHaveBeenCalled();
  root.unmount();
  const late = deferred(); get.mockReturnValue(late.promise);
  const next = render(<StartCaseSection />); next.unmount();
  await act(async () => { late.resolve({ data: { case: { id: 410, language: "English", intake_protocol: "live_v2" } } }); });
  expect(post).not.toHaveBeenCalled(); expect(fetchMock).not.toHaveBeenCalled();
  expect(get.mock.calls.every(([url]) => url.endsWith("/active"))).toBe(true);
});

test("consented Start after ignoring stale cache creates only once and binds the new server ID", async () => {
  localStorage.setItem("start_case_state_v2", JSON.stringify({ caseId: 410, selectedLanguage: "English" }));
  await readyFresh(true);
  const creation = deferred(); post.mockReturnValue(creation.promise);
  const start = screen.getByRole("button", { name: "Start interview" });
  fireEvent.click(start); fireEvent.click(start);
  expect(post).toHaveBeenCalledTimes(1);
  expect(post.mock.calls[0][1]).toEqual({ createOnly: true });
  await act(async () => { creation.resolve(draftReceipt({ id: 202 })); });
  await screen.findByText(/Interview connected/);
  expect(screen.getByText("Case ID: 202")).toBeInTheDocument();
  expect(mutations()).toHaveLength(1);
  expect(mutations()[0][0]).toContain("/202/intake-v2/sessions");
  expect(fetchMock.mock.calls.every(([url]) => !url.includes("/410/"))).toBe(true);
  expect(post).toHaveBeenCalledTimes(1); expect(mockVoices).toHaveLength(1);
});

test("one consented fresh Start survives parent ID handoff and creates/admit exactly once", async () => {
  await readyFresh(true);
  const creation = deferred(); post.mockReturnValue(creation.promise);
  const start = screen.getByRole("button", { name: "Start interview" });
  fireEvent.click(start); fireEvent.click(start);
  expect(post).toHaveBeenCalledTimes(1); expect(mutations()).toHaveLength(0);
  await act(async () => { creation.resolve(draftReceipt()); });
  await screen.findByText(/Interview connected/);
  expect(mockVoices).toHaveLength(1); expect(mockVoices[0].start).toHaveBeenCalledTimes(1);
  expect(post.mock.calls[0][1]).toEqual({ createOnly: true });
  expect(mutations()).toHaveLength(1);
  expect(mutations()[0][0]).toContain("/101/intake-v2/sessions");
  expect(JSON.parse(mutations()[0][1].body)).toEqual({ expectedVersion: 2, processingConsent: true, transcriptNoticeVersion: "live-transcript-v1" });
  expect(localStorage.getItem("start_case_state_v2")).toBe(JSON.stringify({ caseId: 101, selectedLanguage: "mixed" }));
  await act(async () => { await i18n.changeLanguage("ur"); });
  expect(screen.getByRole("button", { name: "گفتگو ختم کریں" })).toBeInTheDocument();
  expect(post).toHaveBeenCalledTimes(1); expect(mutations()).toHaveLength(1);
});

test.each(["unknown", "rejected", "invalid receipt"])("fresh %s creation fences retries and never admits", async outcome => {
  await readyFresh();
  if (outcome === "invalid receipt") post.mockResolvedValue(draftReceipt({ id: -1 }));
  else post.mockRejectedValue(outcome === "rejected" ? { response: { status: 400, data: { error: "Rejected" } } } : new Error("Network outcome unknown"));
  deliberateStart();
  await screen.findByRole("alert");
  expect(screen.getByRole("alert")).toHaveTextContent(/No call was started; no automatic retry/);
  expect(screen.queryByRole("button", { name: "Start interview" })).not.toBeInTheDocument();
  expect(post).toHaveBeenCalledTimes(1); expect(fetchMock).not.toHaveBeenCalled(); expect(mockVoices).toHaveLength(0);
  expect(localStorage.getItem("start_case_state_v2")).toBeNull();
});

test.each(["stop", "pagehide", "unmount"])("%s during creation revokes the fresh Start despite a late receipt", async action => {
  const root = await readyFresh(); const creation = deferred(); post.mockReturnValue(creation.promise);
  deliberateStart();
  if (action === "stop") fireEvent.click(screen.getByRole("button", { name: "Stop" }));
  else if (action === "pagehide") fireEvent(window, new Event("pagehide"));
  else root.unmount();
  await act(async () => { creation.resolve(draftReceipt()); });
  expect(post).toHaveBeenCalledTimes(1); expect(fetchMock).not.toHaveBeenCalled(); expect(mockVoices).toHaveLength(0);
  if (action !== "unmount") {
    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
    await screen.findByRole("button", { name: "Start interview" });
    expect(mutations()).toHaveLength(0); expect(mockVoices).toHaveLength(0);
  }
});

test.each(["stop", "pagehide", "unmount"])("%s during fresh authorized review cannot admit from a late read", async action => {
  const root = await readyFresh(); const review = deferred(); fetchMock.mockReturnValue(review.promise);
  deliberateStart(); await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  if (action === "stop") fireEvent.click(screen.getByRole("button", { name: "Stop" }));
  else if (action === "pagehide") fireEvent(window, new Event("pagehide"));
  else root.unmount();
  await act(async () => { review.resolve(await response({ enabled: true, protocol: "legacy", status: "DRAFT", caseVersion: 2, revision: null, submittedRevisionId: null, confirmation: null })); });
  expect(mutations()).toHaveLength(0); expect(mockVoices).toHaveLength(0);
});

test("draft endpoint returning an existing draft displays saved state and requires another explicit Start", async () => {
  await readyFresh(); post.mockResolvedValue({ ...draftReceipt(), data: { ...draftReceipt().data, created: false } });
  deliberateStart(); await screen.findByText(/Saved case loaded. No call was started/);
  expect(mockVoices).toHaveLength(0); expect(mutations()).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "Start interview" }));
  await screen.findByText(/Interview connected/);
  expect(post).toHaveBeenCalledTimes(1); expect(mutations()).toHaveLength(1);
});

test("fresh Start discovering an existing legacy voice note restores its description without admission or update", async () => {
  await readyFresh();
  const description = "Offline fixture: preserve the existing voice-note description.";
  fetchMock.mockImplementation(() => response({ enabled: true, protocol: "legacy", status: "DRAFT", caseVersion: 2, revision: null, submittedRevisionId: null, confirmation: null }));
  post.mockResolvedValue({ data: { created: false, case: draftReceipt({ language: "Punjabi", description }).data.case } });
  deliberateStart();
  await screen.findByText("Voice Note");
  expect(screen.getByPlaceholderText("Write 3–5 lines about your issue...")).toHaveValue(description);
  await waitFor(() => expect(JSON.parse(localStorage.getItem("start_case_state_v2")!)).toEqual({ caseId: 101, selectedLanguage: "Punjabi", description }));
  expect(post).toHaveBeenCalledTimes(1);
  expect(post.mock.calls[0][1]).toEqual({ createOnly: true });
  expect(mutations()).toHaveLength(0); expect(mockVoices).toHaveLength(0);
});

test.each(["saved", "submitted", "disabled", "ineligible", "wrong protocol"])("fresh Start encountering %s review never admits", async state => {
  await readyFresh();
  fetchMock.mockImplementation(() => response({ enabled: state !== "disabled", protocol: state === "wrong protocol" ? "other" : "live_v2",
    status: state === "submitted" ? "MATCHING_REVIEW" : state === "ineligible" ? "CLOSED" : "DRAFT", caseVersion: 2,
    revision: ["saved", "submitted"].includes(state) ? { revisionId: "saved-revision", contentHash: "saved-hash", reviewedData, modelSuggestions: null } : null,
    submittedRevisionId: state === "submitted" ? "saved-revision" : null, confirmation: null }));
  deliberateStart(); await screen.findByText(/Saved case loaded. No call was started/);
  expect(mockVoices).toHaveLength(0); expect(mutations()).toHaveLength(0);
  if (state === "saved") expect(screen.getByLabelText("Issue summary")).toHaveTextContent(reviewedData.issue_summary);
  if (state === "submitted") expect(screen.getByText(/Your submitted case details can no longer be edited/)).toBeInTheDocument();
});

test.each(["ready", "review", "submitted"])("restored %s live entry has no language gate, writes, or automatic call", async state => {
  hasRevision = state !== "ready"; restoredSubmitted = state === "submitted";
  render(<React.StrictMode><StartCaseSection /></React.StrictMode>);
  if (state === "ready") await screen.findByText(/By choosing Start interview/);
  else await screen.findByLabelText("Issue summary");
  expect(screen.queryByRole("heading", { name: "Select Language" })).not.toBeInTheDocument();
  expect(screen.queryByText("Interview / Voice")).not.toBeInTheDocument();
  expect(post).not.toHaveBeenCalled(); expect(mutations()).toHaveLength(0); expect(mockVoices).toHaveLength(0);
});

test("an ambiguous fresh create receipt never admits and reload only restores saved state", async () => {
  const root = await readyFresh();
  post.mockResolvedValue({ data: { case: draftReceipt().data.case } });
  deliberateStart(); await screen.findByRole("alert");
  expect(fetchMock).not.toHaveBeenCalled(); expect(mockVoices).toHaveLength(0);
  root.unmount(); freshEntry = false;
  render(<StartCaseSection />);
  await screen.findByText(/By choosing Start interview/);
  expect(post).toHaveBeenCalledTimes(1); expect(mutations()).toHaveLength(0);
  expect(mockVoices).toHaveLength(0);
});

test("restored legacy draft is read-only on entry and is never rewritten to mixed", async () => {
  language = "Punjabi";
  render(<React.StrictMode><StartCaseSection /></React.StrictMode>);
  await screen.findByText("Voice Note");
  expect(post).not.toHaveBeenCalled(); expect(fetchMock).not.toHaveBeenCalled();
  expect(JSON.parse(localStorage.getItem("start_case_state_v2")!).selectedLanguage).toBe("Punjabi");
});


test("the actual global English/Urdu UI switch remains independent of fresh interview notice and Start", async () => {
  freshEntry = true; hasRevision = false;
  const root = render(<><Header /><StartCaseSection /></>);
  await screen.findByText(/By choosing Start interview/);
  fireEvent.click(screen.getByRole("button", { name: "اردو" }));
  await screen.findByRole("button", { name: "گفتگو شروع کریں" });
  expect(localStorage.getItem("lang")).toBe("ur"); expect(document.dir).toBe("rtl");
  expect(mockNavigate).toHaveBeenCalledWith(0);
  expect(post).not.toHaveBeenCalled(); expect(fetchMock).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "English" }));
  await screen.findByRole("button", { name: "Start interview" });
  expect(localStorage.getItem("lang")).toBe("en"); expect(document.dir).toBe("ltr");
  expect(mockNavigate).toHaveBeenCalledTimes(2);
  root.unmount(); // The header's real navigation reloads the page; restoration must remain inert too.
  render(<StartCaseSection />);
  await screen.findByText(/By choosing Start interview/);
  expect(post).not.toHaveBeenCalled(); expect(fetchMock).not.toHaveBeenCalled(); expect(mockVoices).toHaveLength(0);
});
