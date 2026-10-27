import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import SavedTranscriptHistory, { SessionTranscript, TranscriptText } from "./TranscriptView";
import { TranscriptEntry } from "./transcript";
const start = Date.parse("2026-01-01T00:00:00Z");
const iso = (n: number) => new Date(n).toISOString();
const metadata = (sessionId = "one", state = "saved", savedThrough = 1) => ({ sessionId, issuedAt: iso(start), sessionExpiresAt: iso(start + 300000), endedAt: iso(start + 1000), retentionEndsAt: iso(start + 1000 + 90 * 86400000), noticeVersion: "live-transcript-v1", acknowledgedAt: iso(start), savedThrough, lastCapturedSequence: savedThrough, sealed: true, sealReason: "stopped", truncated: false, inputTailComplete: false, collectionState: state });
const entry = (sequence = 1, text = "اصل original <b>not markup</b>"): TranscriptEntry => ({ sequence, speaker: "assistant", text, observedAt: iso(start), interrupted: true });
const response = (data: any, ok = true) => ({ ok, json: async () => data });
const page = (sessionId = "one", state = "saved", entries = [entry()], total = entries.length, caseId = 42, nextSequence = entries.length) => response({ caseId, interview: metadata(sessionId, state, total), entries, nextSequence, hasMore: nextSequence < total });
const defer = () => { let resolve!: (v: any) => void; const promise = new Promise<any>(r => { resolve = r; }); return { resolve, promise }; };
beforeEach(() => { localStorage.setItem("token", "actor-one"); global.fetch = jest.fn(); jest.spyOn(Date, "now").mockReturnValue(start + 2000); });
afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); });

test("live text is escaped, independently delayed, and reconciles authoritative saved late tail after Stop", async () => {
  const pending = defer(); (global.fetch as jest.Mock).mockReturnValue(pending.promise);
  const view = render(<SessionTranscript caseId={42} sessionId="one" liveEntries={[entry(1, "best effort")]} />);
  expect(global.fetch).not.toHaveBeenCalled(); expect(screen.getByText("best effort")).toBeInTheDocument();
  view.rerender(<SessionTranscript caseId={42} sessionId="one" liveEntries={[entry(1, "best effort")]} reconcile={1} />);
  expect(screen.getByRole("status")).toHaveTextContent("Checking saved transcript");
  await act(async () => pending.resolve(page("one", "saved", [entry(), entry(2, "late captured tail")])));
  expect(screen.queryByText("best effort")).not.toBeInTheDocument();
  expect(screen.getByText("late captured tail")).toHaveAttribute("dir", "auto");
  expect(screen.getByText("اصل original <b>not markup</b>").querySelector("b")).toBeNull();
  expect(screen.getByText(/Saved transcript available/)).toBeInTheDocument();
  expect(screen.queryByText(/playback not verified/)).not.toBeInTheDocument();
  expect((global.fetch as jest.Mock).mock.calls[0][1]).toEqual(expect.objectContaining({ cache: "no-store", headers: { Authorization: "Bearer actor-one" } }));
});
test("404 before registration and read errors never claim saved; partial is separate from voice failure", async () => {
  (global.fetch as jest.Mock).mockResolvedValueOnce(response({}, false)).mockResolvedValueOnce(page("one", "partial"));
  render(<SessionTranscript caseId={42} sessionId="one" liveEntries={[entry()]} />);
  fireEvent.click(screen.getByRole("button", { name: "Check saved transcript" }));
  await screen.findByRole("alert"); expect(screen.getByRole("status")).toHaveTextContent("not been confirmed as saved");
  expect(screen.getByText("اصل original <b>not markup</b>")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Check saved transcript" }));
  await screen.findByText(/Only part of the conversation has been saved/);
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});
test.each(["case", "session", "actor"])("late %s generation response cannot display prior text", async kind => {
  const pending = defer(); (global.fetch as jest.Mock).mockReturnValue(pending.promise);
  const view = render(<SessionTranscript caseId={42} sessionId="one" reconcile={1} />);
  const signal = (global.fetch as jest.Mock).mock.calls[0][1].signal;
  if (kind === "case") view.rerender(<SessionTranscript caseId={43} sessionId="one" />);
  if (kind === "session") view.rerender(<SessionTranscript caseId={42} sessionId="two" />);
  if (kind === "actor") act(() => { localStorage.setItem("token", "actor-two"); window.dispatchEvent(new Event("storage")); });
  await act(async () => pending.resolve(page()));
  expect(screen.queryByText("اصل original <b>not markup</b>")).not.toBeInTheDocument();
  if (kind !== "session") expect(signal.aborted).toBe(true);
});
test("unmount aborts saved reads and wrong-case DTO warns without displaying text", async () => {
  (global.fetch as jest.Mock).mockResolvedValue(page("one", "saved", [entry()], 1, 99));
  const view = render(<SessionTranscript caseId={42} sessionId="one" reconcile={1} />);
  await screen.findByRole("alert"); expect(screen.queryByText("اصل original <b>not markup</b>")).not.toBeInTheDocument();
  const pending = defer(); (global.fetch as jest.Mock).mockReturnValue(pending.promise);
  fireEvent.click(screen.getByRole("button", { name: "Check saved transcript" }));
  const signal = (global.fetch as jest.Mock).mock.calls[1][1].signal;
  view.unmount(); expect(signal.aborted).toBe(true);
  await act(async () => pending.resolve(page()));
});
test("retention expires while open without polling or extending retention", async () => {
  jest.useFakeTimers();
  const end = start + 1000 + 90 * 86400000; jest.setSystemTime(end - 100);
  (global.fetch as jest.Mock).mockResolvedValue(page());
  render(<SessionTranscript caseId={42} sessionId="one" />);
  fireEvent.click(screen.getByRole("button", { name: "Check saved transcript" }));
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  expect(screen.getByText("اصل original <b>not markup</b>")).toBeInTheDocument();
  jest.setSystemTime(end);
  act(() => { jest.advanceTimersByTime(101); });
  expect(screen.getByText(/Transcript retention has ended/)).toBeInTheDocument();
  expect(screen.queryByText("اصل original <b>not markup</b>")).not.toBeInTheDocument(); expect(global.fetch).toHaveBeenCalledTimes(1);
});
test("history requires explicit interview selection and pages exact case, list and entry cursors", async () => {
  const entries = Array.from({ length: 16 }, (_, i) => entry(i + 1, `line ${i + 1}`));
  (global.fetch as jest.Mock).mockImplementation(async (url: string) => {
    if (url.includes("before=one")) return response({ caseId: 42, interviews: [metadata("older")], nextBefore: null });
    if (url.includes("?limit=10")) return response({ caseId: 42, interviews: [metadata()], nextBefore: "one" });
    return url.includes("afterSequence=16") ? page("one", "saved", [entry(17, "last line")], 17, 42, 17) : page("one", "saved", entries, 17, 42, 16);
  });
  render(<SavedTranscriptHistory caseId={42} />); expect(global.fetch).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Load recent interviews" }));
  const select = await screen.findByRole("button", { name: /Interview .*saved/ });
  expect(global.fetch).toHaveBeenCalledTimes(1); fireEvent.click(select);
  await screen.findByText("line 16"); expect(screen.queryByText("last line")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Load more transcript text" }));
  await screen.findByText("last line");
  expect((global.fetch as jest.Mock).mock.calls[2][0]).toContain("/42/intake-v2/transcripts/one?afterSequence=16");
  fireEvent.click(screen.getByRole("button", { name: "Older interviews" }));
  await waitFor(() => expect(screen.queryByText("last line")).not.toBeInTheDocument());
  expect((global.fetch as jest.Mock).mock.calls[3][0]).toContain("/42/intake-v2/transcripts?limit=10&before=one");
});
test("history traversal bounds cursor bookkeeping and requires an explicit restart", async () => {
  let index = 0;
  (global.fetch as jest.Mock).mockImplementation(async () => {
    const sessionId = `page-${index++}`;
    return response({ caseId: 42, interviews: [metadata(sessionId)], nextBefore: sessionId });
  });
  render(<SavedTranscriptHistory caseId={42} />);
  fireEvent.click(screen.getByRole("button", { name: "Load recent interviews" }));
  await screen.findByRole("button", { name: "Older interviews" });
  for (let i = 0; i < 64; i++) {
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Older interviews" })); });
  }
  expect(global.fetch).toHaveBeenCalledTimes(65);
  expect(screen.getByRole("button", { name: "Older interviews" })).toBeDisabled();
  expect(screen.getByText(/History browsing limit reached/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Older interviews" }));
  expect(global.fetch).toHaveBeenCalledTimes(65);
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Load recent interviews" })); });
  expect(global.fetch).toHaveBeenCalledTimes(66);
  expect(screen.getByRole("button", { name: "Older interviews" })).toBeEnabled();
  expect(screen.queryByText(/History browsing limit reached/)).not.toBeInTheDocument();
});
test("tail follows only a reader already at bottom", () => {
  const view = render(<TranscriptText entries={[entry()]} />), box = screen.getByLabelText("Transcript text");
  Object.defineProperties(box, { scrollHeight: { configurable: true, value: 1000 }, clientHeight: { configurable: true, value: 200 }, scrollTop: { configurable: true, writable: true, value: 100 } });
  fireEvent.scroll(box); view.rerender(<TranscriptText entries={[entry(), entry(2)]} />); expect(box.scrollTop).toBe(100);
  box.scrollTop = 800; fireEvent.scroll(box); view.rerender(<TranscriptText entries={[entry(), entry(2), entry(3)]} />); expect(box.scrollTop).toBe(1000);
});

test.each(["404", "unresolved"])("unverified live RAM display expires at the conservative admission cutoff even with %s reads", async mode => {
  jest.useFakeTimers(); jest.setSystemTime(start);
  (global.fetch as jest.Mock).mockImplementation(() => mode === "404" ? Promise.resolve(response({}, false)) : new Promise(() => {}));
  render(<SessionTranscript caseId={42} sessionId="one" liveEntries={[entry()]} displayEndsAt={start + 100} />);
  fireEvent.click(screen.getByRole("button", { name: "Check saved transcript" }));
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  expect(screen.getByText("اصل original <b>not markup</b>")).toBeInTheDocument();
  act(() => { jest.advanceTimersByTime(101); });
  expect(screen.queryByText("اصل original <b>not markup</b>")).not.toBeInTheDocument();
  expect(screen.getByText(/Transcript retention has ended/)).toBeInTheDocument();
  expect(global.fetch).toHaveBeenCalledTimes(1);
});
test("automatic read reconciliation is bounded to three attempts, never live polling", async () => {
  jest.useFakeTimers(); jest.setSystemTime(start);
  (global.fetch as jest.Mock).mockResolvedValue(response({}, false));
  render(<SessionTranscript caseId={42} sessionId="one" reconcile={1} />);
  for (let i = 0; i < 5; i++) await act(async () => { jest.advanceTimersByTime(1500); await Promise.resolve(); await Promise.resolve(); });
  expect(global.fetch).toHaveBeenCalledTimes(3);
});

test("StrictMode setup/cleanup cannot strand an explicit saved selection", async () => {
  (global.fetch as jest.Mock).mockResolvedValue(page());
  render(<React.StrictMode><SessionTranscript caseId={42} sessionId="one" reconcile={1} pageByPage /></React.StrictMode>);
  await screen.findByText(/Saved transcript available/);
  expect(screen.getByRole("button", { name: "Check saved transcript" })).toBeEnabled();
});
test("oversized streaming response aborts before JSON parsing and preserves best-effort text", async () => {
  const cancel = jest.fn(async () => {});
  (global.fetch as jest.Mock).mockResolvedValue({ ok: true, body: { getReader: () => ({ read: async () => ({ done: false, value: new Uint8Array(32769) }), cancel }) } });
  render(<SessionTranscript caseId={42} sessionId="one" liveEntries={[entry()]} />);
  fireEvent.click(screen.getByRole("button", { name: "Check saved transcript" }));
  await screen.findByRole("alert");
  expect((global.fetch as jest.Mock).mock.calls[0][1].signal.aborted).toBe(true);
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(screen.getByText("اصل original <b>not markup</b>")).toBeInTheDocument();
});

test("compact live mode hides saved-reader controls and keeps follow-tail conditional", () => {
  const view = render(<SessionTranscript caseId={42} sessionId="one" liveEntries={[entry()]} interviewState="listening" />);
  expect(screen.queryByRole("button", { name: "Check saved transcript" })).not.toBeInTheDocument();
  expect(screen.queryByText(/Saving delayed/)).not.toBeInTheDocument();
  expect(screen.queryByText(/certified evidence/)).not.toBeInTheDocument();
  const box = screen.getByLabelText("Transcript text");
  Object.defineProperties(box, { scrollHeight: { configurable: true, value: 1000 }, clientHeight: { configurable: true, value: 200 }, scrollTop: { configurable: true, writable: true, value: 100 } });
  fireEvent.scroll(box);
  view.rerender(<SessionTranscript caseId={42} sessionId="one" liveEntries={[entry(), entry(2)]} interviewState="listening" />);
  expect(box.scrollTop).toBe(100);
  box.scrollTop = 800; fireEvent.scroll(box);
  view.rerender(<SessionTranscript caseId={42} sessionId="one" liveEntries={[entry(), entry(2), entry(3)]} interviewState="ended" />);
  expect(screen.getByLabelText("Transcript text")).toBe(box); expect(box.scrollTop).toBe(1000);
});

test("ended compact captured text has visible checking, 404, empty and partial saved-read feedback", async () => {
  const pending = defer();
  (global.fetch as jest.Mock).mockReturnValueOnce(pending.promise).mockResolvedValueOnce(page("one", "collecting", [], 0)).mockResolvedValueOnce(page("one", "partial"));
  render(<SessionTranscript caseId={42} sessionId="one" liveEntries={[entry()]} interviewState="ended" />);
  fireEvent.click(screen.getByRole("button", { name: "Check saved transcript" }));
  expect(screen.getByRole("button", { name: "Checking saved transcript…" })).toBeDisabled();
  await act(async () => pending.resolve({ ...response({}, false), status: 404 }));
  expect(screen.getByRole("alert")).toHaveTextContent("No saved transcript is available yet");
  expect(screen.getByText("اصل original <b>not markup</b>")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Check saved transcript" }));
  await screen.findByText("No saved transcript is available yet.");
  fireEvent.click(screen.getByRole("button", { name: "Check saved transcript" }));
  await screen.findByText(/Only part of the conversation has been saved/);
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

test("unavailable saving is visible during voice even before a transcript turn arrives", () => {
  render(<SessionTranscript caseId={42} sessionId="one" savingUnavailable interviewState="listening" />);
  expect(screen.getByRole("alert")).toHaveTextContent("Transcript saving is unavailable");
  expect(screen.getByText("Listening — speak naturally.")).toBeInTheDocument();
  expect(global.fetch).not.toHaveBeenCalled();
});

test("active voice reconciles missed events from Express and warns about partial saving without provider work", async () => {
  jest.useFakeTimers(); jest.setSystemTime(start + 2000);
  (global.fetch as jest.Mock).mockResolvedValue(page("one", "partial", [entry(1, "missed live event")]));
  const view = render(<SessionTranscript caseId={42} sessionId="one" interviewState="listening" />);
  expect(global.fetch).not.toHaveBeenCalled();
  await act(async () => { jest.advanceTimersByTime(5000); });
  expect(screen.getByText("missed live event")).toBeInTheDocument();
  expect(screen.getByRole("alert")).toHaveTextContent("Only part of the conversation has been saved");
  expect(screen.getByText("Listening — speak naturally.")).toBeInTheDocument();
  expect((global.fetch as jest.Mock).mock.calls[0][0]).toContain("/intake-v2/transcripts/one?afterSequence=0");
  expect((global.fetch as jest.Mock).mock.calls[0][1].method).toBeUndefined();
  view.rerender(<SessionTranscript caseId={42} sessionId="one" interviewState="ended" />);
  await act(async () => { jest.advanceTimersByTime(300000); });
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

test("saved capture partialness remains visible when its best-effort status event was missed", async () => {
  jest.useFakeTimers(); jest.setSystemTime(start + 2000);
  const captured = { caseId: 42, interview: { ...metadata(), sealReason: "capture_error", truncated: true }, entries: [entry()], nextSequence: 1, hasMore: false };
  (global.fetch as jest.Mock).mockResolvedValue(response(captured));
  render(<SessionTranscript caseId={42} sessionId="one" interviewState="listening" />);
  await act(async () => { jest.advanceTimersByTime(5000); });
  expect(screen.getByText("Some of the conversation could not be captured.")).toBeInTheDocument();
  expect(screen.getByText("Listening — speak naturally.")).toBeInTheDocument();
});

test("active saved checks are serial, capped and cancelled on unmount", async () => {
  jest.useFakeTimers(); jest.setSystemTime(start + 2000);
  const pending = defer(); (global.fetch as jest.Mock).mockReturnValue(pending.promise);
  const view = render(<SessionTranscript caseId={42} sessionId="one" interviewState="listening" />);
  await act(async () => { jest.advanceTimersByTime(5000); });
  expect(global.fetch).toHaveBeenCalledTimes(1);
  await act(async () => { jest.advanceTimersByTime(9000); });
  expect(global.fetch).toHaveBeenCalledTimes(1);
  const signal = (global.fetch as jest.Mock).mock.calls[0][1].signal;
  view.unmount(); expect(signal.aborted).toBe(true);
  await act(async () => { pending.resolve(page()); jest.advanceTimersByTime(300000); });
  expect(global.fetch).toHaveBeenCalledTimes(1);

  (global.fetch as jest.Mock).mockReset().mockImplementation(async (url: string) => url.endsWith("afterSequence=0") ? page() : page("one", "saved", [], 1, 42, 1));
  render(<SessionTranscript caseId={42} sessionId="one" interviewState="listening" />);
  for (let i = 0; i < 65; i++) await act(async () => { jest.advanceTimersByTime(5000); });
  expect(global.fetch).toHaveBeenCalledTimes(60);
});

test("active read failures warn without clearing text or ending voice", async () => {
  jest.useFakeTimers(); jest.setSystemTime(start + 2000); (global.fetch as jest.Mock).mockRejectedValue(new TypeError("offline"));
  render(<SessionTranscript caseId={42} sessionId="one" liveEntries={[entry()]} interviewState="listening" />);
  await act(async () => { jest.advanceTimersByTime(5000); });
  expect(screen.getByRole("alert")).toHaveTextContent("Saving delayed or unavailable");
  expect(screen.getByText("Listening — speak naturally.")).toBeInTheDocument();
  expect(screen.getByText("اصل original <b>not markup</b>")).toBeInTheDocument();
});

test("ended interviews expose saved-read feedback even with no live events", () => {
  render(<SessionTranscript caseId={42} sessionId="one" interviewState="ended" />);
  expect(screen.getByRole("button", { name: "Check saved transcript" })).toBeEnabled();
  expect(screen.getByText(/not been confirmed as saved/)).toBeInTheDocument();
});

test("speaker presentation distinguishes turns while each mixed-language paragraph keeps automatic direction", () => {
  const view = render(<TranscriptText entries={[entry(1, "Assistant paragraph"), { ...entry(2, "اردو متن\nEnglish paragraph"), speaker: "user", interrupted: false }]} />);
  expect(view.container.querySelector(".transcript-turn-assistant")).toHaveTextContent("Assistant");
  expect(view.container.querySelector(".transcript-turn-assistant")).toHaveTextContent("Interrupted");
  const client = view.container.querySelector(".transcript-turn-user")!;
  expect(client).toHaveTextContent("You");
  expect(client).not.toHaveTextContent("Interrupted");
  expect(client.querySelectorAll("p")).toHaveLength(2);
  client.querySelectorAll("p").forEach(paragraph => expect(paragraph).toHaveAttribute("dir", "auto"));
  expect(screen.getByLabelText("Transcript text")).toHaveAttribute("tabindex", "0");
  expect(global.fetch).not.toHaveBeenCalled();
});
