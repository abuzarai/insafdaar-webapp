import { intakeError } from "./reviewedIntake.service.js";

// Capabilities stay in bounded process memory, never SQL, receipts, URLs or logs.
// One Express process / one voice instance initially. Restart loses unsaved calls.
export class LiveIntakeClient {
  constructor() { this.sessions = new Map(); this.admitting = false; }
  async request(path, { method = "GET", body, capability, bootstrap = false, transcript = false, timeoutMs = 5000 } = {}) {
    const raw = process.env.VOICE_LIVE_INTERNAL_URL;
    let base;
    try { base = new URL(raw); } catch { throw Object.assign(intakeError(503, "LIVE_NOT_CONFIGURED"), { definitiveAdmissionRejection: bootstrap }); }
    if (!["http:", "https:"].includes(base.protocol) || base.username || base.password || base.search || base.hash) throw Object.assign(intakeError(503, "LIVE_NOT_CONFIGURED"), { definitiveAdmissionRejection: bootstrap });
    const secret = process.env.VOICE_LIVE_BOOTSTRAP_SECRET;
    if (bootstrap && (typeof secret !== "string" || secret.length < 32 || secret.length > 256)) throw Object.assign(intakeError(503, "LIVE_NOT_CONFIGURED"), { definitiveAdmissionRejection: bootstrap });
    const headers = { Accept: "application/json", "Content-Type": "application/json" };
    if (capability) headers.Authorization = `Bearer ${capability}`;
    if (bootstrap) headers["x-live-bootstrap-secret"] = secret;
    try {
      const response = await fetch(new URL(`/api/v1/live/sessions${path}`, base), {
        method, headers, body: body === undefined ? undefined : JSON.stringify(body),
        credentials: "omit",
        signal: AbortSignal.timeout(transcript ? Math.max(1, Math.min(5000, timeoutMs)) : method === "POST" && (path.endsWith("/audio-draft") || path.endsWith("/webrtc/offer")) ? 35000 : 5000),
        redirect: "error", cache: "no-store",
      });
      if (!response.ok) {
        const rejected = response.status >= 400 && response.status < 500;
        const error = intakeError(rejected || response.status === 503 ? response.status : 502,
          bootstrap && response.status === 429 ? "LIVE_ADMISSION_RATE_LIMITED" : "LIVE_REQUEST_REJECTED");
        // A definite rejection from the trusted admission endpoint is not an
        // unknown network outcome. No response body or credential is exposed.
        error.definitiveAdmissionRejection = bootstrap && rejected;
        throw error;
      }
      const reader = response.body.getReader();
      let size = 0; const chunks = [];
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > (transcript ? 32768 : 100000)) throw intakeError(502, "LIVE_RESPONSE_TOO_LARGE");
          chunks.push(Buffer.from(value));
        }
      } finally { await reader.cancel().catch(() => {}); }
      return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch (error) {
      if (error.code && error.status) throw error;
      throw intakeError(502, "LIVE_REQUEST_FAILED");
    }
  }
  transcriptReader(actor, caseId, sessionId) {
    const owned = this.owned(actor, caseId, sessionId);
    let capability = owned.capability;
    const expiry = owned.expiresAt;
    const clear = () => { capability = null; clearTimeout(timer); };
    const timer = setTimeout(clear, Math.max(0, expiry - Date.now()));
    timer.unref?.();
    return {
      clear,
      read: afterSequence => {
        if (!capability || Date.now() >= expiry) { clear(); throw intakeError(409, "LIVE_SESSION_EXPIRED"); }
        return this.request(`/${sessionId}/transcript/read`, { method: "POST", body: { after_sequence: afterSequence },
          capability, transcript: true, timeoutMs: expiry - Date.now() });
      },
    };
  }
  owned(actor, caseId, sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session || session.actorId !== Number(actor.id) || session.caseId !== caseId) throw intakeError(404, "LIVE_SESSION_NOT_FOUND");
    if (session.expiresAt <= Date.now()) { this.sessions.delete(sessionId); throw intakeError(409, "LIVE_SESSION_EXPIRED"); }
    return session;
  }
  async admit(actor, caseId) {
    for (const [id, s] of this.sessions) if (s.expiresAt <= Date.now()) this.sessions.delete(id);
    if (this.admitting || this.sessions.size) throw Object.assign(intakeError(503, "LIVE_BUSY"), { definitiveAdmissionRejection: true });
    this.admitting = true;
    try {
      const issued = await this.request("", { method: "POST", body: { processing_consent: true }, bootstrap: true });
      if (typeof issued.session_id !== "string" || typeof issued.capability !== "string" || typeof issued.expires_at !== "string" ||
          !/^[A-Za-z0-9_-]{1,128}$/.test(issued.session_id) || !/^[A-Za-z0-9_-]{43}$/.test(issued.capability) ||
          !Number.isFinite(Date.parse(issued.expires_at)) || Date.parse(issued.expires_at) <= Date.now() ||
          Date.parse(issued.expires_at) > Date.now() + 300000) throw intakeError(502, "INVALID_LIVE_ADMISSION");
      const issuedAt = new Date().toISOString();
      const session = { caseId, actorId: Number(actor.id), capability: issued.capability, expiresAt: Date.parse(issued.expires_at) };
      this.sessions.set(issued.session_id, session);
      const expiry = setTimeout(() => {
        session.capability = null;
        if (this.sessions.get(issued.session_id) === session) this.sessions.delete(issued.session_id);
      }, Math.max(0, session.expiresAt - Date.now()));
      expiry.unref?.();
      return { sessionId: issued.session_id, expiresAt: issued.expires_at, issuedAt };
    } finally { this.admitting = false; }
  }
  async call(actor, caseId, sessionId, suffix, method = "GET", body) {
    const owned = this.owned(actor, caseId, sessionId);
    if (!["state", "stop", "audio-draft", "webrtc/offer"].includes(suffix)) throw intakeError(400, "INVALID_LIVE_OPERATION");
    if (suffix === "webrtc/offer" && method === "POST") {
      // Reserve before the first await. SDK renegotiation/reconnect must never
      // create another upstream initial offer after an uncertain outcome.
      if (owned.offered) throw intakeError(409, "LIVE_OFFER_ALREADY_ATTEMPTED");
      owned.offered = true;
    }
    if (suffix === "audio-draft" && method === "POST") {
      if (owned.prepared) throw intakeError(409, "LIVE_PREPARE_ALREADY_ATTEMPTED");
      owned.prepared = true;
    }
    return this.request(`/${sessionId}/${suffix}`, { method, body, capability: owned.capability });
  }
  async stop(actor, caseId, sessionId) {
    this.owned(actor, caseId, sessionId);
    const pending = this.call(actor, caseId, sessionId, "stop", "POST", {});
    this.sessions.get(sessionId).capability = null;
    this.sessions.delete(sessionId);
    return pending;
  }
}
export const liveIntakeClient = new LiveIntakeClient();
