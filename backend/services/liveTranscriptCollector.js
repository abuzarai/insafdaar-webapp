import * as storage from "./liveTranscript.service.js";
import { liveIntakeClient } from "./liveIntakeClient.js";

export const TRANSCRIPT_NOTICE_VERSION = "live-transcript-v1";

// One bounded job, with no replacement while an outstanding storage call hangs.
// The independent deadline clears source authority even during pool starvation.
export class LiveTranscriptCollector {
  constructor(service = storage, client = liveIntakeClient) {
    this.service = service;
    this.client = client;
    this.job = null;
  }
  start(actor, caseId, source) {
    if (this.job) return "unavailable";
    let reader;
    try { reader = this.client.transcriptReader(actor, caseId, source.sessionId); }
    catch { return "unavailable"; }
    const job = { actor: { id: actor.id, role: actor.role }, caseId, source, reader, cursor: 0,
      registered: false, endedAt: null, endSaved: false, partial: false, complete: false,
      failures: 0, registerAttempts: 0, endAttempts: 0, partialAttempts: 0, busy: false, deadline: Date.parse(source.originalExpiry), expired: false };
    this.job = job;
    job.expiry = setTimeout(() => this.expire(job), Math.max(0, job.deadline - Date.now()));
    job.expiry.unref?.();
    this.schedule(job, 0);
    return "pending";
  }
  end(actor, caseId, sessionId, at = new Date().toISOString()) {
    const job = this.job;
    if (!job || job.source.sessionId !== sessionId || job.caseId !== caseId || Number(job.actor.id) !== Number(actor.id) || job.endedAt) return;
    job.endedAt = at;
    job.deadline = Math.min(job.deadline, Date.now() + 15000);
    clearTimeout(job.expiry);
    job.expiry = setTimeout(() => this.expire(job), Math.max(0, job.deadline - Date.now()));
    job.expiry.unref?.();
    this.schedule(job, 0);
  }
  expire(job) {
    job.reader?.clear(); job.reader = null;
    job.expired = true;
    job.endedAt ||= job.source.originalExpiry;
    job.partial ||= !job.complete;
    this.schedule(job, 0);
  }
  schedule(job, delay = 1000) {
    if (this.job !== job || job.busy) return;
    clearTimeout(job.timer);
    job.timer = setTimeout(() => { void this.tick(job).catch(() => {}); }, delay);
    job.timer.unref?.();
  }
  async tick(job) {
    if (job.busy || this.job !== job) return;
    job.busy = true;
    let phase;
    const withinOriginalTTL = () => Date.now() < Date.parse(job.source.originalExpiry);
    try {
      if (!job.registered && job.registerAttempts < 3 && (job.registerAttempts === 0 || withinOriginalTTL())) {
        phase = "register";
        job.registerAttempts++;
        await this.service.registerSource(job.actor, job.caseId, job.source);
        job.registered = true;
      }
      if (job.registered && job.endedAt && !job.endSaved && job.endAttempts < 3 && (job.endAttempts === 0 || withinOriginalTTL())) {
        phase = "end";
        job.endAttempts++;
        await this.service.markEnded(job.actor, job.caseId, job.source.sessionId, job.endedAt);
        job.endSaved = true;
      }
      if (job.registered && !job.expired && !job.complete && !job.partial && job.reader) {
        phase = "capture";
        const batch = await job.reader.read(job.cursor);
        if (!job.expired) {
          const saved = await this.service.saveBatch(job.actor, job.caseId, job.source.sessionId, job.cursor, batch);
          job.cursor = saved.savedThrough;
          job.complete = saved.sealed && saved.savedThrough === saved.lastCapturedSequence;
          if (saved.sealed && !["limit", "capture_error"].includes(batch.seal_reason)) {
            this.end(job.actor, job.caseId, job.source.sessionId, batch.sealed_at);
          }
          // A source limit/capture error seals text, not the interview lifecycle.
          if (job.complete) {
            job.reader?.clear(); job.reader = null;
          }
        }
      }
      job.failures = 0;
    } catch (error) {
      job.failures++;
      if (error.status && error.status < 500) {
        if (phase === "register") job.registerAttempts = 3;
        if (phase === "end") job.endAttempts = 3;
      }
      // Only non-provider transient reads/storage failures may be retried.
      if (job.failures >= 3 || (error.status && error.status < 500)) {
        job.partial = true;
        job.reader?.clear(); job.reader = null;
      }
    } finally {
      job.busy = false;
    }
    if (job.partial && job.registered && !job.partialSaved && job.partialAttempts < 3 && (job.partialAttempts === 0 || withinOriginalTTL())) {
      job.partialAttempts++;
      // At most one outstanding storage operation, including failure bookkeeping.
      job.busy = true;
      try { await this.service.markPartial(job.actor, job.caseId, job.source.sessionId); job.partialSaved = true; }
      catch (error) { if (error.status && error.status < 500) job.partialAttempts = 3; }
      finally { job.busy = false; }
    }
    if (job.expired && job.registered && !job.endSaved && job.endAttempts < 3 && (job.endAttempts === 0 || withinOriginalTTL())) {
      this.schedule(job, 0);
      return;
    }
    if (job.expired || (job.endedAt && (job.endSaved || job.endAttempts >= 3) && (job.complete || job.partial))) {
      job.reader?.clear(); clearTimeout(job.expiry); clearTimeout(job.timer);
      if (this.job === job) this.job = null;
    } else if (!job.registered && job.registerAttempts >= 3) {
      job.reader?.clear(); job.reader = null;
    } else if ((job.complete || (job.partial && (job.partialSaved || job.partialAttempts >= 3))) && !job.endedAt) {
      // Only the genuine end/TTL callback needs this minimal lifecycle record.
    } else if (job.failures < 3 || job.registered) this.schedule(job);
    else {
      // Registration failed: retain only bounded lifecycle state until TTL.
      job.reader?.clear(); job.reader = null;
    }
  }
}
export const liveTranscriptCollector = new LiveTranscriptCollector();

export function startTranscriptMaintenance(service = storage, warn = () => console.warn("Transcript retention maintenance unavailable")) {
  let busy = false;
  const run = async () => {
    if (busy) return;
    busy = true;
    try { await service.purgeExpired(100); } catch { try { warn(); } catch { /* no callback rejection */ } }
    finally { busy = false; }
  };
  void run();
  const timer = setInterval(() => { void run(); }, 3600000);
  timer.unref?.();
  return () => clearInterval(timer);
}
