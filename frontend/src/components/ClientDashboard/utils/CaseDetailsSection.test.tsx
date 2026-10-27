import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import axios from "axios";
import CaseDetailsSection from "./CaseDetailsSection";
jest.mock("./ReviewedCaseSummary", () => ({ __esModule: true, default: () => <section aria-label="Your case summary">Read-only summary fixture</section> }));
jest.mock("axios", () => ({ __esModule: true, default: { get: jest.fn(), post: jest.fn() } }));
const get = axios.get as jest.Mock;
const payload = (id: number, unlocked = true) => ({
  case: { id, title: `Selected ${id}`, status: "ACTIVE", advocate: { assigned: false } },
  unlocked, vouchers: [], meetings: [], contract: null, documents: [], voiceNotes: [], timeline: [], intake: null,
});
beforeEach(() => {
  jest.clearAllMocks();
  localStorage.setItem("token", "test");
  global.fetch = jest.fn().mockResolvedValue({ ok: true, text: async () => JSON.stringify({ contract: null }) });
  get.mockImplementation((_url: string, config: any) => Promise.resolve({ data: _url.endsWith("/access") ? { unlocked: true } : payload(config.params.caseId) }));
});
test("offers exactly five case tabs and distinguishes hearings from consultations", async () => {
  render(<CaseDetailsSection caseId={42} />);
  await screen.findByText(/Selected 42/);
  for (const name of ["Overview", "Intake & Documents", "Schedule", "Agreement & Payments", "History"]) expect(screen.getByRole("button", { name })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Schedule" }));
  expect(screen.getByText(/hearing records are not available here/)).toBeInTheDocument();
  expect(screen.getByText("Consultation meetings")).toBeInTheDocument();
});
test("locked case keeps scoped agreement available without global list requests", async () => {
  get.mockImplementation((url: string) => Promise.resolve({ data: url.endsWith("/access") ? { unlocked: false } : payload(42, false) }));
  render(<CaseDetailsSection caseId={42} />);
  fireEvent.click(await screen.findByRole("button", { name: /Open this case/ }));
  await screen.findByText("Billing & Vouchers");
  expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining("/contracts/cases/42"), expect.anything());
  expect(get.mock.calls.every(([url]) => !url.includes("billing/vouchers"))).toBe(true);
  expect(screen.queryByText("Select case")).not.toBeInTheDocument();
});
test("rejects mismatched aggregate identity", async () => {
  get.mockResolvedValue({ data: payload(99) });
  render(<CaseDetailsSection caseId={42} />);
  await screen.findByText(/Case identity mismatch/);
  expect(screen.queryByText(/Selected 99/)).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Agreement & Payments" })).not.toBeInTheDocument();
});
test("late A response cannot replace selected B", async () => {
  let resolveA: (value: any) => void = () => {};
  get.mockImplementation((url: string, config: any) => url.endsWith("/access") ? Promise.resolve({ data: { unlocked: true } }) : config.params.caseId === 42 ? new Promise(resolve => { resolveA = resolve; }) : Promise.resolve({ data: payload(43) }));
  const view = render(<CaseDetailsSection caseId={42} />);
  await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
  view.rerender(<CaseDetailsSection caseId={43} />);
  await screen.findByText(/Selected 43/);
  resolveA({ data: payload(42) });
  await waitFor(() => expect(screen.queryByText(/Selected 42/)).not.toBeInTheDocument());
});
test("supporting document upload retains selected case", async () => {
  const post = axios.post as jest.Mock;
  post.mockResolvedValue({ data: { ok: true } });
  render(<CaseDetailsSection caseId={42} />);
  fireEvent.click(await screen.findByRole("button", { name: "Intake & Documents" }));
  fireEvent.change(screen.getByLabelText(/Upload File/), { target: { files: [new File(["document"], "evidence.pdf")] } });
  await waitFor(() => expect(post).toHaveBeenCalled());
  expect(post.mock.calls[0][0]).toContain("/start-case/documents/upload");
  expect((post.mock.calls[0][1] as FormData).get("caseId")).toBe("42");
});
test("voucher detail mismatch cannot expose a proof action", async () => {
  get.mockImplementation((url: string) => Promise.resolve({ data: url.endsWith("/access") ? { unlocked: true } : url.includes("/billing/") ? { voucher: { id: 7, case_id: 99, status: "SENT" } } : { ...payload(42), vouchers: [{ id: 7, case_id: 42, title: "Selected voucher", status: "SENT", amount: 100 }] } }));
  render(<CaseDetailsSection caseId={42} />);
  fireEvent.click(await screen.findByRole("button", { name: "Agreement & Payments" }));
  await screen.findByText("Voucher case identity mismatch");
  expect(screen.queryByLabelText(/Upload Payment Proof/)).not.toBeInTheDocument();
  expect(get.mock.calls.some(([url]) => url.endsWith("/billing/vouchers"))).toBe(false);
});
test("proof upload uses only allowlisted exact-case voucher", async () => {
  const post = axios.post as jest.Mock;
  post.mockResolvedValue({ data: { ok: true } });
  get.mockImplementation((url: string) => Promise.resolve({ data: url.endsWith("/access") ? { unlocked: true } : url.includes("/billing/") ? { voucher: { id: 7, case_id: 42, title: "Selected voucher", status: "SENT" } } : { ...payload(42), vouchers: [{ id: 7, case_id: 42, title: "Selected voucher", status: "SENT", amount: 100 }] } }));
  render(<CaseDetailsSection caseId={42} />);
  fireEvent.click(await screen.findByRole("button", { name: "Agreement & Payments" }));
  fireEvent.change(await screen.findByLabelText(/Upload Payment Proof/), { target: { files: [new File(["proof"], "proof.pdf")] } });
  await waitFor(() => expect(post).toHaveBeenCalledWith(expect.stringContaining("/billing/vouchers/7/proof"), expect.any(FormData), expect.anything()));
});
test("unlocked case document controls have keyboard-accessible names without issuing uploads", async () => {
  render(<CaseDetailsSection caseId={42} />); await screen.findByText('Selected 42');
  fireEvent.click(screen.getByRole('button', { name: 'Intake & Documents' }));
  expect(screen.getByLabelText('Document type')).toBeEnabled(); expect(screen.getByLabelText('Document note (optional)')).toBeEnabled();
  expect(screen.getByLabelText('Upload File')).toHaveClass('sr-only'); expect(screen.getByLabelText('Upload File')).not.toHaveClass('hidden');
  expect((global.fetch as jest.Mock).mock.calls.every(([, options]) => !options?.method || options.method === 'GET')).toBe(true);
});

test("contract OTP and signing paths retain exact case", async () => {
  const contract = { id: 8, caseId: 42, versionNo: 1, contractText: "Terms", status: "APPROVED" };
  (global.fetch as jest.Mock).mockImplementation((url: string) => Promise.resolve({ ok: true, text: async () => JSON.stringify(url.endsWith("request-otp") ? { otpRequestId: 1 } : url.endsWith("verify-otp") ? { otpSessionId: "scoped-session" } : { contract }) }));
  render(<CaseDetailsSection caseId={42} />);
  fireEvent.click(await screen.findByRole("button", { name: "Agreement & Payments" }));
  fireEvent.click(await screen.findByRole("button", { name: "Send OTP" }));
  await screen.findByText("OTP sent to your email.");
  fireEvent.change(screen.getByPlaceholderText("Enter 6-digit OTP"), { target: { value: "123456" } });
  fireEvent.click(screen.getByRole("button", { name: "Verify OTP" }));
  await screen.findByText("OTP verified successfully. You can sign now.");
  fireEvent.change(screen.getByPlaceholderText("Type your full legal name"), { target: { value: "Test Client" } });
  screen.getAllByRole("checkbox").forEach(box => fireEvent.click(box));
  fireEvent.click(screen.getByRole("button", { name: "Sign Contract" }));
  await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining("/contracts/cases/42/sign"), expect.objectContaining({ method: "POST", body: expect.stringContaining("scoped-session") })));
  expect((global.fetch as jest.Mock).mock.calls.every(([url]) => url.includes("/contracts/cases/42"))).toBe(true);
});
test("mismatched contract response never exposes signing or OTP", async () => {
  (global.fetch as jest.Mock).mockResolvedValue({ ok: true, text: async () => JSON.stringify({ contract: { id: 8, caseId: 99, contractText: "Other case terms" } }) });
  render(<CaseDetailsSection caseId={42} />);
  fireEvent.click(await screen.findByRole("button", { name: "Agreement & Payments" }));
  await screen.findByText("Contract case identity mismatch");
  expect(screen.queryByText("Other case terms")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Send OTP" })).not.toBeInTheDocument();
});
test("auth change fences in-flight aggregate response", async () => {
  let resolveDetails: (value: any) => void = () => {};
  get.mockImplementation((url: string) => url.endsWith("/access") ? Promise.resolve({ data: { unlocked: true } }) : new Promise(resolve => { resolveDetails = resolve; }));
  render(<CaseDetailsSection caseId={42} />);
  await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
  localStorage.setItem("token", "different-user");
  resolveDetails({ data: payload(42) });
  await waitFor(() => expect(screen.queryByText(/Selected 42/)).not.toBeInTheDocument());
  expect(screen.queryByRole("button", { name: "Agreement & Payments" })).not.toBeInTheDocument();
});
test("Schedule only exposes approved non-cancelled consultation links", async () => {
  get.mockImplementation((url: string) => Promise.resolve({ data: url.endsWith("/access") ? { unlocked: true } : { ...payload(42), meetings: [
    { id: 1, case_id: 42, status: "PENDING", google_meet_link: "https://meet.google.com/pending" },
    { id: 2, case_id: 42, status: "CANCELLED", approved_at: "2026-01-01", google_meet_link: "https://meet.google.com/cancelled" },
    { id: 3, case_id: 42, status: "APPROVED", approved_at: "2026-01-01", google_meet_link: "https://meet.google.com/approved" },
  ] } }));
  render(<CaseDetailsSection caseId={42} />);
  fireEvent.click(await screen.findByRole("button", { name: "Schedule" }));
  expect(screen.getAllByRole("link")).toHaveLength(1);
  expect(screen.getByRole("link")).toHaveAttribute("href", "https://meet.google.com/approved");
});
test("local contract form rerenders cannot adopt a changed auth token", async () => {
  const contract = { id: 8, caseId: 42, versionNo: 1, contractText: "Terms", status: "APPROVED" };
  (global.fetch as jest.Mock).mockResolvedValue({ ok: true, text: async () => JSON.stringify({ contract }) });
  render(<CaseDetailsSection caseId={42} />);
  fireEvent.click(await screen.findByRole("button", { name: "Agreement & Payments" }));
  await screen.findByRole("button", { name: "Send OTP" });
  (global.fetch as jest.Mock).mockClear();
  localStorage.setItem("token", "different-user");
  fireEvent.change(screen.getByPlaceholderText("Type your full legal name"), { target: { value: "Different User" } });
  fireEvent.click(screen.getByRole("button", { name: "Send OTP" }));
  expect(global.fetch).not.toHaveBeenCalled();
});
test("failed scoped contract refresh removes stale signing actions and shows an error, not absence", async () => {
  const contract = { id: 8, caseId: 42, versionNo: 1, contractText: "Terms", status: "APPROVED" };
  (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true, text: async () => JSON.stringify({ contract }) });
  render(<CaseDetailsSection caseId={42} />);
  fireEvent.click(await screen.findByRole("button", { name: "Agreement & Payments" }));
  await screen.findByRole("button", { name: "Send OTP" });
  (global.fetch as jest.Mock).mockResolvedValue({ ok: false, text: async () => JSON.stringify({ error: "Contract temporarily unavailable" }) });
  fireEvent.click(screen.getAllByRole("button", { name: "Refresh" })[1]);
  await screen.findByText("Contract temporarily unavailable");
  expect(screen.queryByRole("button", { name: "Send OTP" })).not.toBeInTheDocument();
  expect(screen.queryByText(/No contract available/)).not.toBeInTheDocument();
});
test("rejected voucher retains aggregate rejection explanation when detail omits it", async () => {
  get.mockImplementation((url: string) => Promise.resolve({ data: url.endsWith("/access") ? { unlocked: true } : url.includes("/billing/") ? { voucher: { id: 7, case_id: 42, title: "Rejected voucher", status: "REJECTED" } } : { ...payload(42), vouchers: [{ id: 7, case_id: 42, title: "Rejected voucher", status: "REJECTED", amount: 100, rejection_note: "Receipt account number does not match voucher bank account" }] } }));
  render(<CaseDetailsSection caseId={42} />);
  fireEvent.click(await screen.findByRole("button", { name: "Agreement & Payments" }));
  expect(await screen.findByText("Reason: Receipt account number does not match voucher bank account")).toBeInTheDocument();
});
test("proof refresh reconciles exact voucher status in list and detail without global list fetch", async () => {
  let uploaded = false;
  (axios.post as jest.Mock).mockImplementation(() => { uploaded = true; return Promise.resolve({ data: { ok: true } }); });
  get.mockImplementation((url: string) => Promise.resolve({ data: url.endsWith("/access") ? { unlocked: true } : url.includes("/billing/") ? { voucher: { id: 7, case_id: 42, title: "Selected voucher", status: uploaded ? "UPLOADED" : "SENT" } } : { ...payload(42), vouchers: [{ id: 7, case_id: 42, title: "Selected voucher", status: "SENT", amount: 100 }] } }));
  render(<CaseDetailsSection caseId={42} />);
  fireEvent.click(await screen.findByRole("button", { name: "Agreement & Payments" }));
  fireEvent.change(await screen.findByLabelText(/Upload Payment Proof/), { target: { files: [new File(["proof"], "proof.pdf")] } });
  await waitFor(() => expect(screen.queryAllByText("Sent")).toHaveLength(0));
  // Mobile card, desktop list, and selected-voucher detail all agree.
  expect(screen.getAllByText("Proof Uploaded")).toHaveLength(3);
  expect(get.mock.calls.some(([url]) => url.endsWith("/billing/vouchers"))).toBe(false);
});
test("upload finishing after voucher selection changes cannot replace selected detail", async () => {
  let finishUpload: (value: any) => void = () => {};
  (axios.post as jest.Mock).mockImplementation(() => new Promise(resolve => { finishUpload = resolve; }));
  get.mockImplementation((url: string) => Promise.resolve({ data: url.endsWith("/access") ? { unlocked: true } : url.includes("/billing/") ? { voucher: { id: url.endsWith("/8") ? 8 : 7, case_id: 42, title: url.endsWith("/8") ? "Second voucher" : "First voucher", status: "SENT" } } : { ...payload(42), vouchers: [7, 8].map(id => ({ id, case_id: 42, title: id === 7 ? "First voucher" : "Second voucher", status: "SENT", amount: 100 })) } }));
  render(<CaseDetailsSection caseId={42} />);
  fireEvent.click(await screen.findByRole("button", { name: "Agreement & Payments" }));
  fireEvent.change(await screen.findByLabelText(/Upload Payment Proof/), { target: { files: [new File(["proof"], "proof.pdf")] } });
  fireEvent.click(screen.getByRole("button", { name: /Second voucher/ }));
  await waitFor(() => expect(get).toHaveBeenCalledWith(expect.stringContaining("/billing/vouchers/8"), expect.anything()));
  const count = get.mock.calls.length;
  finishUpload({ data: { ok: true } });
  await screen.findByText("Payment proof uploaded. Admin will verify it.");
  expect(get.mock.calls).toHaveLength(count);
  expect(screen.getAllByText("Second voucher")).toHaveLength(3);
});

test("locked Intake tab offers only owner transcript history without unlocking paid records", async () => {
  get.mockImplementation((url: string) => Promise.resolve({ data: url.endsWith("/access") ? { unlocked: false } : payload(42, false) }));
  (global.fetch as jest.Mock).mockResolvedValue({ ok: true, json: async () => ({ caseId: 42, interviews: [], nextBefore: null }) });
  render(<CaseDetailsSection caseId={42} />);
  fireEvent.click(await screen.findByRole("button", { name: "Intake & Documents" }));
  expect(screen.getByRole("region", { name: "Saved interview transcripts" })).toBeInTheDocument();
  expect(screen.queryByLabelText(/Upload File/)).not.toBeInTheDocument();
  expect(global.fetch).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Load recent interviews" }));
  await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining("/start-case/42/intake-v2/transcripts?limit=10"), expect.objectContaining({ cache: "no-store" })));
  expect(screen.queryByLabelText(/Upload File/)).not.toBeInTheDocument();
});
