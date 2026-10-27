import { PipecatClient, LogLevel, logger } from "@pipecat-ai/client-js";
import { SingleOfferWebRTCTransport } from "./SingleOfferWebRTCTransport";
import Daily from "@daily-co/daily-js";
import { appendLive, parseTranscriptEvent, TranscriptEntry, TranscriptStatus } from "./transcript";

logger.setLevel(LogLevel.NONE);
type Admission = { sessionId: string; expiresAt: string; caseVersion: number; transcriptSaving?: "pending" | "unavailable" };
type Options = {
  audio: HTMLAudioElement;
  admit: () => Promise<Admission>;
  request: (suffix: string, body: object) => Promise<any>;
  offer: (sessionId: string) => { endpoint: string | Request; headers: Headers; timeout?: number };
  onAdmitted: (session: Admission) => void;
  onConnected: () => void;
  onPrepared: () => void;
  onInterviewFinished?: () => void;
  onTranscript?: (entries: TranscriptEntry[], status?: TranscriptStatus) => void;
  onStopped: () => void;
  onFailure: (stage: string, reason: string) => void;
  onPlaybackBlocked: () => void;
};

// One owned call, one offer, one Prepare. No retry or bot-ready dependency.
export class ReviewedVoice {
  private client?: PipecatClient;
  private daily?: ReturnType<typeof Daily.createCallObject>;
  private remote?: MediaStreamTrack;
  private session?: Admission;
  private used = false;
  private stopped = false;
  private suppressed = false;
  private connected = false;
  private prepared = false;
  private finishNotified = false;
  private transcript: TranscriptEntry[] = [];
  private transcriptStatus?: TranscriptStatus;
  private timer?: ReturnType<typeof setTimeout>;
  private stopping?: Promise<void>;
  private disconnecting?: Promise<void>;
  private stage = "admission";
  constructor(private options: Options) {}
  private capture(track?: MediaStreamTrack) {
    try { void Promise.resolve(this.client?.enableMic(false)).catch(() => {}); } catch {}
    try {
      const owned = track || this.client?.tracks().local?.audio;
      if (owned) { owned.enabled = false; owned.stop(); }
    } catch {}
  }
  private boundary() {
    this.suppressed = true;
    this.capture();
    const audio = this.options.audio;
    audio.pause(); audio.muted = true; audio.srcObject = null;
    if (this.remote) this.remote.enabled = false;
  }
  async play(track = this.remote) {
    if (!track || track.kind !== "audio") return;
    this.remote = track;
    if (this.suppressed || this.stopped) { track.enabled = false; return; }
    const audio = this.options.audio;
    audio.muted = false; audio.srcObject = new MediaStream([track]);
    try { await audio.play(); }
    catch { if (!this.suppressed && !this.stopped) this.options.onPlaybackBlocked(); }
  }
  private disconnect(): Promise<void> {
    if (this.disconnecting) return this.disconnecting;
    const client = this.client, call = this.daily; this.daily = undefined;
    const bounded = async (work: () => Promise<unknown> | undefined) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([Promise.resolve().then(work), new Promise<void>(resolve => { timer = setTimeout(resolve, 3000); })]);
      } catch { /* Local capture/playback is already closed; server Stop is independent. */ }
      finally { clearTimeout(timer); }
    };
    this.disconnecting = (async () => {
      await bounded(() => client?.disconnect());
      await bounded(() => call?.destroy());
    })();
    return this.disconnecting;
  }
  private failure(error?: unknown) {
    if (this.stopped) return;
    // Only fixed lifecycle labels and standard exception names cross the UI
    // boundary. Never expose SDK messages, URLs, headers or provider payloads.
    const safeNames = ["NotAllowedError", "NotFoundError", "NotReadableError", "OverconstrainedError", "SecurityError", "AbortError", "TimeoutError"];
    const safeDeviceTypes = ["in-use", "permissions", "undefined-mediadevices", "not-found", "constraints", "unknown"];
    const deviceType = error && typeof error === "object" && "type" in error ? error.type : undefined;
    const admissionCodes = ["INTERVIEW_DAILY_LIMIT", "INTERVIEW_WEEKLY_LIMIT", "INTERVIEW_PLATFORM_LIMIT", "INTERVIEW_ALREADY_ACTIVE", "INTERVIEWS_PAUSED", "NEW_INTERVIEW_CONFIRMATION_REQUIRED", "LIVE_ADMISSION_RATE_LIMITED", "LIVE_BUSY", "LIVE_ADMISSION_PENDING", "ADMISSION_OUTCOME_UNKNOWN", "STALE_CASE_VERSION", "INTAKE_NOT_EDITABLE", "LEGACY_INTAKE_HISTORY", "INTAKE_UNAVAILABLE", "AUTHENTICATION_REQUIRED", "LIVE_NOT_CONFIGURED", "LIVE_REQUEST_REJECTED", "LIVE_REQUEST_FAILED", "INTENT_CONFLICT", "CLIENT_REQUIRED"];
    const reason = this.stage === "admission" && error instanceof Error && admissionCodes.includes(error.message) ? error.message
      : error instanceof Error && safeNames.includes(error.name) ? error.name
      : typeof deviceType === "string" && safeDeviceTypes.includes(deviceType) ? deviceType : "unavailable";
    this.options.onFailure(this.stage, reason);
    void this.stop();
  }
  async start() {
    if (this.used || this.stopped) return;
    this.used = true;
    try {
      this.session = await this.options.admit();
      if (this.stopped) {
        await this.options.request(`/sessions/${this.session.sessionId}/stop`, {}).catch(() => {});
        return;
      }
      this.options.onAdmitted(this.session);
      this.timer = setTimeout(() => { void this.stop(); }, Math.max(0, Math.min(300000, Date.parse(this.session.expiresAt) - Date.now())));
      this.stage = "media-preload";
      if (Daily.getCallInstance()) throw new Error("Foreign media session");
      this.daily = Daily.createCallObject({ dailyConfig: { avoidEval: true, bundlePathOverride: `${window.location.origin}/vendor/daily/0.90.0` } });
      let preload: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([this.daily.load(), new Promise((_, reject) => {
          preload = setTimeout(() => reject(new Error("Media preload deadline")), 15000);
        })]);
      } finally { clearTimeout(preload); }
      if (this.stopped) { await this.disconnect(); return; }
      this.stage = "device-init";
      this.client = new PipecatClient({
        transport: new SingleOfferWebRTCTransport(() => this.failure(), { iceServers: [], waitForICEGathering: true }),
        enableMic: true, enableCam: false, enableScreenShare: false, disconnectOnBotDisconnect: true,
        callbacks: {
          onConnected: () => {
            if (this.stopped || this.suppressed || this.connected) return;
            this.connected = true; this.stage = "conversation"; this.options.onConnected();
            void this.play(this.client?.tracks().bot?.audio);
          },
          onTrackStarted: (track, participant) => {
            if (participant?.local) {
              if (track.kind === "audio" && (this.stopped || this.suppressed)) this.capture(track);
            } else { void this.play(track); }
          },
          onServerMessage: (data: unknown) => {
            if (!data || typeof data !== "object" || Array.isArray(data)) return;
            const event = data as Record<string, unknown>;
            if (event.type === "transcript_turn" || event.type === "transcript_status") {
              if (!this.connected || this.stopped || this.suppressed || !this.session) return;
              const parsed = parseTranscriptEvent(event, this.session.sessionId);
              if (!parsed) return;
              if ("entry" in parsed) {
                const next = appendLive(this.transcript, parsed.entry, this.transcriptStatus);
                if (next === this.transcript) return;
                this.transcript = next;
              } else {
                if (this.transcriptStatus || this.transcript.some(e => e.sequence > parsed.status.last_captured_sequence)) return;
                this.transcriptStatus = parsed.status;
              }
              this.options.onTranscript?.([...this.transcript], this.transcriptStatus);
              return;
            }
            if (Object.keys(event).length !== 2 || event.type !== "interview_finished" ||
                typeof event.sessionId !== "string" || event.sessionId.length > 128 ||
                event.sessionId !== this.session?.sessionId || !this.connected ||
                this.stopped || this.suppressed || this.prepared || this.finishNotified) return;
            this.finishNotified = true;
            this.options.onInterviewFinished?.();
          },
          onDisconnected: () => this.failure(),
          onError: error => this.failure(error),
          onDeviceError: error => {
            const cameraOnly = error.devices?.length === 1 && error.devices[0] === "cam";
            if (!cameraOnly) this.failure(error);
          },
        },
      });
      this.client.setLogLevel(LogLevel.NONE);
      await this.client.initDevices();
      if (this.stopped) { this.boundary(); await this.disconnect(); return; }
      this.stage = "microphone-check";
      const mic = this.client.tracks().local?.audio;
      if (!mic || mic.readyState !== "live" || !mic.enabled) throw new Error("Microphone unavailable");
      const offer = this.options.offer(this.session.sessionId);
      // This promise also waits for unavailable RTVI bot-ready. Public callback gates UI.
      this.stage = "signaling";
      void this.client.connect({ webrtcRequestParams: offer, iceConfig: { iceServers: [] } }).catch(error => this.failure(error));
    } catch (error) { this.failure(error); }
  }
  async prepare() {
    if (!this.connected || this.stopped || this.prepared) return false;
    this.prepared = true;
    this.stage = "prepare";
    this.boundary(); // Synchronous capture/playback boundary, before any HTTP await.
    try {
      const result = await this.options.request(`/sessions/${this.session!.sessionId}/prepare`, { acknowledge_unproven_tail: true });
      if (this.stopped) return false;
      if (result.phase !== "proposed" || !result.proposal) throw new Error("No proposal");
      this.options.onPrepared();
      return true;
    } catch { this.failure(); return false; }
  }
  stop(): Promise<void> {
    if (this.stopping) return this.stopping;
    this.stopped = true; clearTimeout(this.timer); this.boundary(); this.options.onStopped();
    this.stopping = Promise.allSettled([
      this.session ? Promise.resolve().then(() => this.options.request(`/sessions/${this.session!.sessionId}/stop`, {})) : Promise.resolve(),
      this.disconnect(),
    ]).then(() => undefined);
    return this.stopping;
  }
}
