import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { IntakeDetails, IntakeEditor, ReviewedData } from "./IntakeDetails";

const data: ReviewedData = { issue_summary: "A fictional account with no added legal conclusions.", primary_language: "mixed", legal_domain: "other",
  facts: { location: null, timeline: "", desired_outcome: "An explanation in my own words" },
  key_entities: { parties: [], locations: [], dates: [], amounts: [] } };

test("null and empty details stay out of the compact review but remain available on demand", () => {
  const onEdit = jest.fn();
  render(<IntakeDetails data={data} urdu={false} canEdit expanded={false} onExpanded={jest.fn()} onEdit={onEdit} />);
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  expect(screen.getByText(data.issue_summary)).toBeVisible();
  expect(screen.getByText("An explanation in my own words")).toBeVisible();
  expect(screen.getByText("Location")).not.toBeVisible();
  expect(screen.getByText("Timeline")).not.toBeVisible();
  expect(screen.getAllByText("Not provided")).toHaveLength(2);
  fireEvent.click(screen.getByText("More details"));
  expect(screen.getByText("Location")).toBeVisible();
  expect(screen.getByText("Timeline")).toBeVisible();
  expect(screen.getAllByText("None provided")).toHaveLength(4);
  fireEvent.click(screen.getByRole("button", { name: "Add Location" }));
  expect(onEdit).toHaveBeenCalledWith("fact:location");
  expect(screen.queryByText(/rental agreement|deposit|required|complete/i)).not.toBeInTheDocument();
});

test("a contextual change leaves untouched null, empty, entity and metadata values exactly as received", () => {
  const onChange = jest.fn();
  render(<IntakeEditor draft={data} target="fact:desired_outcome" urdu={false} disabled={false} onChange={onChange} />);
  expect(screen.getAllByRole("textbox")).toHaveLength(1);
  expect(screen.getByLabelText("Desired outcome")).toHaveValue(data.facts.desired_outcome);
  fireEvent.change(screen.getByLabelText("Desired outcome"), { target: { value: "A corrected outcome" } });
  expect(onChange).toHaveBeenCalledWith({ ...data, facts: { ...data.facts, desired_outcome: "A corrected outcome" } });
  expect(data.facts.location).toBeNull(); expect(data.facts.timeline).toBe("");
});

test("the global editor includes every stored DTO field without remapping dates or amounts", () => {
  const snapshot = { ...data, key_entities: { ...data.key_entities, dates: ["Some time last season"], amounts: ["An amount in an unspecified currency"] } };
  render(<IntakeEditor draft={snapshot} target="all" urdu={false} disabled={false} onChange={jest.fn()} />);
  expect(screen.getAllByRole("textbox")).toHaveLength(8);
  expect(screen.getAllByRole("combobox")).toHaveLength(2);
  expect(screen.getByLabelText("Dates")).toHaveValue("Some time last season");
  expect(screen.getByLabelText("Amounts")).toHaveValue("An amount in an unspecified currency");
  expect(screen.getByLabelText("Location")).toHaveValue("");
});

test("frozen read-only presentation has no contextual editing and translated labels do not rewrite stored prose", () => {
  render(<IntakeDetails data={data} urdu canEdit={false} expanded onExpanded={jest.fn()} onEdit={jest.fn()} />);
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
  expect(screen.getByText(data.issue_summary)).toBeInTheDocument();
  expect(screen.getByText("آپ کی بات")).toBeInTheDocument();
  expect(screen.getByText("An explanation in my own words")).toBeInTheDocument();
});

test.each([
  ["summary", "Issue summary", 4096],
  ["fact:issue_description", "What happened", 2048],
  ["entity:parties", "People", 4096],
] as const)("%s counts codepoints, preserves overlength input and associates an error", (target, name, limit) => {
  const snapshot = { ...data, facts: { ...data.facts, issue_description: null } };
  function Harness() {
    const [draft, setDraft] = React.useState<ReviewedData>(snapshot);
    return <IntakeEditor draft={draft} target={target} urdu={false} disabled={false} onChange={setDraft} />;
  }
  render(<Harness />);
  const field = screen.getByRole("textbox", { name });
  expect(field).not.toHaveAttribute("maxlength");
  const valid = "\u{1F600}".repeat(limit);
  fireEvent.change(field, { target: { value: valid } });
  expect(field).toHaveValue(valid);
  expect(field).not.toHaveAttribute("aria-invalid");
  const overlength = valid + "\u{1F600}";
  fireEvent.change(field, { target: { value: overlength } });
  expect(field).toHaveValue(overlength);
  expect(field).toHaveAttribute("aria-invalid", "true");
  expect(field).toHaveAccessibleDescription(`Shorten this to ${limit} characters (currently ${limit + 1}). Your text has not been changed.`);
  fireEvent.change(field, { target: { value: valid } });
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(field).not.toHaveAttribute("aria-invalid");
});

test("entity limits apply per item rather than to the whole multiline field", () => {
  const snapshot = { ...data, key_entities: { ...data.key_entities, parties: ["ا".repeat(4096), "\u{1F600}".repeat(4096)] } };
  render(<IntakeEditor draft={snapshot} target="entity:parties" urdu={false} disabled={false} onChange={jest.fn()} />);
  expect(screen.getByRole("textbox", { name: "People" })).toHaveValue(snapshot.key_entities.parties.join("\n"));
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});
