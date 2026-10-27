import React from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import MyCasesSection from "./MyCasesSection";

let fetchMock: jest.Mock;
const records = [
  { id: "CASE-42", title: "Draft matter", status: "DRAFT" },
  { id: "CASE-73", title: "Assigned matter", status: "ADVOCATE_ASSIGNED", advocate: { assigned: true, name: "Advocate fixture" },
    payments: { voucherStatus: "GENERATED", voucherPdfUrl: "/uploads/voucher.pdf" } },
  { id: "CASE-94", title: "Unrecognized stage", status: "EXTERNAL_REVIEW" },
  { id: "CASE-95", title: "Missing stage" },
  { id: "CASE-96", title: "Signature matter", status: "CONTRACT_PENDING_SIGNATURES" },
];
beforeEach(() => {
  localStorage.clear(); sessionStorage.clear(); localStorage.setItem("token", "offline-fixture");
  fetchMock = jest.fn(async (url: string, options: any) => {
    if (options.method === "DELETE" && url.endsWith("/cases/42")) return { ok: true, json: async () => ({ ok: true }) };
    if (options.method !== "GET") throw new Error(`Unexpected offline mutation ${url}`);
    if (url.endsWith("/cases")) return { ok: true, json: async () => ({ cases: records }) };
    if (url.endsWith("/meetings/approved")) return { ok: true, json: async () => ({ meetings: [
      { case_id: 73, status: "APPROVED", google_meet_link: "https://meet.example.invalid/fixture" },
    ] }) };
    throw new Error(`Unexpected offline read ${url}`);
  });
  global.fetch = fetchMock;
});
afterEach(cleanup);

test("cards show recorded stage and known advocate, not invented readiness or placeholders", async () => {
  const onOpenCase = jest.fn(); render(<MyCasesSection onOpenCase={onOpenCase} />);
  const draft = await screen.findByRole("article", { name: "CASE-42: Draft matter" });
  expect(within(draft).getByText("Draft")).toBeInTheDocument();
  expect(within(draft).getByText(/Continue your case and review the details/)).toBeInTheDocument();
  expect(within(screen.getByRole("article", { name: "CASE-94: Unrecognized stage" })).getByText("EXTERNAL_REVIEW")).toBeInTheDocument();
  expect(screen.getByText("Stage not recorded")).toBeInTheDocument();
  expect(screen.getByText(/Advocate fixture/)).toBeInTheDocument();
  expect(screen.getByText(/Review your agreement and complete your signature/)).toBeInTheDocument();
  expect(screen.queryByText("Ongoing")).not.toBeInTheDocument();
  expect(screen.queryByText(/Court \/ Hearing/)).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Calendar|Alerts|Continue intake/ })).not.toBeInTheDocument();
  fireEvent.click(within(draft).getByRole("button", { name: "Open case" }));
  expect(onOpenCase).toHaveBeenCalledWith(expect.objectContaining({ id: "CASE-42", lifecycleStatus: "DRAFT" }));
  expect(fetchMock.mock.calls.every(([, options]) => options.method === "GET")).toBe(true);
});

test("working voucher and approved meeting shortcuts remain secondary and case scoped", async () => {
  render(<MyCasesSection onOpenCase={jest.fn()} />);
  const matter = await screen.findByRole("article", { name: "CASE-73: Assigned matter" });
  expect(within(matter).getByRole("link", { name: "Voucher PDF" }).getAttribute("href")).toMatch(/\/uploads\/voucher.pdf$/);
  expect(within(matter).getByRole("link", { name: "Approved meeting" })).toHaveAttribute("href", "https://meet.example.invalid/fixture");
  const draft = screen.getByRole("article", { name: "CASE-42: Draft matter" });
  expect(within(draft).queryByRole("link")).not.toBeInTheDocument();
});

test("search and recorded-stage filters include drafts without interpreting unknown status as active", async () => {
  render(<MyCasesSection onOpenCase={jest.fn()} />); await screen.findByText("Draft matter");
  fireEvent.change(screen.getByLabelText("Filter by recorded stage"), { target: { value: "DRAFT" } });
  expect(screen.getAllByRole("article")).toHaveLength(1);
  expect(screen.getByText("Draft matter")).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Filter by recorded stage"), { target: { value: "EXTERNAL_REVIEW" } });
  expect(screen.getAllByRole("article")).toHaveLength(1);
  expect(screen.getByText("Unrecognized stage")).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Filter by recorded stage"), { target: { value: "All" } });
  fireEvent.change(screen.getByLabelText("Search cases"), { target: { value: "Advocate fixture" } });
  expect(screen.getAllByRole("article")).toHaveLength(1);
  expect(screen.getByText("Assigned matter")).toBeInTheDocument();
});

test("existing Delete eligibility and irreversible confirmation are preserved; cancellation never writes", async () => {
  render(<MyCasesSection onOpenCase={jest.fn()} />);
  const draft = await screen.findByRole("article", { name: "CASE-42: Draft matter" });
  expect(within(screen.getByRole("article", { name: "CASE-94: Unrecognized stage" })).queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
  fireEvent.click(within(draft).getByRole("button", { name: "Delete" }));
  expect(screen.getByText("Delete Case Permanently")).toBeInTheDocument();
  expect(screen.getByText(/Permanently delete CASE-42/)).toHaveTextContent("This action cannot be undone");
  fireEvent.click(screen.getByRole("button", { name: "Keep Case" }));
  await waitFor(() => expect(screen.queryByText("Delete Case Permanently")).not.toBeInTheDocument());
  expect(fetchMock.mock.calls.every(([, options]) => options.method === "GET")).toBe(true);
  fireEvent.click(within(draft).getByRole("button", { name: "Delete" }));
  fireEvent.click(screen.getByRole("button", { name: "Delete Case" }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringMatching(/\/cases\/42$/), expect.objectContaining({ method: "DELETE" })));
  expect(fetchMock.mock.calls.filter(([, options]) => options.method === "DELETE")).toHaveLength(1);
});

test("missing authentication and failed list reads do not fabricate matters", async () => {
  localStorage.clear(); const view = render(<MyCasesSection onOpenCase={jest.fn()} />);
  await screen.findByText(/Please sign in again/);
  expect(fetchMock).not.toHaveBeenCalled(); expect(screen.queryByRole("article")).not.toBeInTheDocument();
  view.unmount(); localStorage.setItem("token", "offline-fixture");
  fetchMock.mockResolvedValueOnce({ ok: false, text: async () => "Offline list denied" });
  render(<MyCasesSection onOpenCase={jest.fn()} />);
  await screen.findByText("We couldn’t load your cases. Please try again."); expect(screen.queryByRole("article")).not.toBeInTheDocument();
});
