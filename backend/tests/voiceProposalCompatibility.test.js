import { jest, test, expect, beforeAll, afterAll } from "@jest/globals";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const database = {
  connect: jest.fn(() => { throw new Error("Database access is forbidden in this test"); }),
  query: jest.fn(() => { throw new Error("Database access is forbidden in this test"); }),
};
jest.unstable_mockModule("../db.js", () => ({ default: database }));
const { FACT_FIELDS, validateProposal, validateReviewed } = await import("../services/reviewedIntake.service.js");

// Explicit cross-repository gate; ordinary webapp tests need no sibling Python environment.
const contractTest = process.env.WEBAPP_VOICE_CONTRACT_CHECK === "1" ? test : test.skip;
const voiceRoot = fileURLToPath(new URL("../../../voice_intake_agent/", import.meta.url));
const python = path.join(voiceRoot, ".venv/bin/python");
const baseline = () => ({
  facts: Object.fromEntries(FACT_FIELDS.map(key => [key, null])),
  analysis: {
    primary_language: "mixed", legal_domain: "property_law", confidence_score: 0.8,
    key_entities: { parties: [], locations: [], dates: [], amounts: [] },
    issue_summary: "Fictional boundary dispute", adr_suitable: false,
    adr_reasoning: "Suitability is uncertain", urgency: "medium",
    urgency_reasoning: "Timing is uncertain",
  },
});
const cases = [
  { name: "short valid proposal", webappAccepts: true, change: () => {} },
  { name: "empty ADR reasoning", webappAccepts: true, change: p => { p.analysis.adr_reasoning = ""; } },
  { name: "empty urgency reasoning", webappAccepts: true, change: p => { p.analysis.urgency_reasoning = ""; } },
  { name: "whitespace-only reasoning preserved verbatim", webappAccepts: true, change: p => { p.analysis.adr_reasoning = "  "; p.analysis.urgency_reasoning = "\t"; } },
  { name: "2049-character ASCII entity", webappAccepts: true, change: p => { p.analysis.key_entities.parties = ["x".repeat(2049)]; } },
  { name: "2048-character BMP entity", webappAccepts: true, change: p => { p.analysis.key_entities.parties = ["ا".repeat(2048)]; } },
  { name: "1024 astral codepoints within 2048 UTF-16 units", webappAccepts: true, change: p => { p.analysis.key_entities.parties = ["\u{1F600}".repeat(1024)]; } },
  { name: "1025 astral entity codepoints exceeding 2048 UTF-16 units", webappAccepts: true, change: p => { p.analysis.key_entities.parties = ["\u{1F600}".repeat(1025)]; } },
  { name: "1025 astral fact codepoints exceeding 2048 UTF-16 units", webappAccepts: true, change: p => { p.facts.issue_description = "\u{1F600}".repeat(1025); } },
  { name: "4096-codepoint entity", webappAccepts: true, change: p => { p.analysis.key_entities.parties = ["\u{1F600}".repeat(4096)]; } },
  { name: "2048-codepoint fact", webappAccepts: true, change: p => { p.facts.issue_description = "\u{1F600}".repeat(2048); } },
  { name: "4096-codepoint summary", webappAccepts: true, change: p => { p.analysis.issue_summary = "\u{1F600}".repeat(4096); } },
];

const validateWithPython = String.raw`
import json, os, sys
from pathlib import Path

def offline(event, args):
    if event.startswith(("socket.", "subprocess.")) or event in {"os.system", "os.posix_spawn", "os.fork"}:
        raise RuntimeError("Network and process execution forbidden")
    if event == "import" and args[0].split(".")[0] in {"dotenv", "pipecat", "google"}:
        raise RuntimeError("Provider/configuration import forbidden")
    if event == "import" and args[0] in {"app.settings", "app.composition", "app.application", "app.main"}:
        raise RuntimeError("Runtime composition import forbidden")
    if event == "open":
        filename, mode, flags = args
        if isinstance(filename, (str, bytes, os.PathLike)) and Path(os.fsdecode(filename)).name.startswith(".env"):
            raise RuntimeError("Environment file access forbidden")
        if isinstance(flags, int) and flags & (os.O_WRONLY | os.O_RDWR | os.O_CREAT | os.O_TRUNC):
            raise RuntimeError("Filesystem writes forbidden")

sys.addaudithook(offline)
sys.path.insert(0, sys.argv[1])
from app.services.live_audio_draft import validate_arguments
from app.models.live_audio_draft import AudioContextProposal, AudioDraftView

views = []
for arguments in json.load(sys.stdin):
    facts, analysis = validate_arguments(arguments)
    proposal = AudioContextProposal(tool_call_id="fictional-tool", facts=facts, analysis=analysis)
    view = AudioDraftView(session_id="fictional-session", phase="proposed", proposal=proposal)
    views.append(view.model_dump(mode="json"))
print(json.dumps(views, ensure_ascii=True))
`;
let views;
beforeAll(() => {
  if (!existsSync(python)) throw new Error("Existing voice Python environment required; do not install dependencies automatically");
  const argumentsList = cases.map(item => {
    const proposal = baseline();
    item.change(proposal);
    return proposal;
  });
  views = JSON.parse(execFileSync(python, ["-I", "-B", "-c", validateWithPython, voiceRoot], {
    input: JSON.stringify(argumentsList), encoding: "utf8", timeout: 15000,
    env: { PATH: "/usr/bin:/bin", LANG: "C.UTF-8", PYTHON_DOTENV_DISABLED: "1" },
    maxBuffer: 1024 * 1024,
  }));
  expect(views).toHaveLength(cases.length);
});

contractTest.each(cases.map((item, index) => ({ ...item, index })))(
  "current contract: Python accepts $name; webapp acceptance = $webappAccepts",
  ({ index, webappAccepts }) => {
    const view = views[index];
    expect(view.phase).toBe("proposed");
    expect(view.proposal.confirmed).toBe(false);
    expect(view.proposal.input_tail_complete).toBe(false);
    const original = JSON.stringify(view);
    if (webappAccepts) {
      const result = validateProposal(view, "fictional-session");
      expect(result.proposal).toEqual(view.proposal);
      expect(result.reviewed.key_entities).toEqual(view.proposal.analysis.key_entities);
      expect(result.reviewed.facts).toEqual(view.proposal.facts);
    } else {
      expect(() => validateProposal(view, "fictional-session")).toThrow(expect.objectContaining({ status: 422, code: "INVALID_INTAKE" }));
    }
    expect(JSON.stringify(view)).toBe(original);
  },
);

contractTest.each(["adr_reasoning", "urgency_reasoning"])("%s still rejects nonstrings and oversized values without modifying source", field => {
  for (const value of [undefined, null, false, 0, {}, [], "x".repeat(8193)]) {
    const view = structuredClone(views[0]);
    view.proposal.analysis[field] = value;
    const original = structuredClone(view);
    expect(() => validateProposal(view, "fictional-session")).toThrow(expect.objectContaining({ status: 422, code: "INVALID_INTAKE" }));
    expect(view).toEqual(original);
  }
});

contractTest.each(["issue_summary", "entity"])("blank %s remains invalid", field => {
  const view = structuredClone(views[0]);
  if (field === "issue_summary") view.proposal.analysis.issue_summary = "";
  else view.proposal.analysis.key_entities.parties = [""];
  expect(() => validateProposal(view, "fictional-session")).toThrow(expect.objectContaining({ status: 422, code: "INVALID_INTAKE" }));
});

contractTest.each([
  ["entity", "x", 4097], ["entity", "\u{1F600}", 4097],
  ["fact", "x", 2049], ["fact", "\u{1F600}", 2049],
  ["summary", "x", 4097], ["summary", "\u{1F600}", 4097],
])("rejects overlength %s using %s at %i codepoints", (field, character, count) => {
  const data = structuredClone(validateProposal(views[0], "fictional-session").reviewed);
  if (field === "entity") data.key_entities.parties = [character.repeat(count)];
  else if (field === "fact") data.facts.issue_description = character.repeat(count);
  else data.issue_summary = character.repeat(count);
  expect(() => validateReviewed(data)).toThrow(expect.objectContaining({ code: "INVALID_INTAKE" }));
});

contractTest("entity count and aggregate byte caps remain enforced", () => {
  const data = structuredClone(validateProposal(views[0], "fictional-session").reviewed);
  data.key_entities.parties = Array(33).fill("Fictional person");
  expect(() => validateReviewed(data)).toThrow(expect.objectContaining({ code: "INVALID_INTAKE" }));
  data.key_entities.parties = Array(32).fill("ا".repeat(2048));
  expect(() => validateReviewed(data)).toThrow(expect.objectContaining({ code: "INTAKE_TOO_LARGE" }));
});

contractTest("tool identifier limit remains UTF-16 based and unchanged", () => {
  const view = structuredClone(views[0]);
  view.proposal.tool_call_id = "\u{1F600}".repeat(65);
  expect(() => validateProposal(view, "fictional-session")).toThrow(expect.objectContaining({ code: "INVALID_INTAKE" }));
});

afterAll(() => {
  expect(database.connect).not.toHaveBeenCalled();
  expect(database.query).not.toHaveBeenCalled();
});
