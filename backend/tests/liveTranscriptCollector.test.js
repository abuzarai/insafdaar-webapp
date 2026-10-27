import { jest, test, expect, beforeEach, afterEach } from "@jest/globals";
jest.unstable_mockModule("../db.js", () => ({ default: { query: jest.fn(), connect: jest.fn() } }));
const { LiveTranscriptCollector, startTranscriptMaintenance } = await import("../services/liveTranscriptCollector.js");
let service, client, reader, collector, source;
const actor = { id: 42, role: "client" };
const flush = async (ms = 0) => { await jest.advanceTimersByTimeAsync(ms); };
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
beforeEach(() => {
  jest.useFakeTimers(); jest.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  source = { sessionId: "session", issuedAt: new Date().toISOString(), originalExpiry: new Date(Date.now() + 60000).toISOString(), noticeVersion: "live-transcript-v1", acknowledgedAt: new Date().toISOString() };
  service = { registerSource: jest.fn(async () => ({})), saveBatch: jest.fn(async () => ({ savedThrough: 1, lastCapturedSequence: 1, sealed: false })), markEnded: jest.fn(async () => ({})), markPartial: jest.fn(async () => ({})) };
  reader = { read: jest.fn(async () => ({ entries: [{ text: "synthetic" }] })), clear: jest.fn() };
  client = { transcriptReader: jest.fn(() => reader) };
  collector = new LiveTranscriptCollector(service, client);
});
afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); });
const start = () => collector.start(actor, 101, source);

test("registration precedes serial capture, cursor advances only after committed save", async () => {
  const pending = deferred(); service.saveBatch.mockReturnValueOnce(pending.promise);
  expect(start()).toBe("pending"); await flush();
  expect(service.registerSource).toHaveBeenCalledWith(actor, 101, source);
  expect(reader.read).toHaveBeenCalledWith(0); expect(collector.job.cursor).toBe(0);
  await flush(4000); expect(reader.read).toHaveBeenCalledTimes(1);
  pending.resolve({ savedThrough: 1, lastCapturedSequence: 1, sealed: false }); await flush();
  expect(collector.job.cursor).toBe(1);
  await flush(999); expect(reader.read).toHaveBeenCalledTimes(1);
  await flush(1); expect(reader.read).toHaveBeenLastCalledWith(1);
});

test("storage rollback retries same source cursor without provider recovery", async () => {
  service.saveBatch.mockRejectedValueOnce({ status: 503 }); start(); await flush(); await flush(1000);
  expect(reader.read.mock.calls).toEqual([[0], [0]]); expect(client.transcriptReader).toHaveBeenCalledTimes(1);
});

test("bounded capacity rejects replacement during hung acquisition; expiry clears source independently", async () => {
  const pending = deferred(); service.registerSource.mockReturnValue(pending.promise);
  start(); await flush(); expect(start()).toBe("unavailable");
  collector.end(actor, 101, "session");
  expect(collector.job.endedAt).not.toBeNull(); expect(service.markEnded).not.toHaveBeenCalled();
  await flush(15000); expect(reader.clear).toHaveBeenCalled(); expect(collector.job.reader).toBeNull();
  expect(start()).toBe("unavailable"); expect(service.registerSource).toHaveBeenCalledTimes(1);
  pending.resolve({}); await flush();
  expect(service.markEnded).toHaveBeenCalledTimes(1); expect(service.markPartial).toHaveBeenCalledTimes(1); expect(collector.job).toBeNull();
});

test("original TTL clears authority while save is pending and later records fallback end", async () => {
  const pending = deferred(); service.saveBatch.mockReturnValueOnce(pending.promise);
  start(); await flush(); await flush(60000);
  expect(reader.clear).toHaveBeenCalled(); expect(collector.job.reader).toBeNull();
  pending.resolve({ savedThrough: 1, lastCapturedSequence: 1, sealed: false }); await flush(1);
  expect(service.markEnded).toHaveBeenCalledWith(actor, 101, "session", source.originalExpiry);
  expect(service.markPartial).toHaveBeenCalled(); expect(collector.job).toBeNull();
});

test("three transient failures exhaust capture retries without invoking provider operations", async () => {
  reader.read.mockRejectedValue({ status: 502 }); start(); await flush(4000);
  expect(reader.read).toHaveBeenCalledTimes(3); expect(service.markPartial).toHaveBeenCalledTimes(1);
  expect(reader.clear).toHaveBeenCalled(); expect(service.markEnded).not.toHaveBeenCalled();
});

test("permanent source rejection is not retried", async () => {
  reader.read.mockRejectedValue({ status: 401 }); start(); await flush(5000);
  expect(reader.read).toHaveBeenCalledTimes(1); expect(service.markPartial).toHaveBeenCalledTimes(1);
});

test.each(["limit", "capture_error"])("%s seal releases read but retains genuine end lifecycle", async seal_reason => {
  reader.read.mockResolvedValue({ seal_reason, sealed_at: source.issuedAt });
  service.saveBatch.mockResolvedValue({ savedThrough: 1, lastCapturedSequence: 1, sealed: true });
  start(); await flush(2000); expect(reader.read).toHaveBeenCalledTimes(1);
  expect(service.markEnded).not.toHaveBeenCalled(); expect(collector.job).not.toBeNull();
  collector.end(actor, 101, "session", new Date().toISOString()); await flush();
  expect(service.markEnded).toHaveBeenCalledTimes(1); expect(collector.job).toBeNull();
});

test("terminal source seal establishes first end and reconciles contiguous saved tail", async () => {
  reader.read.mockResolvedValue({ seal_reason: "stopped", sealed_at: source.issuedAt });
  service.saveBatch.mockResolvedValueOnce({ savedThrough: 1, lastCapturedSequence: 2, sealed: true }).mockResolvedValue({ savedThrough: 2, lastCapturedSequence: 2, sealed: true });
  start(); await flush(2000);
  expect(reader.read.mock.calls).toEqual([[0], [1]]); expect(service.markEnded).toHaveBeenCalledTimes(1);
  expect(service.markPartial).not.toHaveBeenCalled(); expect(collector.job).toBeNull();
});

test("empty reads without final seal remain unknown and become partial at terminal bound", async () => {
  service.saveBatch.mockResolvedValue({ savedThrough: 0, lastCapturedSequence: 0, sealed: false });
  start(); await flush(); collector.end(actor, 101, "session");
  collector.end(actor, 101, "session", new Date(Date.now() + 10000).toISOString());
  await flush(15001); expect(service.markPartial).toHaveBeenCalledTimes(1); expect(collector.job).toBeNull();
  expect(reader.read.mock.calls.length).toBeLessThanOrEqual(16);
  expect(service.markEnded).toHaveBeenCalledTimes(1);
});

test("maintenance runs initially and hourly without overlapping or leaking diagnostics", async () => {
  const pending = deferred(), purgeExpired = jest.fn(() => pending.promise), warn = jest.fn();
  const stop = startTranscriptMaintenance({ purgeExpired }, warn);
  await flush(7200000); expect(purgeExpired).toHaveBeenCalledTimes(1); expect(purgeExpired).toHaveBeenCalledWith(100);
  pending.reject(new Error("private")); await flush(); expect(warn).toHaveBeenCalledWith();
  await flush(3600000); expect(purgeExpired).toHaveBeenCalledTimes(2); stop();
  await flush(3600000); expect(purgeExpired).toHaveBeenCalledTimes(2);
});

test("registration and end storage retries are explicitly capped at three", async () => {
  service.registerSource.mockRejectedValue({ status: 503 }); start(); await flush(10000);
  expect(service.registerSource).toHaveBeenCalledTimes(3);
  await flush(60000); expect(service.registerSource).toHaveBeenCalledTimes(3); expect(collector.job).toBeNull();
  service.registerSource.mockResolvedValue({}); service.markEnded.mockRejectedValue({ status: 503 });
  source.originalExpiry = new Date(Date.now() + 60000).toISOString();
  start(); collector.end(actor, 101, "session"); await flush(10000);
  expect(service.markEnded).toHaveBeenCalledTimes(3); expect(collector.job).toBeNull();
});

test("foreign lifecycle notification cannot end source or revise retention", async () => {
  start(); collector.end({ id: 99 }, 101, "session"); collector.end(actor, 102, "session");
  await flush(); expect(collector.job.endedAt).toBeNull(); expect(service.markEnded).not.toHaveBeenCalled();
});

test("storage failures completing after original expiry do not enqueue retries", async () => {
  const pending = deferred(); service.markEnded.mockReturnValueOnce(pending.promise);
  start(); collector.end(actor, 101, "session"); await flush(); await flush(60000);
  pending.reject({ status: 503 }); await flush(1000);
  expect(service.markEnded).toHaveBeenCalledTimes(1); expect(reader.read).not.toHaveBeenCalled();
  expect(collector.job).toBeNull();
});
