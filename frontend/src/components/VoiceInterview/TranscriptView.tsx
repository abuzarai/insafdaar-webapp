import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { API_BASE_URL } from "../../config";
import { parseTranscriptList, parseTranscriptPage, sessionIdValid, TranscriptEntry, TranscriptMetadata, TranscriptStatus, utf8Bytes } from "./transcript";
import "./TranscriptView.css";

export const transcriptExplanation = "Automatically generated text. It may be incomplete and is not a reviewed case summary, certified evidence, or an audio recording.";
export function TranscriptText({ entries }: { entries: TranscriptEntry[] }) {
  const box = useRef<HTMLDivElement>(null), following = useRef(true);
  useLayoutEffect(() => { if (following.current && box.current) box.current.scrollTop = box.current.scrollHeight; }, [entries]);
  return <div className="transcript-text" ref={box} tabIndex={0} aria-label="Transcript text" onScroll={() => {
    const el = box.current; if (el) following.current = el.scrollHeight - el.scrollTop - el.clientHeight <= 24;
  }}>{entries.map(e => <div key={e.sequence} className={`transcript-turn transcript-turn-${e.speaker}`}><strong>{e.speaker === "user" ? "You" : "Assistant"}</strong>{e.interrupted && <span> — Interrupted</span>}{e.text.split(/\r\n|\r|\n/).map((text, i) => <p dir="auto" key={i}>{text || "\u00a0"}</p>)}</div>)}</div>;
}
const base = (caseId: number) => `${API_BASE_URL}/api/client/dashboard/start-case/${caseId}/intake-v2/transcripts`;
function useOwnedReads(caseId: number, sessionId = "") {
  const token = localStorage.getItem("token"), generation = useRef(0), controllers = useRef(new Set<AbortController>());
  const [authEpoch, setAuthEpoch] = useState(0);
  useEffect(() => {
    const changed = () => { generation.current++; controllers.current.forEach(c => c.abort()); setAuthEpoch(n => n + 1); };
    window.addEventListener("storage", changed);
    return () => { generation.current++; controllers.current.forEach(c => c.abort()); window.removeEventListener("storage", changed); };
  }, [caseId, token, sessionId]);
  const current = () => !!token && localStorage.getItem("token") === token;
  const read = async (suffix: string) => {
    if (!current()) throw new Error("Transcript unavailable");
    const g = generation.current, controller = new AbortController(); controllers.current.add(controller);
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(base(caseId) + suffix, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", redirect: "error", signal: controller.signal });
      if (!response.ok) throw new Error(response.status === 404 ? "TRANSCRIPT_NOT_AVAILABLE" : "Transcript unavailable");
      // Bound the actual response before JSON parsing, not only the validated DTO.
      const reader = response.body?.getReader();
      let data: unknown;
      if (reader) {
        const chunks: Uint8Array[] = []; let bytes = 0;
        try {
          for (;;) {
            const chunk = await reader.read();
            if (chunk.done) break;
            bytes += chunk.value.byteLength;
            if (bytes > 32768) { controller.abort(); throw new Error("Transcript response limit"); }
            chunks.push(chunk.value);
          }
          const combined = new Uint8Array(bytes); let offset = 0;
          for (const chunk of chunks) { combined.set(chunk, offset); offset += chunk.byteLength; }
          data = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(combined));
        } finally { try { await reader.cancel(); } catch { /* Already aborted or closed. */ } }
      } else {
        // Non-streaming test/older-fetch adapters still undergo strict DTO bounds.
        data = await response.json();
      }
      if (utf8Bytes(JSON.stringify(data)) > 32768) throw new Error("Transcript response limit");
      if (controller.signal.aborted || g !== generation.current || !current()) throw new Error("Transcript unavailable");
      return data;
    } finally { clearTimeout(timeout); controllers.current.delete(controller); }
  };
  return { read, current, identity: `${caseId}:${token}:${authEpoch}` };
}

// Each saved response replaces overlapping best-effort live text; it never changes reviewed facts.
export function SessionTranscript(props: { caseId: number; sessionId: string; liveEntries?: TranscriptEntry[]; liveStatus?: TranscriptStatus; reconcile?: number; savingUnavailable?: boolean; displayEndsAt?: number; pageByPage?: boolean; interviewState?: "connecting" | "listening" | "preparing" | "ended" | "disconnected" }) {
  const reads = useOwnedReads(props.caseId, props.sessionId);
  const originalActor = useRef(localStorage.getItem("token"));
  if (!originalActor.current || originalActor.current !== localStorage.getItem("token")) return null;
  return <OwnedSessionTranscript key={`${reads.identity}:${props.sessionId}`} {...props} reads={reads} />;
}
function OwnedSessionTranscript({ caseId, sessionId, liveEntries = [], liveStatus, reconcile = 0, savingUnavailable, displayEndsAt, pageByPage, interviewState, reads }: Parameters<typeof SessionTranscript>[0] & { reads: ReturnType<typeof useOwnedReads> }) {
  const [saved, setSaved] = useState<TranscriptEntry[]>([]), [metadata, setMetadata] = useState<TranscriptMetadata | null>(null);
  const [checked, setChecked] = useState(false);
  const [warning, setWarning] = useState(""), [busy, setBusy] = useState(false), [expired, setExpired] = useState(false);
  const generation = useRef(0), running = useRef(false), mounted = useRef(true), snapshot = useRef<TranscriptEntry[]>([]);
  useEffect(() => { mounted.current = true; running.current = false; return () => { mounted.current = false; generation.current++; }; }, []);
  useEffect(() => {
    if (!metadata && displayEndsAt === undefined) return;
    const deadline = Math.min(displayEndsAt ?? Infinity, metadata ? Date.parse(metadata.retentionEndsAt) : Infinity);
    const expire = () => { generation.current++; snapshot.current = []; setSaved([]); setExpired(true); };
    const remaining = deadline - Date.now();
    if (remaining <= 0) { expire(); return; }
    // Browser timeout is capped; recheck without any network or retention extension.
    let timer: ReturnType<typeof setTimeout>;
    const check = () => { const left = deadline - Date.now(); if (left <= 0) expire(); else timer = setTimeout(check, Math.min(left, 2147483647)); };
    timer = setTimeout(check, Math.min(remaining, 2147483647)); return () => clearTimeout(timer);
  }, [metadata, displayEndsAt]);
  const refresh = async () => {
    if (running.current || expired || !sessionIdValid(sessionId) || !reads.current()) return;
    running.current = true; setBusy(true);
    const g = generation.current;
    try {
      let entries = [...snapshot.current], after = entries.length, last: TranscriptMetadata | null = null;
      // Read only Express's saved prefix, at most 16 bounded pages per check.
      for (let page = 0; page < (pageByPage ? 1 : 16); page++) {
        const result = parseTranscriptPage(await reads.read(`/${sessionId}?afterSequence=${after}`), caseId, sessionId, after);
        if (!mounted.current || g !== generation.current || !reads.current()) return;
        last = result.metadata;
        if (Date.parse(last.retentionEndsAt) <= Date.now()) { setExpired(true); snapshot.current = []; setSaved([]); return; }
        entries = [...entries, ...result.entries];
        if (entries.length > 256 || entries.reduce((n, e) => n + utf8Bytes(e.text), 0) > 262144) throw new Error("Transcript limit");
        after = result.nextSequence;
        if (!result.hasMore) break;
      }
      if (!mounted.current || g !== generation.current || !reads.current()) return;
      snapshot.current = entries; setSaved(entries); setMetadata(last); setChecked(true); setWarning("");
    } catch (error) { if (mounted.current && g === generation.current && reads.current()) setWarning(error instanceof Error && error.message === "TRANSCRIPT_NOT_AVAILABLE" ? "No saved transcript is available yet. Saving has not been verified; captured text remains here." : "Saving delayed or unavailable. Saved text could not be verified; voice and reviewed facts are unchanged."); }
    finally { if (g === generation.current) { running.current = false; if (mounted.current) setBusy(false); } }
  };
  const refreshCurrent = useRef(refresh); refreshCurrent.current = refresh;
  useEffect(() => {
    if (!reconcile) return;
    // Three serial, bounded owner reads after a boundary, not provider recovery.
    let cancelled = false, timer: ReturnType<typeof setTimeout>;
    const run = async (attempt: number) => { await refreshCurrent.current(); if (!cancelled && attempt < (pageByPage ? 0 : 2)) timer = setTimeout(() => { void run(attempt + 1); }, 1500); };
    void run(0);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [reconcile, pageByPage]);
  const live = interviewState === "connecting" || interviewState === "listening" || interviewState === "preparing";
  useEffect(() => {
    if (!live || expired || pageByPage) return;
    // Missing live events must not hide saved text or storage failures. These
    // serial reads contact Express only, never the provider or admission API.
    let cancelled = false, attempts = 0, timer: ReturnType<typeof setTimeout>;
    const deadline = Date.now() + 300000;
    const check = async () => {
      if (cancelled || Date.now() > deadline) return;
      attempts++;
      await refreshCurrent.current();
      if (!cancelled && attempts < 60 && Date.now() < deadline) timer = setTimeout(() => { void check(); }, 5000);
    };
    timer = setTimeout(() => { void check(); }, 5000);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [live, expired, pageByPage]);
  const entries = expired || !reads.current() ? [] : [...saved, ...liveEntries.filter(e => !saved.some(s => s.sequence === e.sequence) && (!metadata?.sealed || e.sequence <= metadata.lastCapturedSequence))].sort((a, b) => a.sequence - b.sequence);
  // A saved prefix plus a live tail is still bounded by the same journal limits.
  const bounded: TranscriptEntry[] = []; let bytes = 0;
  for (const e of entries) { bytes += utf8Bytes(e.text); if (bounded.length === 256 || bytes > 262144) break; bounded.push(e); }
  const saveStatus = busy ? "Checking saved transcript…" : metadata?.collectionState === "saved" && metadata.savedThrough > 0 ? "Saved transcript available. It may not include the full conversation." : metadata?.collectionState === "partial" ? "Only part of the conversation has been saved." : checked && !saved.length ? "No saved transcript is available yet." : savingUnavailable ? "Transcript saving is unavailable." : "Your transcript has not been confirmed as saved yet.";
  if (interviewState) {
    const ended = interviewState === "ended" || interviewState === "disconnected";
    return <div className="transcript-live" aria-label="Live interview conversation">
      <p className="transcript-live-notice">Automatic transcript. Some words may be missing or incorrect; text may differ from audio you heard.</p>
      <p className="transcript-live-state" role="status">{expired ? "Transcript retention has ended. Text is no longer available." : interviewState === "connecting" ? "Connecting — conversation text will appear here." : interviewState === "listening" ? "Listening — speak naturally." : interviewState === "preparing" ? "Interview ended — preparing your summary." : interviewState === "disconnected" ? "Interview disconnected — captured text remains below." : "Interview ended — captured text remains below."}</p>
      {!expired && <TranscriptText entries={bounded} />}
      {!expired && (liveStatus?.truncated || metadata?.truncated) && <p>Some of the conversation could not be captured.</p>}
      {!expired && !ended && (warning || savingUnavailable || metadata?.collectionState === "partial") && <p role="alert">{warning || (savingUnavailable ? "Transcript saving is unavailable. Voice can continue." : "Only part of the conversation has been saved. Voice can continue.")}</p>}
      {!expired && ended && <div className="transcript-save-feedback" aria-busy={busy}>
        <p role="status">{saveStatus}</p>
        {warning && <p role="alert">{warning}</p>}
        <button type="button" disabled={busy} onClick={() => { void refresh(); }}>{busy ? "Checking saved transcript…" : "Check saved transcript"}</button>
      </div>}
    </div>;
  }
  return <section className="transcript-panel" aria-label="Interview transcript"><h4>Interview transcript (read-only)</h4><p>{transcriptExplanation}</p>
    <p role="status">{expired ? "Transcript retention has ended. Text is no longer available." : saveStatus}</p>
    {!expired && metadata && <p>Available until {new Date(metadata.retentionEndsAt).toLocaleString()}. {metadata.truncated ? "Some of the conversation could not be captured." : ""}</p>}
    {!expired && liveStatus?.truncated && <p>Some of the conversation could not be captured.</p>}
    {warning && !expired && <p role="alert">{warning}</p>}
    {!expired && <><TranscriptText entries={bounded} /><button type="button" disabled={busy} onClick={() => { void refresh(); }}>{busy ? "Checking saved transcript…" : pageByPage && metadata && saved.length < metadata.savedThrough ? "Load more transcript text" : "Check saved transcript"}</button></>}
  </section>;
}

export default function SavedTranscriptHistory({ caseId }: { caseId: number }) {
  const reads = useOwnedReads(caseId);
  return <OwnedHistory key={reads.identity} caseId={caseId} reads={reads} />;
}
const HISTORY_PAGE_LIMIT = 64;
function OwnedHistory({ caseId, reads }: { caseId: number; reads: ReturnType<typeof useOwnedReads> }) {
  const [interviews, setInterviews] = useState<TranscriptMetadata[]>([]), [before, setBefore] = useState<string | null>(null), [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false), [warning, setWarning] = useState(""), [clock, setClock] = useState(Date.now());
  const mounted = useRef(true), running = useRef(false), cursors = useRef(new Set<string>());
  useEffect(() => { mounted.current = true; const timer = setInterval(() => setClock(Date.now()), 1000); return () => { mounted.current = false; clearInterval(timer); }; }, []);
  const load = async (cursor?: string) => {
    if (running.current || (cursor && (cursors.current.has(cursor) || cursors.current.size >= HISTORY_PAGE_LIMIT))) return;
    running.current = true; setBusy(true);
    try {
      const result = parseTranscriptList(await reads.read(`?limit=10${cursor ? `&before=${encodeURIComponent(cursor)}` : ""}`), caseId, cursor);
      if (!mounted.current || !reads.current()) return;
      if (cursor) cursors.current.add(cursor);
      // Keep only the current history page: explicit paging cannot grow memory indefinitely.
      setInterviews(result.interviews); setBefore(result.nextBefore); setSelected(""); setWarning("");
    } catch { if (mounted.current && reads.current()) setWarning("Saved transcripts could not be loaded. No voice connection was attempted."); }
    finally { running.current = false; if (mounted.current) setBusy(false); }
  };
  const available = reads.current() ? interviews.filter(m => Date.parse(m.retentionEndsAt) > clock) : [];
  return <section className="transcript-panel" aria-label="Saved interview transcripts"><h3>Saved interview transcripts</h3><p>{transcriptExplanation} Original English, Urdu and mixed text is not rewritten. Client-only access ends 90 days after the interview ends.</p>
    <button type="button" disabled={busy} onClick={() => { cursors.current.clear(); void load(); }}>Load recent interviews</button>
    {warning && <p role="alert">{warning}</p>}
    <ul>{available.map(m => <li key={m.sessionId}><button type="button" aria-pressed={selected === m.sessionId} onClick={() => setSelected(m.sessionId)}>Interview {new Date(m.issuedAt).toLocaleString()} — {m.collectionState}</button></li>)}</ul>
    {before && <button type="button" disabled={busy || cursors.current.has(before) || cursors.current.size >= HISTORY_PAGE_LIMIT} onClick={() => { void load(before); }}>Older interviews</button>}
    {before && cursors.current.size >= HISTORY_PAGE_LIMIT && <p role="status">History browsing limit reached. Load recent interviews to restart.</p>}
    {selected && available.some(m => m.sessionId === selected) && <SessionTranscript key={selected} caseId={caseId} sessionId={selected} reconcile={1} pageByPage />}
  </section>;
}
