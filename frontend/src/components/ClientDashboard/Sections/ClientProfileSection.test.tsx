import React from "react";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import axios from "axios";
import ClientProfileSection from "./ClientProfileSection";

jest.mock("axios", () => ({ __esModule: true, default: { get: jest.fn(), post: jest.fn(), put: jest.fn() } }));
jest.mock("../../common/AuthedLink", () => ({ __esModule: true, default: ({ url, children, ...props }: any) => <a href={url} {...props}>{children}</a> }));
const mocked = axios as jest.Mocked<typeof axios>;
const documents = [
  { id: 1, doc_type: "CNIC_FRONT", file_url: "/api/client/documents/1/download", status: "PENDING" },
  { id: 2, doc_type: "ADDRESS_PROOF", file_url: "/api/client/documents/2/download", status: "PENDING" },
];
beforeEach(() => {
  jest.clearAllMocks(); localStorage.setItem("token", "synthetic-profile-token");
  mocked.get.mockImplementation(async (url: any) => ({ data: String(url).endsWith("/documents") ? { documents } : { profile: { fullName: "Fictional Client", identityDocStatus: "PENDING_VERIFICATION", addressProofStatus: "PENDING_VERIFICATION" } } }));
});

test("document rows combine authenticated View and Replace without redundant document sections or status labels", async () => {
  render(<ClientProfileSection />);
  await screen.findByText("Verification & Documents");
  expect(screen.queryByText("Uploaded Documents")).not.toBeInTheDocument();
  expect(screen.queryByText("Identity Document")).not.toBeInTheDocument();
  expect(screen.queryByText("Address Proof")).not.toBeInTheDocument();
  const links = screen.getAllByRole("link", { name: "View" });
  expect(links).toHaveLength(2);
  const uploaded = screen.getAllByText("Uploaded");
  expect(uploaded).toHaveLength(2);
  uploaded.forEach(label => {
    expect(label).toHaveClass("text-emerald-700");
    expect(label.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
  });
  expect(screen.getByText("Missing").querySelector("svg")).toBeNull();
  expect(links[0]).toHaveAttribute("href", documents[0].file_url);
  expect(links[0].closest("label")).toBeNull();
  expect(screen.getByLabelText("Replace CNIC FRONT")).toHaveAttribute("accept", ".png,.jpg,.jpeg,.pdf");
  expect(screen.getByLabelText("Upload CNIC BACK")).toBeInTheDocument();
});

test("Replace retains the existing upload endpoint, type, file and profile refresh callback", async () => {
  const refreshed = jest.fn(); mocked.post.mockResolvedValue({ data: { documentsCompleted: false } });
  render(<ClientProfileSection onProfileUpdated={refreshed} />);
  const input = await screen.findByLabelText("Replace CNIC FRONT");
  const file = new File(["fictional document"], "replacement.pdf", { type: "application/pdf" });
  fireEvent.change(input, { target: { files: [file] } });
  await waitFor(() => expect(refreshed).toHaveBeenCalledTimes(1));
  expect(mocked.post.mock.calls[0][0]).toMatch(/\/api\/client\/documents$/);
  const data = mocked.post.mock.calls[0][1] as FormData;
  expect(data.get("docType")).toBe("CNIC_FRONT"); expect(data.get("file")).toBe(file);
});

test("mobile verification uses the same rows and retains read-only View mode", async () => {
  const { container } = render(<ClientProfileSection />);
  await screen.findByText("Verification & Documents");
  const mobile = within(container.querySelector('[class="md:hidden"]') as HTMLElement);
  fireEvent.click(mobile.getByRole("button", { name: "Verify" }));
  expect(mobile.getAllByRole("link", { name: "View" })).toHaveLength(2);
  expect(mobile.getByLabelText("Replace CNIC FRONT")).toBeInTheDocument();
  fireEvent.click(mobile.getByRole("button", { name: "View Mode" }));
  expect(mobile.getAllByRole("link", { name: "View" })).toHaveLength(2);
  expect(mobile.queryByLabelText("Replace CNIC FRONT")).not.toBeInTheDocument();
  expect(mobile.queryByText("Uploaded Documents")).not.toBeInTheDocument();
});
