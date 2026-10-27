import React from "react";
import { render, screen, fireEvent, waitFor, act, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom";
import axios from "axios";
import App from "./App";
import i18n from "./context/i18n";
import { VOICE_ENTRY_PATH } from "./utils/voiceEntry";

// CRA's resolver predates package exports. Load the pinned real router, not a navigation stub.
jest.mock("react-router-dom", () => {
  global.TextEncoder = require("util").TextEncoder;
  return jest.requireActual("react-router-dom");
});
jest.mock("axios", () => ({ __esModule: true, default: { defaults: {}, get: jest.fn(), post: jest.fn() } }));
// Unrelated page chrome/screens are isolated; HomePage, Hero, auth pages, route guards,
// DashboardLayout, StartCaseSection and ReviewedIntakePanel are real.
jest.mock("./header", () => () => null);
jest.mock("./footer", () => () => null);
jest.mock("./components/LegalAssistantChat/FloatingChatWidget", () => () => null);
jest.mock("./components/AboutSection", () => () => null);
jest.mock("./components/FrameworkSection", () => () => null);
jest.mock("./components/FutureSection", () => () => null);
jest.mock("./pages/AdvocateDashboardPage", () => () => <h1>Advocate dashboard fixture</h1>);
jest.mock("./pages/AdminDashboardPage", () => () => <h1>Admin dashboard fixture</h1>);
jest.mock("./components/AdminDashboard/AdminClientProfile", () => () => null);
jest.mock("./components/AdminDashboard/AdminAdvocateProfile", () => () => null);
jest.mock("./pages/LegalAssistantPage", () => () => null);
jest.mock("./pages/MeetOurAdvocatesPage", () => () => null);
jest.mock("./pages/HowItWorksPage", () => () => null);
jest.mock("./pages/AdvocateRegisterPage", () => () => <h1>Advocate registration fixture</h1>);
jest.mock("./components/ClientDashboard/Sidebar", () => ({ __esModule: true, default: ({ setActive }: any) => (
  <nav><button onClick={() => setActive("My Cases")}>My cases fixture</button><button onClick={() => setActive("Start Case")}>Start case fixture</button></nav>
) }));
jest.mock("./components/ClientDashboard/Sections", () => ({
  StartCaseSection: jest.requireActual("./components/ClientDashboard/Sections/StartCaseSection").default,
  MyCasesSection: () => <h2>My cases fixture</h2>,
  // Models an upload callback without resetting unrelated, unsaved form fields.
  ClientProfileSection: function ProfileFixture({ onProfileUpdated }: any) {
    const [city, setCity] = require("react").useState("fixture");
    return <><input aria-label="Unsaved profile city" value={city} onChange={e => setCity(e.target.value)} />
      <button onClick={onProfileUpdated}>Profile updated fixture</button></>;
  },
}));
const mockVoiceStart = jest.fn(), mockVoiceStop = jest.fn();
jest.mock("./components/VoiceInterview/reviewedVoice", () => ({ ReviewedVoice: class {
  options: any;
  constructor(options: any) { this.options = options; mockVoiceStart(); }
  start = async () => { const admitted = await this.options.admit(); this.options.onAdmitted(admitted); this.options.onConnected(); };
  stop = async () => { mockVoiceStop(); this.options.onStopped(); };
} }));
const get = axios.get as jest.Mock;
const post = axios.post as jest.Mock;
const profile = { fullName: "Offline Client", email: "client@example.invalid", phone: "fixture", cnic: "fixture", city: "fixture",
  address: "fixture", location: "fixture", emergencyContactName: "fixture", emergencyContactPhone: "fixture", documentsCompleted: true };
let currentProfile: any, profileRead: (() => Promise<any>) | null, fetchMock: jest.Mock;
const deferredProfile = () => {
  let resolve!: (value: any) => void, reject!: (error: any) => void;
  const promise = new Promise<any>((res, rej) => { resolve = res; reject = rej; });
  profileRead = () => promise;
  return { resolve, reject };
};
const profileReads = () => get.mock.calls.filter(([url]) => url.endsWith("/api/client/")).length;
const token = (role: unknown = "client", exp = Date.now() / 1000 + 3600) =>
  `${btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }))}.${btoa(JSON.stringify({ id: 999, email: "client@example.invalid", role, exp }))}.offline-fixture-signature`;
const session = (role: unknown = "client", exp?: number) => {
  localStorage.setItem("token", token(role, exp));
  localStorage.setItem("user", JSON.stringify({ id: 999, name: "Offline Client", role }));
};
const open = (path = "/") => { window.history.replaceState({}, "", path); return render(<App />); };
const location = () => window.location.pathname + window.location.search;
const tick = async () => { await act(async () => { jest.advanceTimersByTime(1000); }); };
const login = async () => {
  fireEvent.change(screen.getByPlaceholderText("Email address"), { target: { value: "client@example.invalid" } });
  fireEvent.change(screen.getByPlaceholderText("Password"), { target: { value: "offline-password" } });
  fireEvent.click(screen.getByRole("button", { name: "Login" }));
  await act(async () => {}); await tick();
};
const interview = async () => {
  await screen.findByText(/By choosing Start interview/);
  expect(location()).toBe(VOICE_ENTRY_PATH);
  expect(screen.getByRole("button", { name: "Start interview" })).toBeEnabled();
  expect(post.mock.calls.filter(([url]) => !/auth|register/.test(url))).toHaveLength(0);
  expect(fetchMock).not.toHaveBeenCalled();
  expect(mockVoiceStart).not.toHaveBeenCalled();
  expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
  expect(localStorage.getItem("start_case_state_v2")).toBeNull();
};
beforeEach(() => {
  jest.useFakeTimers(); jest.clearAllMocks(); localStorage.clear();
  void i18n.changeLanguage("en"); currentProfile = profile; profileRead = null;
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: jest.fn(() => { throw new Error("No microphone in offline test"); }) } });
  fetchMock = jest.fn(() => { throw new Error("Unexpected admission/intake request"); }); global.fetch = fetchMock;
  get.mockImplementation(async (url: string) => {
    if (url.endsWith("/api/client/")) return profileRead ? profileRead() : { data: { profile: currentProfile } };
    if (url.endsWith("/active")) return { data: { case: null } };
    throw new Error(`Unexpected offline read ${url}`);
  });
  post.mockImplementation(async (url: string) => {
    if (url.endsWith("/api/auth/login")) return { data: { token: token(), user: { role: "client", name: "Offline Client" } } };
    if (url.endsWith("/api/register/client")) return { data: { email: "client@example.invalid" } };
    if (url.endsWith("/api/auth/verify-otp")) return { data: { message: "Email verified" } };
    throw new Error(`Unexpected offline mutation ${url}`);
  });
});
afterEach(() => { cleanup(); jest.clearAllTimers(); jest.useRealTimers(); });

test("actual homepage Start with Voice opens canonical client interview without a call/write", async () => {
  session(); open(); fireEvent.click(screen.getByRole("button", { name: /Start with Voice/ })); await interview();
});
test("actual homepage ignores obsolete cached case identity after the server reports no active case", async () => {
  session();
  const cached = JSON.stringify({ caseId: 410, selectedLanguage: "Punjabi", description: "Offline unsaved legacy description." });
  localStorage.setItem("start_case_state_v2", cached);
  open(); fireEvent.click(screen.getByRole("button", { name: /Start with Voice/ }));
  await screen.findByText(/By choosing Start interview/);
  expect(location()).toBe(VOICE_ENTRY_PATH);
  expect(screen.queryByText(/Case ID:/)).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Start interview" })).toBeEnabled();
  expect(get.mock.calls.some(([url]) => url.endsWith("/active"))).toBe(true);
  expect(get.mock.calls.every(([url]) => !url.includes("410"))).toBe(true);
  expect(post).not.toHaveBeenCalled(); expect(fetchMock).not.toHaveBeenCalled(); expect(mockVoiceStart).not.toHaveBeenCalled();
  expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
  expect(localStorage.getItem("start_case_state_v2")).toBe(cached);
});
test("signed-out homepage goes to login, then server CLIENT reaches the actual interview", async () => {
  open(); fireEvent.click(screen.getByRole("button", { name: /Start with Voice/ }));
  expect(location()).toBe("/login?intent=voice"); expect(get).not.toHaveBeenCalled();
  await login(); await interview();
});
test.each(["/voice", VOICE_ENTRY_PATH])("authenticated CLIENT direct %s resolves to canonical interview", async path => {
  session("CLIENT"); open(path); await interview();
});
test("signed-out /voice alias preserves intent, without mounting any client content", async () => {
  open("/voice"); expect(location()).toBe("/login?intent=voice");
  expect(get).not.toHaveBeenCalled(); expect(post).not.toHaveBeenCalled(); expect(fetchMock).not.toHaveBeenCalled();
});
test("legacy next=/voice login remains compatible", async () => {
  open("/login?next=/voice"); await login(); await interview();
});
test("signed-out registration -> OTP -> login retains intent but never auto-authenticates", async () => {
  open(); fireEvent.click(screen.getByRole("button", { name: /Start with Voice/ }));
  fireEvent.click(screen.getByRole("link", { name: "Register as Client" }));
  expect(location()).toBe("/register-client?intent=voice");
  expect(screen.getByRole("link", { name: "Login here" })).toHaveAttribute("href", "/login?intent=voice");
  fireEvent.change(screen.getByPlaceholderText("Full Name *"), { target: { value: "Offline Client" } });
  fireEvent.change(screen.getByPlaceholderText("Email *"), { target: { value: "client@example.invalid" } });
  fireEvent.change(screen.getByPlaceholderText("Password *"), { target: { value: "offline-password" } });
  fireEvent.click(screen.getByRole("button", { name: "Register as Client" })); await act(async () => {}); await tick();
  expect(location()).toBe("/verify-otp?intent=voice"); expect(localStorage.getItem("token")).toBeNull();
  expect(screen.getByDisplayValue("client@example.invalid")).toBeInTheDocument();
  fireEvent.change(screen.getByPlaceholderText("Enter OTP"), { target: { value: "000000" } });
  fireEvent.click(screen.getByRole("button", { name: "Verify OTP" })); await act(async () => {}); await tick();
  expect(location()).toBe("/login?intent=voice"); expect(localStorage.getItem("token")).toBeNull();
  expect(localStorage.getItem("pending_email")).toBeNull();
  await login(); await interview();
  expect(post.mock.calls.map(([url]) => url.split("/").pop())).toEqual(["client", "verify-otp", "login"]);
});
test("login verification rejection preserves email and intent; failed OTP does not bypass verification", async () => {
  post.mockRejectedValueOnce({ response: { data: { error: "Please verify OTP" } } });
  open("/login?next=/voice"); await login();
  expect(location()).toBe("/verify-otp?email=client%40example.invalid&intent=voice");
  expect(screen.getByDisplayValue("client@example.invalid")).toBeInTheDocument();
  post.mockRejectedValueOnce({ response: { data: { error: "Invalid OTP" } } });
  fireEvent.change(screen.getByPlaceholderText("Enter OTP"), { target: { value: "000000" } });
  fireEvent.click(screen.getByRole("button", { name: "Verify OTP" }));
  await screen.findByText("Invalid OTP"); await tick();
  expect(window.location.pathname).toBe("/verify-otp"); expect(localStorage.getItem("token")).toBeNull();
  expect(get).not.toHaveBeenCalled();
});
test.each(["admin", "advocate"])("server %s overrides CLIENT entry intent and stale stored role", async role => {
  session(); post.mockResolvedValue({ data: { token: token(role), user: { role } } });
  open("/login?intent=voice"); await login();
  expect(window.location.pathname).toBe(role === "admin" ? "/admin" : "/advocate-dashboard");
  expect(get).not.toHaveBeenCalled(); expect(fetchMock).not.toHaveBeenCalled();
});
test.each(["admin", "advocate"])("signed-in %s homepage click cannot mount client/voice content", async role => {
  session(role); open(); fireEvent.click(screen.getByRole("button", { name: /Start with Voice/ }));
  expect(window.location.pathname).toBe(role === "admin" ? "/admin" : "/advocate-dashboard");
  expect(get).not.toHaveBeenCalled(); expect(fetchMock).not.toHaveBeenCalled(); expect(mockVoiceStart).not.toHaveBeenCalled();
});
test.each(["admin", "advocate"])("signed-in %s direct client route and /voice alias stay role-gated", async role => {
  session(role); let root = open(VOICE_ENTRY_PATH);
  expect(window.location.pathname).toBe(role === "admin" ? "/admin" : "/advocate-dashboard");
  root.unmount(); open("/voice");
  expect(window.location.pathname).toBe(role === "admin" ? "/admin" : "/advocate-dashboard"); expect(get).not.toHaveBeenCalled();
});
test.each(["missing", "expired", "unknown", "malformed", "missing user", "mismatched role"])("%s session is denied before client or voice mount", async state => {
  if (state === "expired") session("client", Date.now() / 1000 - 1);
  if (state === "unknown") session("auditor");
  if (state === "malformed") { session(); localStorage.setItem("token", "not-a-valid-session-token"); }
  if (state === "missing user") { session(); localStorage.removeItem("user"); }
  if (state === "mismatched role") { session(); localStorage.setItem("user", JSON.stringify({ role: "admin" })); }
  open(VOICE_ENTRY_PATH); expect(location()).toBe("/login?intent=voice");
  expect(get).not.toHaveBeenCalled(); expect(fetchMock).not.toHaveBeenCalled(); expect(mockVoiceStart).not.toHaveBeenCalled();
});
test.each(["auditor", undefined])("unknown/missing server role %s is never defaulted to CLIENT", async role => {
  post.mockResolvedValue({ data: { token: token(role === undefined ? null : role), user: { role } } });
  open("/login?intent=voice"); await login();
  expect(screen.getByText(/Unable to verify your account session or role/)).toBeInTheDocument();
  expect(location()).toBe("/login?intent=voice"); expect(localStorage.getItem("token")).toBeNull(); expect(get).not.toHaveBeenCalled();
});
test.each(["https://evil.invalid/voice", "//evil.invalid", "/admin", "/client-dashboard?section=Start Case", "/voice?next=https://evil.invalid"])("arbitrary next=%s is ignored", async next => {
  open(`/login?next=${encodeURIComponent(next)}`); await login();
  await screen.findByRole("heading", { name: "My cases fixture" }); expect(location()).toBe("/client-dashboard");
  expect(get.mock.calls.some(([url]) => url.endsWith("/active"))).toBe(false);
});
test.each(["client", "advocate", "admin"])("ordinary %s login keeps its normal dashboard", async role => {
  post.mockResolvedValue({ data: { token: token(role), user: { role } } }); open("/login");
  expect(screen.getByRole("link", { name: "Register as Client" })).toHaveAttribute("href", "/register-client");
  expect(screen.getByRole("link", { name: "Register as Advocate" })).toHaveAttribute("href", "/register-advocate");
  await login(); expect(location()).toBe(role === "client" ? "/client-dashboard" : role === "admin" ? "/admin" : "/advocate-dashboard");
});
test("ordinary registration/OTP keeps normal login destination and never auto-logs in", async () => {
  localStorage.setItem("pending_email", "client@example.invalid"); open("/verify-otp");
  fireEvent.change(screen.getByPlaceholderText("Enter OTP"), { target: { value: "000000" } });
  fireEvent.click(screen.getByRole("button", { name: "Verify OTP" })); await act(async () => {}); await tick();
  expect(location()).toBe("/login"); expect(localStorage.getItem("token")).toBeNull();
});
test("profile loading blocks intake, then a complete client opens the existing interview", async () => {
  let resolve!: (value: any) => void;
  profileRead = () => new Promise(r => { resolve = r; }); session(); open(VOICE_ENTRY_PATH);
  expect(screen.getByRole("status")).toHaveTextContent("Checking your profile");
  expect(get).toHaveBeenCalledTimes(1); expect(fetchMock).not.toHaveBeenCalled();
  await act(async () => { resolve({ data: { profile } }); }); await interview();
});
test.each(["fields", "documents"])("incomplete profile %s blocks intake; explicit profile update resumes only selected intent", async missing => {
  currentProfile = { ...profile, ...(missing === "fields" ? { city: "" } : { documentsCompleted: false }) };
  session(); open(VOICE_ENTRY_PATH);
  await screen.findByText("Please finish the required profile details and documents before starting a case.");
  expect(get.mock.calls.some(([url]) => url.endsWith("/active"))).toBe(false);
  expect(fetchMock).not.toHaveBeenCalled();
  currentProfile = profile; fireEvent.click(screen.getByRole("button", { name: "Profile updated fixture" })); await interview();
});
test("profile failure blocks intake and offers refresh without falsely claiming incomplete profile", async () => {
  profileRead = async () => { throw new Error("Offline profile failure"); };
  session(); open(VOICE_ENTRY_PATH);
  await screen.findByRole("alert"); expect(screen.queryByText("Please finish the required profile details and documents before starting a case.")).not.toBeInTheDocument();
  expect(get.mock.calls.some(([url]) => url.endsWith("/active"))).toBe(false);
  expect(screen.queryByRole("button", { name: "Profile updated fixture" })).not.toBeInTheDocument();
  profileRead = null; fireEvent.click(screen.getByTitle("Refresh profile")); await interview();
});
test("manual navigation away cancels continuation from a late successful profile check", async () => {
  currentProfile = { ...profile, city: "" }; session(); open(VOICE_ENTRY_PATH);
  await screen.findByRole("button", { name: "Profile updated fixture" });
  let resolve!: (value: any) => void; profileRead = () => new Promise(r => { resolve = r; });
  fireEvent.click(screen.getByRole("button", { name: "Profile updated fixture" }));
  fireEvent.click(screen.getByRole("button", { name: "My cases fixture" }));
  await act(async () => { resolve({ data: { profile } }); });
  expect(screen.getByRole("heading", { name: "My cases fixture" })).toBeInTheDocument();
  expect(get.mock.calls.some(([url]) => url.endsWith("/active"))).toBe(false); expect(fetchMock).not.toHaveBeenCalled();
});

test("background top Refresh preserves the same interview and versioned notice while pending and after success", async () => {
  session(); open(VOICE_ENTRY_PATH); await interview();
  const notice = screen.getByText(/By choosing Start interview/);
  const reads = get.mock.calls.length, refresh = deferredProfile();
  fireEvent.click(screen.getByTitle("Refresh profile"));
  expect(screen.getByText(/By choosing Start interview/)).toBe(notice);
  expect(notice).toHaveTextContent("Google Gemini"); expect(screen.getByTitle("Refresh profile")).toBeDisabled();
  await act(async () => { refresh.resolve({ data: { profile: { ...profile } } }); });
  expect(screen.getByText(/By choosing Start interview/)).toBe(notice);
  expect(notice).toHaveTextContent("Google Gemini"); expect(screen.getByRole("button", { name: "Start interview" })).toBeEnabled();
  expect(get).toHaveBeenCalledTimes(reads + 1);
  expect(post).not.toHaveBeenCalled(); expect(fetchMock).not.toHaveBeenCalled();
  expect(mockVoiceStart).not.toHaveBeenCalled(); expect(mockVoiceStop).not.toHaveBeenCalled();
});

test("embedded profile upload callback preserves unsaved fields while pending and after unchanged incomplete refresh", async () => {
  currentProfile = { ...profile, documentsCompleted: false }; session(); open(VOICE_ENTRY_PATH);
  const city = await screen.findByLabelText("Unsaved profile city");
  fireEvent.change(city, { target: { value: "Unsaved fictional city" } });
  const refresh = deferredProfile();
  fireEvent.click(screen.getByRole("button", { name: "Profile updated fixture" }));
  expect(screen.getByLabelText("Unsaved profile city")).toBe(city);
  expect(city).toHaveValue("Unsaved fictional city");
  await act(async () => { refresh.resolve({ data: { profile: currentProfile } }); });
  expect(screen.getByLabelText("Unsaved profile city")).toBe(city);
  expect(city).toHaveValue("Unsaved fictional city");
  expect(get.mock.calls.some(([url]) => url.endsWith("/active"))).toBe(false);
  expect(post).not.toHaveBeenCalled(); expect(fetchMock).not.toHaveBeenCalled();
});

test.each(["interview", "profile"])("transient background failure retains %s state with a refresh error and no automatic retry", async section => {
  currentProfile = section === "profile" ? { ...profile, documentsCompleted: false } : profile;
  session(); open(VOICE_ENTRY_PATH);
  const field = (section === "profile" ? await screen.findByLabelText("Unsaved profile city") : await screen.findByText(/By choosing Start interview/));
  if (section === "profile") fireEvent.change(field, { target: { value: "Unsaved fictional city" } });
  const refresh = deferredProfile();
  fireEvent.click(screen.getByRole("button", section === "profile" ? { name: "Profile updated fixture" } : { name: "Refresh profile" }));
  await act(async () => { refresh.reject(new Error("Offline refresh failure")); });
  expect(screen.getByText(/Failed to refresh profile/)).toBeInTheDocument();
  expect((section === "profile" ? screen.getByLabelText("Unsaved profile city") : screen.getByText(/By choosing Start interview/))).toBe(field);
  if (section === "profile") expect(field).toHaveValue("Unsaved fictional city");
  else expect(field).toHaveTextContent("Google Gemini");
  const reads = profileReads(); await tick();
  expect(profileReads()).toBe(reads); expect(reads).toBe(2);
  expect(screen.queryByText(/Your profile could not be checked/)).not.toBeInTheDocument();
  profileRead = null; fireEvent.click(screen.getByTitle("Refresh profile")); await act(async () => {});
  expect(profileReads()).toBe(3); expect(screen.queryByText(/Failed to refresh profile/)).not.toBeInTheDocument();
  expect((section === "profile" ? screen.getByLabelText("Unsaved profile city") : screen.getByText(/By choosing Start interview/))).toBe(field);
  expect(post).not.toHaveBeenCalled(); expect(fetchMock).not.toHaveBeenCalled(); expect(mockVoiceStart).not.toHaveBeenCalled();
});

test.each(["fields", "documents"])("successful background refresh denying completeness via %s closes intake", async missing => {
  session(); open(VOICE_ENTRY_PATH); await interview();
  const refresh = deferredProfile(); fireEvent.click(screen.getByTitle("Refresh profile"));
  await act(async () => { refresh.resolve({ data: { profile: { ...profile, ...(missing === "fields" ? { city: "" } : { documentsCompleted: false }) } } }); });
  expect(screen.queryByText(/By choosing Start interview/)).not.toBeInTheDocument();
  expect(screen.getByText("Please finish the required profile details and documents before starting a case.")).toBeInTheDocument();
  expect(screen.getByLabelText("Unsaved profile city")).toBeInTheDocument();
  expect(post).not.toHaveBeenCalled(); expect(fetchMock).not.toHaveBeenCalled(); expect(mockVoiceStart).not.toHaveBeenCalled();
});

test.each(["initial", "background"])("successful %s response without a profile fails closed until explicit retry", async phase => {
  session();
  if (phase === "background") { open(VOICE_ENTRY_PATH); await interview(); }
  const refresh = deferredProfile();
  if (phase === "initial") open(VOICE_ENTRY_PATH);
  else fireEvent.click(screen.getByTitle("Refresh profile"));
  await act(async () => { refresh.resolve({ data: {} }); });
  expect(screen.getByRole("alert")).toHaveTextContent("Your profile could not be checked");
  expect(screen.queryByText(/By choosing Start interview/)).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Unsaved profile city")).not.toBeInTheDocument();
  const reads = profileReads(); await tick(); expect(profileReads()).toBe(reads);
  profileRead = null; fireEvent.click(screen.getByTitle("Refresh profile")); await interview();
});

test.each([401, 403])("initial server authorization denial %s blocks intake", async status => {
  profileRead = async () => { throw { response: { status, data: { error: "Offline authorization denial" } } }; };
  session(); open(VOICE_ENTRY_PATH);
  expect(await screen.findByRole("alert")).toHaveTextContent("Your profile could not be checked");
  expect(get.mock.calls.some(([url]) => url.endsWith("/active"))).toBe(false);
  expect(post).not.toHaveBeenCalled(); expect(fetchMock).not.toHaveBeenCalled(); expect(mockVoiceStart).not.toHaveBeenCalled();
});

test.each(["success", "network", 401, 403])("background %s refresh respects active fictional voice lifetime and never readmits", async outcome => {
  const originalGet = get.getMockImplementation()!;
  get.mockImplementation((url: string) => {
    if (url.endsWith("/active")) return Promise.resolve({ data: { case: { id: 999, intake_protocol: "live_v2", language: "mixed" } } });
    if (/\/(documents|voice)\?caseId=999$/.test(url)) return Promise.resolve({ data: {} });
    return originalGet(url);
  });
  Object.defineProperty(global, "crypto", { configurable: true, value: { randomUUID: () => "offline-session-key" } });
  Object.defineProperty(AbortSignal, "timeout", { configurable: true, value: () => new AbortController().signal });
  fetchMock.mockImplementation(async (url: string, options: any) => {
    if (url.endsWith("/review") && options.method === "GET") return { ok: true, json: async () => ({ enabled: true, protocol: "live_v2", status: "DRAFT", caseVersion: 1, revision: null, confirmation: null, submittedRevisionId: null }) };
    if (url.endsWith("/sessions") && options.method === "POST") return { ok: true, json: async () => ({ sessionId: "offline-session", caseVersion: 2 }) };
    throw new Error(`Unexpected offline intake operation ${url}`);
  });
  session(); open(VOICE_ENTRY_PATH);
  await screen.findByText(/By choosing Start interview/);
  fireEvent.click(screen.getByRole("button", { name: "Start interview" }));
  await screen.findByText(/Interview connected/);
  const end = screen.getByRole("button", { name: "End interview" }), refresh = deferredProfile();
  expect(mockVoiceStart).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByTitle("Refresh profile"));
  expect(screen.getByRole("button", { name: "End interview" })).toBe(end);
  expect(mockVoiceStop).not.toHaveBeenCalled();
  await act(async () => {
    if (outcome === "success") refresh.resolve({ data: { profile: { ...profile } } });
    else refresh.reject(outcome === "network" ? new Error("Offline refresh failure") : { response: { status: outcome, data: { error: "Offline authorization denial" } } });
  });
  if (typeof outcome === "number") {
    expect(screen.getByRole("alert")).toHaveTextContent("Your profile could not be checked");
    expect(screen.queryByRole("button", { name: "End interview" })).not.toBeInTheDocument();
    expect(mockVoiceStop).toHaveBeenCalledTimes(1);
  } else {
    expect(screen.getByRole("button", { name: "End interview" })).toBe(end);
    expect(mockVoiceStop).not.toHaveBeenCalled();
    if (outcome === "network") expect(screen.getByText(/Failed to refresh profile/)).toBeInTheDocument();
  }
  await tick();
  expect(profileReads()).toBe(2); expect(mockVoiceStart).toHaveBeenCalledTimes(1);
  expect(fetchMock.mock.calls.map(([url]) => url.split("/").pop())).toEqual(["review", "sessions"]);
  expect(post).not.toHaveBeenCalled(); expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
});

test.each([401, 403, "incomplete", "missing"])("older complete profile cannot reopen intake after newer %s result", async outcome => {
  currentProfile = { ...profile, documentsCompleted: false }; session(); open(VOICE_ENTRY_PATH);
  await screen.findByLabelText("Unsaved profile city");
  const older = deferredProfile(); fireEvent.click(screen.getByRole("button", { name: "Profile updated fixture" }));
  const newer = deferredProfile(); fireEvent.click(screen.getByRole("button", { name: "Profile updated fixture" }));
  await act(async () => {
    if (typeof outcome === "number") newer.reject({ response: { status: outcome, data: { error: "Offline authorization denial" } } });
    else newer.resolve({ data: outcome === "missing" ? {} : { profile: currentProfile } });
  });
  if (outcome === "incomplete") expect(screen.getByLabelText("Unsaved profile city")).toBeInTheDocument();
  else expect(screen.getByRole("alert")).toHaveTextContent("Your profile could not be checked");
  await act(async () => { older.resolve({ data: { profile } }); });
  if (outcome === "incomplete") expect(screen.getByLabelText("Unsaved profile city")).toBeInTheDocument();
  else expect(screen.getByRole("alert")).toHaveTextContent("Your profile could not be checked");
  expect(screen.queryByText(/By choosing Start interview/)).not.toBeInTheDocument();
  expect(get.mock.calls.some(([url]) => url.endsWith("/active"))).toBe(false);
  expect(post).not.toHaveBeenCalled(); expect(fetchMock).not.toHaveBeenCalled(); expect(mockVoiceStart).not.toHaveBeenCalled();
});

test("stale failure cannot deny access or clear loading while a newer profile check is pending", async () => {
  currentProfile = { ...profile, documentsCompleted: false }; session(); open(VOICE_ENTRY_PATH);
  const city = await screen.findByLabelText("Unsaved profile city");
  fireEvent.change(city, { target: { value: "Unsaved fictional city" } });
  const older = deferredProfile(); fireEvent.click(screen.getByRole("button", { name: "Profile updated fixture" }));
  const newer = deferredProfile(); fireEvent.click(screen.getByRole("button", { name: "Profile updated fixture" }));
  await act(async () => { older.reject({ response: { status: 403, data: { error: "Stale offline denial" } } }); });
  expect(screen.getByLabelText("Unsaved profile city")).toBe(city);
  expect(city).toHaveValue("Unsaved fictional city");
  expect(screen.getByTitle("Refresh profile")).toBeDisabled();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  await act(async () => { newer.resolve({ data: { profile: currentProfile } }); });
  expect(screen.getByLabelText("Unsaved profile city")).toBe(city);
  expect(screen.getByTitle("Refresh profile")).toBeEnabled();
  expect(get.mock.calls.some(([url]) => url.endsWith("/active"))).toBe(false);
  expect(post).not.toHaveBeenCalled(); expect(fetchMock).not.toHaveBeenCalled(); expect(mockVoiceStart).not.toHaveBeenCalled();
});

test("manual navigation during an established interview refresh never returns to Start Case", async () => {
  session(); open(VOICE_ENTRY_PATH); await interview();
  const refresh = deferredProfile(); fireEvent.click(screen.getByTitle("Refresh profile"));
  fireEvent.click(screen.getByRole("button", { name: "My cases fixture" }));
  const reads = get.mock.calls.length;
  await act(async () => { refresh.resolve({ data: { profile } }); });
  expect(screen.getByRole("heading", { name: "My cases fixture" })).toBeInTheDocument();
  expect(screen.queryByText(/By choosing Start interview/)).not.toBeInTheDocument();
  expect(get).toHaveBeenCalledTimes(reads); expect(post).not.toHaveBeenCalled(); expect(fetchMock).not.toHaveBeenCalled();
});
