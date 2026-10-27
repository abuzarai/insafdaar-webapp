export const TRANSCRIPT_NOTICE_VERSION = "live-transcript-v1";
export type TranscriptEntry = { sequence: number; speaker: "user" | "assistant"; text: string; observedAt: string; interrupted: boolean };
export type TranscriptStatus = { type: "transcript_status"; version: 1; sessionId: string; sealed: true; seal_reason: string; sealed_at: string; truncated: boolean; input_tail_complete: false; last_captured_sequence: number };
export type TranscriptMetadata = { sessionId: string; issuedAt: string; sessionExpiresAt: string; endedAt: string | null; retentionEndsAt: string; noticeVersion: string; acknowledgedAt: string; savedThrough: number; lastCapturedSequence: number; sealed: boolean; sealReason: string | null; truncated: boolean; inputTailComplete: false; collectionState: "collecting" | "saved" | "partial" };
const reasons = ["prepare", "stopped", "disconnected", "timeout", "provider_error", "limit", "capture_error"];
const object = (v: any) => !!v && typeof v === "object" && !Array.isArray(v);
const keys = (v: any, names: string) => object(v) && Object.keys(v).sort().join() === names.split(" ").sort().join();
export const sessionIdValid = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(v);
const integer = (v: any, min = 0) => Number.isSafeInteger(v) && v >= min && v <= 256;
export function timestampValid(v: unknown): v is string {
  if (typeof v !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|[+-]\d\d:\d\d)$/.test(v) || !Number.isFinite(Date.parse(v))) return false;
  const [y, m, d, h, n, s] = v.slice(0, 19).split(/[-T:]/).map(Number);
  return y > 0 && m >= 1 && m <= 12 && d >= 1 && d <= new Date(Date.UTC(y, m, 0)).getUTCDate() && h < 24 && n < 60 && s < 60;
}
// Count Unicode scalar values, not UTF-16 units. NUL is valid original text.
export function textValid(v: unknown): v is string {
  return typeof v === "string" && v.length > 0 && v.length <= 8192 && Array.from(v).length <= 4096 && !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(v);
}
export const utf8Bytes = (text: string) => Array.from(text).reduce((n, c) => n + (c.codePointAt(0)! <= 0x7f ? 1 : c.codePointAt(0)! <= 0x7ff ? 2 : c.codePointAt(0)! <= 0xffff ? 3 : 4), 0);
function entry(v: any, live: boolean): TranscriptEntry | null {
  const time = live ? "observed_at" : "observedAt";
  if (!keys(v, `sequence speaker text ${time} interrupted`) || !integer(v.sequence, 1) || !["user", "assistant"].includes(v.speaker) || !textValid(v.text) || !timestampValid(v[time]) || typeof v.interrupted !== "boolean") return null;
  return { sequence: v.sequence, speaker: v.speaker, text: v.text, observedAt: v[time], interrupted: v.interrupted };
}
export function parseTranscriptEvent(v: any, sessionId: string): { entry: TranscriptEntry } | { status: TranscriptStatus } | null {
  if (!object(v) || v.version !== 1 || !sessionIdValid(v.sessionId) || v.sessionId !== sessionId) return null;
  if (v.type === "transcript_turn" && keys(v, "type version sessionId entry")) {
    const parsed = entry(v.entry, true); return parsed ? { entry: parsed } : null;
  }
  if (v.type === "transcript_status" && keys(v, "type version sessionId sealed seal_reason sealed_at truncated input_tail_complete last_captured_sequence") && v.sealed === true && reasons.includes(v.seal_reason) && timestampValid(v.sealed_at) && v.truncated === ["limit", "capture_error"].includes(v.seal_reason) && v.input_tail_complete === false && integer(v.last_captured_sequence)) return { status: v };
  return null;
}
export const sameEntry = (a: TranscriptEntry, b: TranscriptEntry) => a.sequence === b.sequence && a.speaker === b.speaker && a.text === b.text && a.observedAt === b.observedAt && a.interrupted === b.interrupted;
export function appendLive(entries: TranscriptEntry[], value: TranscriptEntry, status?: TranscriptStatus): TranscriptEntry[] {
  if (entries.some(e => e.sequence === value.sequence) || entries.length >= 256 || (status && value.sequence > status.last_captured_sequence) || entries.reduce((n, e) => n + utf8Bytes(e.text), 0) + utf8Bytes(value.text) > 262144) return entries;
  return [...entries, value].sort((a, b) => a.sequence - b.sequence);
}
export function parseMetadata(v: any): TranscriptMetadata | null {
  if (!keys(v, "sessionId issuedAt sessionExpiresAt endedAt retentionEndsAt noticeVersion acknowledgedAt savedThrough lastCapturedSequence sealed sealReason truncated inputTailComplete collectionState") || !sessionIdValid(v.sessionId) || ![v.issuedAt, v.sessionExpiresAt, v.retentionEndsAt, v.acknowledgedAt].every(timestampValid) || (v.endedAt !== null && !timestampValid(v.endedAt)) || v.noticeVersion !== TRANSCRIPT_NOTICE_VERSION || !integer(v.savedThrough) || !integer(v.lastCapturedSequence) || v.savedThrough > v.lastCapturedSequence || typeof v.sealed !== "boolean" || (v.sealed ? !reasons.includes(v.sealReason) : v.sealReason !== null) || v.truncated !== (v.sealed && ["limit", "capture_error"].includes(v.sealReason)) || v.inputTailComplete !== false || !["collecting", "saved", "partial"].includes(v.collectionState)) return null;
  if (v.collectionState === "saved" && (!v.sealed || v.savedThrough !== v.lastCapturedSequence)) return null;
  if (Date.parse(v.retentionEndsAt) !== Date.parse(v.endedAt ?? v.sessionExpiresAt) + 90 * 86400000) return null;
  return v;
}
export function parseTranscriptList(v: any, caseId: number, before?: string) {
  if (!keys(v, "caseId interviews nextBefore") || v.caseId !== caseId || !Array.isArray(v.interviews) || v.interviews.length > 10) throw new Error("Invalid transcript list");
  const interviews = v.interviews.map(parseMetadata) as (TranscriptMetadata | null)[];
  if (interviews.some(m => !m) || new Set(interviews.map(m => m!.sessionId)).size !== interviews.length || interviews.some(m => m!.sessionId === before) || (v.nextBefore !== null && (!interviews.length || v.nextBefore !== interviews[interviews.length - 1]!.sessionId || v.nextBefore === before))) throw new Error("Invalid transcript cursor");
  return { interviews: interviews as TranscriptMetadata[], nextBefore: v.nextBefore as string | null };
}
export function parseTranscriptPage(v: any, caseId: number, sessionId: string, after: number) {
  if (!keys(v, "caseId interview entries nextSequence hasMore") || v.caseId !== caseId || !Array.isArray(v.entries) || v.entries.length > 16 || utf8Bytes(JSON.stringify(v)) > 32768) throw new Error("Invalid transcript page");
  const metadata = parseMetadata(v.interview);
  const entries = v.entries.map((e: any) => entry(e, false)) as (TranscriptEntry | null)[];
  if (!metadata || metadata.sessionId !== sessionId || entries.some((e, i) => !e || e.sequence !== after + i + 1) || v.nextSequence !== after + entries.length || v.nextSequence > metadata.savedThrough || typeof v.hasMore !== "boolean" || v.hasMore !== (v.nextSequence < metadata.savedThrough) || (!entries.length && v.hasMore)) throw new Error("Invalid transcript sequence");
  return { metadata, entries: entries as TranscriptEntry[], nextSequence: v.nextSequence as number, hasMore: v.hasMore as boolean };
}
