import React from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import axios from "axios";
import { MemoryRouter } from "react-router-dom";
import MyCasesSection from "./Sections/MyCasesSection";
import ClientProfileSection from "./Sections/ClientProfileSection";
import NotificationsSection, { notificationDestination } from "./Sections/NotificationsSection";
import FeedbackSection from "./Sections/FeedbackSection";
import ReviewedCaseSummary from "./utils/ReviewedCaseSummary";
import Sidebar from "./Sidebar";
import DashboardLayout from "./DashboardLayout";
import StartCaseSection from "./Sections/StartCaseSection";
import { profileProgress } from "./utils/profileProgress";

jest.mock("react-router-dom", () => { global.TextEncoder = require("util").TextEncoder; return jest.requireActual("react-router-dom"); });
jest.mock("../VoiceInterview/reviewedVoice", () => ({ ReviewedVoice: jest.fn(() => ({ start: jest.fn(), stop: jest.fn(async () => {}), prepare: jest.fn() })) }));
jest.mock("axios", () => ({ __esModule: true, default: { get: jest.fn(), put: jest.fn(), post: jest.fn() } }));
const get = axios.get as jest.Mock, put = axios.put as jest.Mock, post = axios.post as jest.Mock;
const reply = (data: any, ok = true) => ({ ok, json: async () => data, text: async () => JSON.stringify(data) });
const facts = { issue_summary: "Fictional approved facts", primary_language: "English", legal_domain: "property_law", facts: {}, key_entities: { parties: [], locations: [], dates: [], amounts: [] } };
const saved = (id = 73) => ({ caseId: id, submittedRevisionId: "approved", revision: { revisionId: "approved", reviewedData: facts } });
beforeEach(() => {
  jest.clearAllMocks(); localStorage.setItem("token", "fictional-ux-token");
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1024 });
  global.fetch = jest.fn().mockResolvedValue(reply({ cases: [], meetings: [], notifications: [] }));
  get.mockResolvedValue({ data: { cases: [], documents: [], feedback: [], profile: { fullName: "Fictional Client", email: "client@example.test" } } });
  put.mockResolvedValue({ data: { success: true } }); post.mockResolvedValue({ data: { success: true } });
});
test("an empty account offers a real first step, not a failed-search message", async () => {
  const start = jest.fn(); render(<MyCasesSection onOpenCase={jest.fn()} onStartCase={start} />);
  await screen.findByText("You haven’t started a case yet."); fireEvent.click(screen.getByRole("button", { name: "Start a case" })); expect(start).toHaveBeenCalledTimes(1);
  expect(screen.queryByText(/No cases match/)).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Search cases")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Filter by recorded stage")).not.toBeInTheDocument();
});
test("a cases error is readable and retries only the cases section", async () => {
  (global.fetch as jest.Mock).mockResolvedValueOnce(reply({ error: "private upstream details" }, false));
  render(<MyCasesSection onOpenCase={jest.fn()} />);
  await screen.findByRole("alert"); expect(screen.queryByText(/private upstream/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Try again" })); await screen.findByText("You haven’t started a case yet.");
  expect((global.fetch as jest.Mock).mock.calls.filter(([u]) => u.endsWith("/cases"))).toHaveLength(2);
});
test("draft continuation keeps the selected matter without creating a case", async () => {
  (global.fetch as jest.Mock).mockResolvedValue(reply({ cases: [{ id: "CASE-73", title: "Fictional matter", status: "INTAKE_STARTED" }], meetings: [] }));
  const resume = jest.fn(), open = jest.fn(); render(<MyCasesSection onOpenCase={open} onContinueCase={resume} />);
  fireEvent.click(await screen.findByRole("button", { name: "Continue case" })); expect(resume).toHaveBeenCalledWith(expect.objectContaining({ id: "CASE-73" })); expect(open).not.toHaveBeenCalled();
});
test("explicit entry requests that case and does not admit or create anything", async () => {
  get.mockImplementation(async (url: string) => ({ data: url.endsWith("/active") ? { case: { id: 73, intake_protocol: "live_v2", status: "INTAKE_STARTED", language: "English" } } : { documents: [], voiceNotes: [] } }));
  (global.fetch as jest.Mock).mockResolvedValue(reply({ caseId: 73, enabled: true, protocol: "live_v2", status: "INTAKE_STARTED", caseVersion: 1, revision: null, confirmation: null, submittedRevisionId: null }));
  render(<StartCaseSection requestedCaseId={73} />);
  await screen.findByRole("heading", { name: "Continue your case" });
  expect(get).toHaveBeenCalledWith(expect.stringContaining("/active"), expect.objectContaining({ params: { caseId: 73 } }));
  expect(post).not.toHaveBeenCalled(); expect((global.fetch as jest.Mock).mock.calls.every(([,o]) => o.method === "GET")).toBe(true);
});
test("mismatched explicit entry fails closed without a fresh-start fallback", async () => {
  get.mockResolvedValue({ data: { case: { id: 42, intake_protocol: "live_v2" } } }); render(<StartCaseSection requestedCaseId={73} />);
  await screen.findByText(/Saved case could not be checked/); expect(screen.queryByRole("button", { name: "Start interview" })).not.toBeInTheDocument(); expect(post).not.toHaveBeenCalled();
});
test("shared completeness counts the same fields including registered email", () => {
  const result = profileProgress({ fullName: "Fictional", email: "client@example.test", phone: "03000000000" }); expect(result.percent).toBe(33); expect(result.missing).toContain("CNIC");
});
test("incomplete profiles can save valid partial information without a fabricated CNIC or document status", async () => {
  const refreshed = jest.fn(); render(<ClientProfileSection onProfileUpdated={refreshed} />);
  await screen.findByText("Verification & Documents");
  const city = screen.getAllByLabelText("City *")[0]; fireEvent.change(city, { target: { value: "Fictional City" } });
  const save = screen.getAllByRole("button", { name: "Save Profile" })[0]; expect(save).toBeEnabled(); fireEvent.click(save);
  await waitFor(() => expect(put).toHaveBeenCalled());
  expect(put.mock.calls[0][1].profile).toEqual(expect.objectContaining({ city: "Fictional City", cnic: "", documentsCompleted: false }));
  await screen.findByText(/Your profile has been saved/); expect(refreshed).toHaveBeenCalled();
});
test("submitted case facts are owner-read-only and contain no action to change or submit", async () => {
  (global.fetch as jest.Mock).mockResolvedValue(reply(saved())); render(<ReviewedCaseSummary caseId={73} />);
  await screen.findByText("Fictional approved facts"); expect(screen.getByText(/approved and submitted/)).toBeInTheDocument();
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument(); expect(screen.queryByRole("button", { name: /edit|submit|confirm/i })).not.toBeInTheDocument();
  expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining("/73/intake-v2/review"), expect.objectContaining({ cache: "no-store" }));
});
test.each([saved(42), { ...saved(), submittedRevisionId: "different" }])("a foreign case or non-authoritative submission cannot be shown", async data => {
  (global.fetch as jest.Mock).mockResolvedValue(reply(data)); render(<ReviewedCaseSummary caseId={73} />); await screen.findByRole("alert"); expect(screen.queryByText("Fictional approved facts")).not.toBeInTheDocument();
});
test("retired summary reads cannot leak across case changes", async () => {
  let finish!: (v: any) => void; (global.fetch as jest.Mock).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValue(reply({ caseId: 42, revision: null, submittedRevisionId: null }));
  const view = render(<ReviewedCaseSummary caseId={73} />); view.rerender(<ReviewedCaseSummary caseId={42} />); await screen.findByText(/No reviewed summary/);
  await act(async () => finish(reply(saved()))); expect(screen.queryByText("Fictional approved facts")).not.toBeInTheDocument();
});
test.each([['Payment','Agreement & Payments'],['Meeting','Schedule'],['Hearing','Schedule'],['Document','Intake & Documents']])("%s notification opens the exact case and relevant section", (type, view) => {
  const destination = notificationDestination({ type, case_id: 73 })!; const params = new URLSearchParams(destination.split('?')[1]); expect(params.get('caseId')).toBe('CASE-73'); expect(params.get('view')).toBe(view);
});
test("notifications expose contextual links and failed updates stay actionable", async () => {
  const item = { id: 1, case_id: 73, title: "Fictional payment update", description: "Clearer receipt needed", type: "Payment", is_read: false, created_at: "2026-10-01" };
  (global.fetch as jest.Mock).mockResolvedValueOnce(reply({ notifications: [item] })).mockResolvedValueOnce(reply({}, false));
  render(<MemoryRouter><NotificationsSection /></MemoryRouter>); const link = await screen.findByRole("link", { name: "View agreement & payments" }); expect(link.getAttribute('href')).toContain('caseId=CASE-73');
  fireEvent.click(screen.getByRole("button", { name: "Mark read" })); await screen.findByText(/couldn’t update your notifications/); expect(screen.getByText(item.title)).toBeInTheDocument();
});
test("message-only feedback uses the supported API and preserves successful acknowledgement", async () => {
  render(<FeedbackSection />); await screen.findByText("You have not sent any feedback yet.");
  fireEvent.change(screen.getByLabelText("Your feedback"), { target: { value: "Fictional service feedback" } }); fireEvent.click(screen.getByRole("button", { name: "Send feedback" }));
  await screen.findByText("Thank you. Your feedback has been saved."); expect(post).toHaveBeenCalledWith(expect.stringContaining('/feedback'), expect.objectContaining({ message: "Fictional service feedback", ratings: {}, sentiment: "Neutral" }), expect.anything());
  expect(get).toHaveBeenCalledWith(expect.stringContaining('/feedback/mine'), expect.anything()); expect(screen.queryByText(/Advocate ID|Later you/)).not.toBeInTheDocument();
});
test("lawyer feedback selects an owned case by name, never a typed internal identifier", async () => {
  get.mockImplementation(async (url: string) => ({ data: url.endsWith('/cases') ? { cases: [{ id: 'CASE-73', title: 'Fictional tenancy', advocate: { assigned: true, name: 'Example Lawyer' } }] } : { feedback: [] } }));
  render(<FeedbackSection />); await screen.findByText("You have not sent any feedback yet.");
  fireEvent.change(screen.getByLabelText('What is your feedback about?'), { target: { value: 'Advocate' } }); fireEvent.change(screen.getByLabelText('Choose the case and lawyer'), { target: { value: 'CASE-73' } });
  fireEvent.change(screen.getByLabelText('Your feedback'), { target: { value: 'Fictional lawyer feedback' } }); fireEvent.click(screen.getByRole('button', { name: 'Send feedback' })); await screen.findByText(/Thank you/);
  expect(post.mock.calls[0][1]).toEqual(expect.objectContaining({ caseId: 'CASE-73', audience: 'Advocate' })); expect(post.mock.calls[0][1]).not.toHaveProperty('advocateUserId');
});
test("document-read recovery preserves unsaved details and never calls an upload", async () => {
  let failed = true;
  get.mockImplementation(async (url: string) => {
    if (!url.endsWith('/documents')) return { data: { profile: { fullName: 'Fictional Client', email: 'client@example.test' } } };
    if (failed) throw new Error('Fictional document failure');
    return { data: { documents: ['CNIC_FRONT','CNIC_BACK','ADDRESS_PROOF'].map((doc_type,id) => ({ id, doc_type, file_url: `/api/client/documents/${id}/download` })) } };
  });
  render(<ClientProfileSection />); await screen.findByRole('alert');
  expect(screen.queryByText(/^Still missing:/)).not.toBeInTheDocument(); expect(screen.queryByLabelText('Upload CNIC FRONT')).not.toBeInTheDocument();
  const city = screen.getAllByLabelText('City *')[0]; fireEvent.change(city, { target: { value: 'Unsaved fictional city' } });
  failed = false; fireEvent.click(screen.getByRole('button', { name: 'Try again' })); await screen.findByLabelText('Replace CNIC FRONT');
  expect(city).toHaveValue('Unsaved fictional city'); expect(post).not.toHaveBeenCalled(); expect(put).not.toHaveBeenCalled();
});
test("profile fields cannot change while the saved snapshot is pending", async () => {
  let reject!: (e: Error) => void; put.mockImplementation(() => new Promise((_r,j) => { reject = j; }));
  render(<ClientProfileSection />); await screen.findByText('Verification & Documents'); const city = screen.getAllByLabelText('City *')[0];
  fireEvent.change(city, { target: { value: 'Pending fictional city' } }); fireEvent.click(screen.getAllByRole('button', { name: 'Save Profile' })[0]);
  expect(city).toBeDisabled(); await act(async () => reject(new Error('Fictional save failure')));
  expect(city).toBeEnabled(); expect(city).toHaveValue('Pending fictional city'); await screen.findByText(/Your changes are still here/);
});
test("profile navigation preserves the same draft but a storage session change resets all retained fields", async () => {
  render(<MemoryRouter initialEntries={['/client-dashboard?section=Profile']}><DashboardLayout /></MemoryRouter>);
  await screen.findByText('Verification & Documents'); const city = screen.getAllByLabelText('City *')[0]; fireEvent.change(city, { target: { value: 'Owner A draft' } });
  fireEvent.click(within(screen.getByRole('navigation')).getByRole('button', { name: 'Feedback' })); await screen.findByLabelText('Your feedback');
  fireEvent.click(within(screen.getByRole('navigation')).getByRole('button', { name: 'Profile' })); expect(screen.getAllByLabelText('City *')[0]).toBe(city); expect(city).toHaveValue('Owner A draft');
  act(() => { localStorage.setItem('token','fictional-owner-B'); window.dispatchEvent(new StorageEvent('storage', { key: 'token' })); });
  await waitFor(() => expect(screen.getAllByLabelText('City *')[0]).not.toBe(city)); expect(screen.getAllByLabelText('City *')[0]).toHaveValue(''); expect(screen.queryByDisplayValue('Owner A draft')).not.toBeInTheDocument();
});
test("a delayed profile from the old token cannot supply the new owner's identity or eligibility", async () => {
  let resolve!: (v: any) => void;
  get.mockImplementation(async (url: string) => {
    if (url.endsWith('/api/client/') && localStorage.getItem('token') === 'fictional-ux-token') return new Promise(r => { resolve = r; });
    return { data: { documents: [], profile: { fullName: 'Owner B', email: 'b@example.test' } } };
  });
  render(<MemoryRouter initialEntries={['/client-dashboard?section=Profile']}><DashboardLayout /></MemoryRouter>);
  localStorage.setItem('token','fictional-owner-B'); await act(async () => resolve({ data: { profile: { fullName: 'Private owner A', email: 'a@example.test' } } }));
  await screen.findAllByDisplayValue('Owner B'); expect(screen.queryByDisplayValue('Private owner A')).not.toBeInTheDocument(); expect(screen.queryByText('Private owner A')).not.toBeInTheDocument();
});
test("closed mobile navigation is inert, expanded state is announced, Escape restores the trigger", async () => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
  const { container } = render(<Sidebar active="My Cases" setActive={jest.fn()} profile={null} profileLoading={false} completeness={0} canStartCase={false} />);
  const toggle = screen.getByRole('button', { name: 'Toggle sidebar' }); const aside = container.querySelector('aside')!;
  expect(aside).toHaveAttribute('inert'); expect(aside).toHaveAttribute('aria-hidden','true'); toggle.focus(); fireEvent.click(toggle);
  expect(toggle).toHaveAttribute('aria-expanded','true'); expect(aside).not.toHaveAttribute('inert'); expect(screen.getByRole('button', { name: 'Close navigation' })).toHaveFocus();
  fireEvent.keyDown(window, { key: 'Escape' }); expect(toggle).toHaveFocus(); expect(aside).toHaveAttribute('inert');
});
