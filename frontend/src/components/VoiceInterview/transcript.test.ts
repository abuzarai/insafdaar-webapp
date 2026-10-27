import { appendLive, parseTranscriptEvent, parseTranscriptList, parseTranscriptPage, textValid, TranscriptEntry, utf8Bytes } from "./transcript";
const time = "2026-01-01T00:00:00.123456Z";
const turn = (sequence = 1, text = "اصل original\0😀") => ({ type: "transcript_turn", version: 1, sessionId: "synthetic", entry: { sequence, speaker: "user", text, observed_at: time, interrupted: false } });
const status = { type: "transcript_status", version: 1, sessionId: "synthetic", sealed: true, seal_reason: "stopped", sealed_at: time, truncated: false, input_tail_complete: false, last_captured_sequence: 1 };
const meta = { sessionId: "synthetic", issuedAt: "2026-01-01T00:00:00Z", sessionExpiresAt: "2026-01-01T00:05:00Z", endedAt: "2026-01-01T00:05:00Z", retentionEndsAt: "2026-04-01T00:05:00Z", noticeVersion: "live-transcript-v1", acknowledgedAt: "2026-01-01T00:00:00Z", savedThrough: 1, lastCapturedSequence: 1, sealed: true, sealReason: "stopped", truncated: false, inputTailComplete: false, collectionState: "saved" };
const dto = { sequence: 1, speaker: "user", text: "اصل original", observedAt: time, interrupted: false };
test("distinct v1 snake_case wire parses original Unicode/NUL and exact status", () => {
  expect(parseTranscriptEvent(turn(), "synthetic")).toEqual({ entry: { ...dto, text: "اصل original\0😀" } });
  expect(parseTranscriptEvent(status, "synthetic")).toEqual({ status });
  expect(textValid("😀".repeat(4096))).toBe(true);
  expect(textValid("😀".repeat(4097))).toBe(false);
  expect(textValid("\ud800")).toBe(false); expect(textValid("x\udc00")).toBe(false);
  expect(utf8Bytes("a\0اردو😀")).toBe(14);
});
test.each([
  { extra: true }, { version: 2 }, { sessionId: "other" }, { sessionId: "../bad" },
  { entry: { ...turn().entry, observedAt: time } }, { entry: { ...turn().entry, text: "" } },
  { entry: { ...turn().entry, observed_at: "2026-02-30T00:00:00Z" } },
  { entry: { ...turn().entry, interrupted: 1 } }, { entry: { ...turn().entry, speaker: "system" } },
  { entry: { ...turn().entry, sequence: 257 } },
])("rejects malformed turn %j without coercion", change => { expect(parseTranscriptEvent({ ...turn(), ...change }, "synthetic")).toBeNull(); });
test.each([{ sealed: false }, { truncated: true }, { seal_reason: "invented" }, { input_tail_complete: true }, { last_captured_sequence: -1 }, { sealed_at: null }, { extra: false }])("rejects inconsistent status %j", change => { expect(parseTranscriptEvent({ ...status, ...change }, "synthetic")).toBeNull(); });
test("immutable duplicates/conflicts, entry and UTF8 bounds, out-of-order display", () => {
  const one = dto as TranscriptEntry;
  const initial = appendLive([], one);
  expect(appendLive(initial, { ...one, text: "conflict" })).toBe(initial);
  expect(appendLive(initial, one)).toBe(initial);
  const full = Array.from({ length: 256 }, (_, i) => ({ ...one, sequence: i + 1 }));
  expect(appendLive(full, { ...one, sequence: 257 })).toBe(full);
  let entries: TranscriptEntry[] = [];
  for (let i = 1; i <= 16; i++) entries = appendLive(entries, { ...one, sequence: i, text: "😀".repeat(4096) });
  expect(entries).toHaveLength(16);
  expect(appendLive(entries, { ...one, sequence: 17 })).toBe(entries);
  expect(appendLive([{ ...one, sequence: 2 }], one).map(e => e.sequence)).toEqual([1, 2]);
});
test("persisted camelCase pages bind exact case/session and contiguous bounded cursors", () => {
  const page = { caseId: 42, interview: meta, entries: [dto], nextSequence: 1, hasMore: false };
  expect(parseTranscriptPage(page, 42, "synthetic", 0).entries).toEqual([dto]);
  for (const invalid of [{ ...page, caseId: 99 }, { ...page, nextSequence: 2 }, { ...page, hasMore: true }, { ...page, entries: [turn().entry] }, { ...page, interview: { ...meta, sessionId: "other" } }, { ...page, interview: { ...meta, retentionEndsAt: "2026-04-02T00:05:00Z" } }]) expect(() => parseTranscriptPage(invalid, 42, "synthetic", 0)).toThrow();
  expect(() => parseTranscriptPage(page, 42, "synthetic", 1)).toThrow();
  expect(parseTranscriptList({ caseId: 42, interviews: [meta], nextBefore: "synthetic" }, 42).nextBefore).toBe("synthetic");
  expect(() => parseTranscriptList({ caseId: 42, interviews: [meta], nextBefore: "foreign" }, 42)).toThrow();
  expect(() => parseTranscriptList({ caseId: 42, interviews: [meta, meta], nextBefore: null }, 42)).toThrow();
});
