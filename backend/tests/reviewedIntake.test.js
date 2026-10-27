import { jest, test, expect, beforeEach } from "@jest/globals";

// Transactional in-memory SQL double: validates application contracts, not PostgreSQL.
let state, snapshot, unlock, tail;
const clone = value => structuredClone(value);
const result = rows => ({ rows: clone(rows), rowCount: rows.length });
const query = jest.fn(async (sql, p = []) => {
  const q = sql.replace(/\s+/g, " ").trim();
  if (q === "BEGIN") {
    const previous = tail;
    tail = new Promise(resolve => { unlock = resolve; });
    await previous;
    snapshot = clone(state);
    return result([]);
  }
  if (q === "COMMIT") { unlock(); return result([]); }
  if (q === "ROLLBACK") { state = snapshot; unlock(); return result([]); }
  if (q.startsWith("SELECT paused")) return { rows: [{ paused: false }] };
  if (q.startsWith("WITH moment")) return { rows: [{ daily: 0, weekly: 0, platform: 0 }] };
  if (q.startsWith("SELECT 1 FROM public.interview_admissions")) return { rows: [] };
  if (q.startsWith("SELECT * FROM public.client_cases")) return result(p[0] === 101 && p[1] === 42 ? [state.c] : []);
  if (q.startsWith("SELECT request_hash")) return result(state.receipts.filter(r => r.operation === p[2] && r.key === p[3]));
  if (q.startsWith("INSERT INTO public.case_intake_receipts")) {
    state.receipts.push({ operation: p[2], key: p[3], request_hash: p[4], response: p[5] && JSON.parse(p[5]) });
    return result([]);
  }
  if (q.startsWith("SELECT session_id")) return result(state.live && p[0] === "live-owned" && p[1] === 101 && p[2] === 42 ? [{ session_id: p[0] }] : []);
  if (q.startsWith("INSERT INTO public.case_intake_revisions")) {
    state.revisions.push({ id: p[0], case_id: p[1], parent_id: p[2], source_session_id: p[4], source_proposal: JSON.parse(p[5]), reviewed_data: JSON.parse(p[6]), content_hash: p[7] });
    return result([]);
  }
  if (q.startsWith("SELECT * FROM public.case_intake_revisions")) return result(state.revisions.filter(r => r.case_id === p[0] && r.id === p[1]));
  if (q.startsWith("UPDATE public.client_cases SET selected_intake_revision_id")) {
    Object.assign(state.c, { selected_intake_revision_id: p[1], intake_version: p[2] }); return result([]);
  }
  if (q.startsWith("INSERT INTO public.case_intake_confirmations")) {
    state.confirmations.push({ id: p[0], case_id: p[1], revision_id: p[2], actor_user_id: p[3], content_hash: p[4], case_version: p[5] }); return result([]);
  }
  if (q.startsWith("UPDATE public.client_cases SET intake_version")) { state.c.intake_version = p[1]; return result([]); }
  if (q.startsWith("SELECT id FROM public.case_intake_confirmations")) return result(state.confirmations.filter(c => c.id === p[0] && c.case_id === p[1] && c.revision_id === p[2] && c.actor_user_id === p[3] && c.content_hash === p[4] && c.case_version === p[5]));
  if (q.startsWith("SELECT id, revision_id")) return result(state.confirmations.filter(c => c.case_id === p[0] && c.actor_user_id === p[1] && c.case_version === p[2]));
  if (q.startsWith("INSERT INTO public.case_intake_submissions")) { state.submission = { revisionId: p[1], confirmationId: p[2], contentHash: p[4] }; return result([]); }
  if (q.startsWith("UPDATE public.client_cases SET submitted_intake_revision_id")) {
    Object.assign(state.c, { submitted_intake_revision_id: p[1], intake_version: p[2], interview_completed: true, description: p[3], language: p[4], legal_domain: p[5] }); return result([]);
  }
  if (q.startsWith("SELECT id, status")) return result([state.c]);
  if (q.startsWith("UPDATE public.client_cases SET status")) { state.c.status = p[1]; return result([state.c]); }
  if (q.startsWith("INSERT INTO public.case_lifecycle_events")) { state.events.push(p); return result([]); }
  if (q.startsWith("SELECT intake_protocol")) return result([{ intake_protocol: state.c.intake_protocol }]);
  if (q.startsWith("SELECT r.id")) {
    const r = state.revisions.find(r => r.id === state.c.submitted_intake_revision_id);
    return result(r && state.submission ? [{ ...r, created_at: "2026-01-01T00:00:00Z" }] : []);
  }
  throw new Error(`Unexpected SQL: ${q}`);
});
const pool = { connect: jest.fn(async () => ({ query, release: jest.fn() })), query };
jest.unstable_mockModule("../db.js", () => ({ default: pool }));
const service = await import("../services/reviewedIntake.service.js");
const { getLatestInterviewResult } = await import("../utils/interviewMatching.js");
const actor = { id: 42, role: "client" };
let proposal, read;
beforeEach(() => {
  tail = Promise.resolve();
  state = { c: { id: 101, user_id: 42, status: "INTAKE_STARTED", intake_protocol: "live_v2", intake_version: 1, selected_intake_revision_id: null, submitted_intake_revision_id: null }, revisions: [], confirmations: [], receipts: [], events: [], live: true };
  proposal = { session_id: "live-owned", phase: "proposed", proposal: {
    tool_call_id: "fictional-tool", confirmed: false, input_tail_complete: false,
    basis: "unconfirmed proposal from retained Live audio/conversation context",
    facts: Object.fromEntries(service.FACT_FIELDS.map(key => [key, null])),
    analysis: { primary_language: "mixed", legal_domain: "property_law", confidence_score: 0.8,
      key_entities: { parties: [], locations: [], dates: [], amounts: [] }, issue_summary: "Fictional boundary dispute",
      adr_suitable: false, adr_reasoning: "Uncertain", urgency: "medium", urgency_reasoning: "Uncertain" },
  } };
  read = jest.fn(async () => clone(proposal));
  query.mockClear(); pool.connect.mockClear();
});
const save = (key = "save-one", request = { sessionId: "live-owned", expectedVersion: 1 }) => service.saveProposal(actor, 101, key, request, read);
const confirm = (r, key = "confirm-one") => service.confirmRevision(actor, 101, key, { revisionId: r.revisionId, expectedVersion: r.caseVersion, acknowledgeReview: true, acknowledgmentVersion: "review-v1" });
const submit = (c, key = "submit-one") => service.submitIntake(actor, 101, key, { revisionId: c.revisionId, confirmationId: c.confirmationId, expectedVersion: c.caseVersion });

test("save, confirm and submit advance only the existing case", async () => {
  const r = await save();
  expect(state.c.status).toBe("INTAKE_STARTED");
  expect(r.confirmed).toBe(false);
  const c = await confirm(r);
  expect(state.c.status).toBe("INTAKE_STARTED");
  const s = await submit(c);
  expect(s.status).toBe("MATCHING_REVIEW");
  expect(state.c.submitted_intake_revision_id).toBe(r.revisionId);
  expect(state.events).toHaveLength(1);
  expect(state.c.description).toBe("Fictional boundary dispute");
});

test("a lost save response is reconciled without re-reading deleted voice RAM", async () => {
  const first = await save(); state.live = false;
  read.mockRejectedValue(new Error("Voice stopped"));
  expect(await save()).toEqual(first);
  expect(read).toHaveBeenCalledTimes(1);
  expect(state.revisions).toHaveLength(1);
});

test("identical submit replay works after the case advances; conflicting intent fails", async () => {
  const c = await confirm(await save());
  const first = await submit(c);
  expect(await submit(c)).toEqual(first);
  expect(state.events).toHaveLength(1);
  await expect(service.submitIntake(actor, 101, "submit-one", { revisionId: c.revisionId, confirmationId: c.confirmationId, expectedVersion: 999 })).rejects.toMatchObject({ code: "INTENT_CONFLICT" });
});

test("edits preserve original model source and invalidate old confirmation", async () => {
  const r = await save(); const c = await confirm(r);
  const edited = await service.editRevision(actor, 101, "edit-one", { revisionId: r.revisionId, expectedVersion: c.caseVersion, reviewedData: { ...r.reviewedData, issue_summary: "صارف کی درست کردہ فرضی تفصیل" } });
  expect(state.revisions[1].parent_id).toBe(r.revisionId);
  expect(state.revisions[1].source_proposal).toEqual(proposal.proposal);
  expect(edited.contentHash).not.toBe(r.contentHash);
  await expect(service.submitIntake(actor, 101, "bad-submit", { revisionId: edited.revisionId, confirmationId: c.confirmationId, expectedVersion: edited.caseVersion })).rejects.toMatchObject({ code: "CURRENT_CONFIRMATION_REQUIRED" });
  expect(state.submission).toBeUndefined();
  expect((await submit(await confirm(edited, "confirm-edit"))).revisionId).toBe(edited.revisionId);
});

test("long Unicode review round-trips through save, read, edit, confirmation and submission without changing source", async () => {
  proposal.proposal.analysis.issue_summary = "\u{1F600}".repeat(4096);
  proposal.proposal.analysis.key_entities.parties = ["ا".repeat(4096)];
  proposal.proposal.facts.issue_description = "\u{1F600}".repeat(2048);
  const original = clone(proposal.proposal);
  const saved = await save();
  expect((await service.getReview(actor, 101)).revision.reviewedData).toEqual(saved.reviewedData);
  const previousConfirmation = await confirm(saved);
  const reviewedData = { ...saved.reviewedData, key_entities: { ...saved.reviewedData.key_entities, parties: ["\u{1F600}".repeat(4096)] } };
  const edited = await service.editRevision(actor, 101, "unicode-edit", {
    revisionId: saved.revisionId, expectedVersion: previousConfirmation.caseVersion, reviewedData,
  });
  expect(edited.reviewedData).toEqual(reviewedData);
  expect(state.revisions[1].source_proposal).toEqual(original);
  expect(proposal.proposal).toEqual(original);
  await expect(service.submitIntake(actor, 101, "old-unicode-confirmation", {
    revisionId: edited.revisionId, confirmationId: previousConfirmation.confirmationId, expectedVersion: edited.caseVersion,
  })).rejects.toMatchObject({ code: "CURRENT_CONFIRMATION_REQUIRED" });
  const submitted = await submit(await confirm(edited, "unicode-confirm"), "unicode-submit");
  expect(submitted.revisionId).toBe(edited.revisionId);
  expect((await service.getReview(actor, 101)).revision.reviewedData).toEqual(reviewedData);
  expect(state.c.description).toBe(reviewedData.issue_summary);
});

test("stale edits cannot overwrite the selected revision", async () => {
  const r = await save(); await confirm(r);
  await expect(service.editRevision(actor, 101, "edit-stale", { revisionId: r.revisionId, expectedVersion: r.caseVersion, reviewedData: r.reviewedData })).rejects.toMatchObject({ code: "STALE_CASE_VERSION" });
  expect(state.revisions).toHaveLength(1);
});

test.each(["save", "edit", "confirm"])("submitted intake refuses new %s operations", async operation => {
  const r = await save(); const c = await confirm(r); await submit(c);
  const calls = {
    save: () => save("fresh-save", { sessionId: "live-owned", expectedVersion: 4 }),
    edit: () => service.editRevision(actor, 101, "fresh-edit", { revisionId: r.revisionId, expectedVersion: 4, reviewedData: r.reviewedData }),
    confirm: () => confirm({ ...r, caseVersion: 4 }, "fresh-confirm"),
  };
  await expect(calls[operation]()).rejects.toMatchObject({ code: "INTAKE_NOT_EDITABLE" });
});

test.each(["admin", "advocate"])("%s cannot impersonate client confirmation", async role => {
  await expect(service.getReview({ ...actor, role }, 101)).rejects.toMatchObject({ status: 403 });
  expect(pool.connect).not.toHaveBeenCalled();
});

test("wrong owner cannot view or mutate intake", async () => {
  await expect(service.getReview({ id: 43, role: "client" }, 101)).rejects.toMatchObject({ status: 404 });
});

test("stopped/expired or foreign live binding cannot save a proposal", async () => {
  state.live = false;
  await expect(save()).rejects.toMatchObject({ code: "LIVE_SESSION_UNAVAILABLE" });
  expect(read).not.toHaveBeenCalled();
});

test("proposal failure rolls back without publishing a revision or receipt", async () => {
  read.mockRejectedValue(new Error("Deleted by Stop"));
  await expect(save()).rejects.toThrow("Deleted by Stop");
  expect(state.revisions).toHaveLength(0); expect(state.receipts).toHaveLength(0);
  expect(state.c.intake_version).toBe(1);
});

test("storage outage never reads voice data", async () => {
  pool.connect.mockRejectedValueOnce(new Error("Database unavailable"));
  await expect(save()).rejects.toThrow("Database unavailable"); expect(read).not.toHaveBeenCalled();
});

test.each(["DRAFT", "CASE_ACTIVE", "UNKNOWN"])("invalid case status %s cannot save", async status => {
  state.c.status = status;
  await expect(save()).rejects.toMatchObject({ code: "INTAKE_NOT_EDITABLE" });
});

test("legacy completed data does not become confirmed by being read", async () => {
  state.c.intake_protocol = "legacy";
  await expect(save()).rejects.toMatchObject({ code: "INTAKE_NOT_EDITABLE" });
  expect(state.confirmations).toHaveLength(0);
});

test("unchecked or outdated acknowledgment is rejected", async () => {
  const r = await save();
  await expect(service.confirmRevision(actor, 101, "bad-ack", { revisionId: r.revisionId, expectedVersion: r.caseVersion, acknowledgeReview: false, acknowledgmentVersion: "review-v1" })).rejects.toMatchObject({ code: "REVIEW_ACKNOWLEDGMENT_REQUIRED" });
});

test("review restoration exposes the exact current confirmation", async () => {
  const r = await save(); const c = await confirm(r);
  const review = await service.getReview(actor, 101);
  expect(review.confirmation.confirmationId).toBe(c.confirmationId);
  expect(review.revision.inputTailComplete).toBe(false);
});

test("summary readers return only submitted revisions, never a later raw interview", async () => {
  expect(await getLatestInterviewResult(pool, 101)).toBeNull();
  const r = await save(); await submit(await confirm(r));
  const summary = await getLatestInterviewResult(pool, 101);
  expect(summary.revisionId).toBe(r.revisionId);
  expect(summary.transcript).toBeNull();
  expect(summary.analysis.confidence_score).toBeNull();
  expect(summary.summary.confidenceScore).toBeNull();
  expect(summary.meta.modelSuggestionsUnverified).toBe(true);
  expect(query.mock.calls.some(([sql]) => sql.includes("FROM public.case_intake_sessions"))).toBe(false);
});

test.each(["confirmed", "input_tail_complete"])("provider cannot claim %s", async key => {
  proposal.proposal[key] = true;
  await expect(save()).rejects.toMatchObject({ code: "PROPOSAL_NOT_AVAILABLE" });
  expect(state.revisions).toHaveLength(0);
});

test("unknown fields and invented mandatory entities are not required", () => {
  const data = service.validateReviewed({ issue_summary: "A fictional issue", primary_language: "urdu", legal_domain: "other", facts: proposal.proposal.facts, key_entities: proposal.proposal.analysis.key_entities }, true);
  expect(data.key_entities.parties).toEqual([]);
  expect(() => service.validateReviewed({ ...data, confirmed: true })).toThrow();
  expect(() => service.validateReviewed({ ...data, issue_summary: "Draft created for interview" }, true)).toThrow();
});
