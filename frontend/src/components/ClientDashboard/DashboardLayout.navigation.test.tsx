import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import axios from "axios";
import { BrowserRouter } from "react-router-dom";
import DashboardLayout from "./DashboardLayout";

jest.mock("react-router-dom", () => {
  global.TextEncoder = require("util").TextEncoder;
  return jest.requireActual("react-router-dom");
});
jest.mock("axios", () => ({ __esModule: true, default: { get: jest.fn() } }));
const mockMutation = jest.fn();
jest.mock("./Sections", () => ({
  MyCasesSection: jest.requireActual("./Sections/MyCasesSection").default,
  StartCaseSection: () => <h2>Interview fixture</h2>,
  ClientProfileSection: () => <h2>Profile fixture</h2>,
  NotificationsSection: () => <h2>Notifications fixture</h2>,
  FeedbackSection: () => <h2>Feedback fixture</h2>,
  // Selection contract only: the next owner tests the actual workspace internals.
  CaseDetailsSection: function Details({ caseId, caseRef, onBack }: any) {
    const [initialId] = require("react").useState(caseId);
    return <><h2>Case details {caseId}</h2><p>Mounted case {initialId}; reference {caseRef}</p>
      <button onClick={() => mockMutation(caseId)}>Case action fixture</button>
      <button onClick={onBack}>Back to My Cases</button></>;
  },
}));
const completeProfile = {
  fullName: "Client fixture", email: "client@example.invalid", phone: "fixture", cnic: "fixture", city: "fixture",
  address: "fixture", location: "fixture", emergencyContactName: "fixture", emergencyContactPhone: "fixture", documentsCompleted: true,
};
const open = (search = "") => {
  window.history.replaceState({}, "", `/client-dashboard${search}`);
  return render(<BrowserRouter><DashboardLayout /></BrowserRouter>);
};
const go = (search: string) => act(() => {
  window.history.pushState({}, "", `/client-dashboard${search}`);
  window.dispatchEvent(new PopStateEvent("popstate"));
});
const query = () => new URLSearchParams(window.location.search);
let fetchMock: jest.Mock;
beforeEach(() => {
  jest.clearAllMocks(); localStorage.clear(); sessionStorage.clear();
  localStorage.setItem("token", "offline-fixture");
  (axios.get as jest.Mock).mockResolvedValue({ data: { profile: completeProfile } });
  fetchMock = jest.fn(async (url: string, options: any) => {
    if (options?.method !== "GET") throw new Error(`Unexpected offline mutation ${url}`);
    if (url.endsWith("/cases")) return { ok: true, json: async () => ({ cases: [
      { id: "CASE-42", title: "Matter A", status: "CASE_ACTIVE" },
      { id: "CASE-73", title: "Matter B", status: "CASE_ACTIVE" },
    ] }) };
    if (url.endsWith("/meetings/approved")) return { ok: true, json: async () => ({ meetings: [] }) };
    throw new Error(`Unexpected offline read ${url}`);
  });
  global.fetch = fetchMock;
});
afterEach(cleanup);

test("default hub has exactly five main items, including drafts, and internal Start Case compatibility", async () => {
  open(); await screen.findByText("Matter A");
  const nav = screen.getByRole("navigation");
  expect(within(nav).getAllByRole("button").map((button) => button.textContent)).toEqual([
    "My Cases", "Start a Case", "Profile", "Notifications", "Feedback",
  ]);
  expect(within(nav).getByRole("button", { name: "My Cases" })).toHaveAttribute("aria-current", "page");
  fireEvent.click(within(nav).getByRole("button", { name: "Start a Case" }));
  expect(query().get("section")).toBe("Start Case");
  expect(screen.getByRole("heading", { name: "Interview fixture" })).toBeInTheDocument();
});

test("Open case selects B exactly, persists across remount, and clears selection when returning to hub", async () => {
  const view = open();
  const b = await screen.findByRole("article", { name: "CASE-73: Matter B" });
  fireEvent.click(within(b).getByRole("button", { name: "Open case" }));
  expect(query().get("caseId")).toBe("CASE-73");
  expect(screen.getByRole("heading", { name: "Case details 73" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "My Cases" })).toHaveAttribute("aria-current", "page");
  fireEvent.click(screen.getByRole("button", { name: "Case action fixture" }));
  expect(mockMutation).toHaveBeenLastCalledWith(73);
  const search = window.location.search; view.unmount(); open(search);
  expect(screen.getByRole("heading", { name: "Case details 73" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Back to My Cases" }));
  await screen.findByText("Matter A");
  expect(query().get("section")).toBe("My Cases"); expect(query().has("caseId")).toBe(false);
});

test("browser Back returns from the exact selected case to the hub", async () => {
  open();
  const a = await screen.findByRole("article", { name: "CASE-42: Matter A" });
  fireEvent.click(within(a).getByRole("button", { name: "Open case" }));
  expect(screen.getByRole("heading", { name: "Case details 42" })).toBeInTheDocument();
  act(() => window.history.back());
  await screen.findByRole("article", { name: "CASE-42: Matter A" });
  expect(query().has("caseId")).toBe(false);
  expect(screen.queryByRole("button", { name: "Case action fixture" })).not.toBeInTheDocument();
});

test("history changes remount the selected workspace and never retain the prior case's state/actions", async () => {
  open("?section=Case%20Details&caseId=42");
  expect(screen.getByText("Mounted case 42; reference 42")).toBeInTheDocument();
  go("?section=Case%20Details&caseId=73");
  expect(screen.getByText("Mounted case 73; reference 73")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Case action fixture" }));
  expect(mockMutation).toHaveBeenLastCalledWith(73);
  go("?section=Case%20Details&caseId=42");
  fireEvent.click(screen.getByRole("button", { name: "Case action fixture" }));
  expect(mockMutation).toHaveBeenLastCalledWith(42);
  go("?section=Case%20Details");
  expect(screen.queryByRole("button", { name: "Case action fixture" })).not.toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Choose a case" })).toBeInTheDocument();
  await waitFor(() => expect((axios.get as jest.Mock).mock.calls.filter(([url]) => url.endsWith("/api/client/"))).toHaveLength(1));
});

test.each(["Case Details", "Billing", "Contract"])("legacy %s with explicit caseId selects that same case", async section => {
  open(`?section=${encodeURIComponent(section)}&caseId=CASE-73`);
  expect(screen.getByRole("heading", { name: "Case details 73" })).toBeInTheDocument();
  expect(screen.queryByText("Case details 42")).not.toBeInTheDocument();
  await waitFor(() => expect((axios.get as jest.Mock).mock.calls.filter(([url]) => url.endsWith("/api/client/"))).toHaveLength(1));
});

test.each(["Case Details", "Billing", "Contract"])("unscoped legacy %s requires choosing a case", async section => {
  open(`?section=${encodeURIComponent(section)}`);
  expect(screen.getByRole("heading", { name: "Choose a case" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Case action fixture" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Go to My Cases" }));
  await screen.findByText("Matter A");
});

test.each(["0", "-1", "1.5", "1e2", "Infinity", "CASE-42-extra", "CASE-", "abc", "9007199254740992"])("invalid selected ID %s never guesses", async id => {
  open(`?section=Case%20Details&caseId=${encodeURIComponent(id)}`);
  expect(screen.getByRole("heading", { name: "Choose a case" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Case action fixture" })).not.toBeInTheDocument();
  await waitFor(() => expect((axios.get as jest.Mock).mock.calls.filter(([url]) => url.endsWith("/api/client/"))).toHaveLength(1));
  expect(fetchMock).not.toHaveBeenCalled();
});

test.each([
  { ...completeProfile, city: "" },
  { ...completeProfile, documentsCompleted: false },
])("Start Case deep link and sidebar retain profile/document gate", async profile => {
  (axios.get as jest.Mock).mockResolvedValue({ data: { profile } });
  open("?section=Start%20Case");
  await screen.findByRole("heading", { name: "Profile fixture" });
  expect(screen.queryByRole("heading", { name: "Interview fixture" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Start a Case LOCKED" }));
  expect(query().get("section")).toBe("Profile");
  expect(fetchMock).not.toHaveBeenCalled();
});

test("direct voice entry waits for profile and handles failed check without opening interview", async () => {
  let reject!: (error: unknown) => void;
  (axios.get as jest.Mock).mockReturnValue(new Promise((_resolve, rej) => { reject = rej; }));
  open("?section=Start%20Case");
  expect(screen.getByRole("status")).toHaveTextContent("Checking your profile");
  await act(async () => reject(new Error("offline profile failure")));
  expect(screen.getByRole("alert")).toHaveTextContent("Your profile could not be checked");
  expect(screen.queryByRole("heading", { name: "Interview fixture" })).not.toBeInTheDocument();
});
