import { fireEvent, render, screen } from "@testing-library/react";
import ContractSection from "./ContractSection";

const fullText = Array.from({ length: 120 }, (_, i) => `Fictional agreement clause ${i + 1}: complete original terms remain available.`).join("\n\n");
beforeEach(() => {
  localStorage.setItem("token", "fictional-contract-reader");
  global.fetch = jest.fn().mockResolvedValue({ ok: true, text: async () => JSON.stringify({ contract: {
    id: 8, caseId: 42, versionNo: 1, title: "Fictional agreement", contractText: fullText, status: "APPROVED", attachments: [],
  } }) });
});

test("long agreement is collapsed by default without hiding signing controls or truncating terms", async () => {
  render(<ContractSection caseId={42} />);
  const toggle = await screen.findByText("Read full agreement");
  const details = toggle.closest("details")!;
  const reader = screen.getByLabelText("Full agreement text");
  expect(details).not.toHaveAttribute("open");
  expect(reader).not.toBeVisible();
  expect(reader.textContent?.trim()).toBe(fullText);
  expect(reader).toHaveAttribute("tabindex", "0");
  expect(reader).toHaveClass("max-h-[50vh]", "overflow-y-auto");
  expect(screen.getByRole("button", { name: "Send OTP" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Sign Contract" })).toBeDisabled();
});

test("opening and closing agreement does not imply consent or issue a signing or OTP request", async () => {
  render(<ContractSection caseId={42} />);
  const toggle = await screen.findByText("Read full agreement");
  fireEvent.click(toggle);
  expect(toggle.closest("details")).toHaveAttribute("open");
  expect(screen.getByLabelText("Full agreement text")).toBeVisible();
  screen.getAllByRole("checkbox").forEach(box => expect(box).not.toBeChecked());
  fireEvent.click(toggle);
  expect(toggle.closest("details")).not.toHaveAttribute("open");
  expect(screen.getByRole("button", { name: "Sign Contract" })).toBeDisabled();
  expect((global.fetch as jest.Mock).mock.calls).toHaveLength(1);
  expect((global.fetch as jest.Mock).mock.calls[0][1]).not.toHaveProperty("method", "POST");
});
