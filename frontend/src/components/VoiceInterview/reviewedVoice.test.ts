import { ReviewedVoice } from "./reviewedVoice";
const mockClients: any[] = [], mockTransports: any[] = [];
let mockMic: any, mockDaily: any, mockForeign: any, mockInit: () => Promise<void>;
jest.mock("@daily-co/daily-js", () => ({ __esModule: true, default: {
  getCallInstance: () => mockForeign, createCallObject: (config: any) => { mockDaily.config = config; return mockDaily; },
} }));
// Lifecycle/callback tests only. The real pinned SDK retry paths are exercised
// separately in SingleOfferWebRTCTransport.test.ts without mocking connect().
jest.mock("./SingleOfferWebRTCTransport", () => ({ SingleOfferWebRTCTransport: class {
  constructor(onReconnectBlocked: () => void) { mockTransports.push({ onReconnectBlocked }); }
} }));
jest.mock("@pipecat-ai/client-js", () => ({ LogLevel: { NONE: 0 }, logger: { setLevel: jest.fn() },
  PipecatClient: class {
    callbacks: any; tracks = () => ({ local: { audio: mockMic }, bot: {} });
    enableMic = jest.fn(); setLogLevel = jest.fn();
    initDevices = jest.fn(() => mockInit()); connect = jest.fn(() => new Promise(() => {}));
    disconnect = jest.fn(async () => {});
    constructor(options: any) { this.callbacks = options.callbacks; mockClients.push(this); }
  },
}));
const track = () => ({ kind: "audio", readyState: "live", enabled: true, stop: jest.fn() });
const tick = async () => { await Promise.resolve(); await Promise.resolve(); };
let options: any, call: ReviewedVoice;
beforeEach(() => {
  mockClients.length = 0; mockTransports.length = 0; mockForeign = undefined; mockMic = track(); mockInit = async () => {};
  mockDaily = { load: jest.fn(async () => {}), destroy: jest.fn(async () => {}) };
  Object.defineProperty(global, "MediaStream", { configurable: true, value: class { constructor(public tracks: any) {} } });
  options = {
    audio: { pause: jest.fn(), muted: false, srcObject: {}, play: jest.fn(async () => {}) },
    admit: jest.fn(async () => ({ sessionId: "fictional", caseVersion: 1, expiresAt: new Date(Date.now() + 300000).toISOString() })),
    request: jest.fn(async () => ({ phase: "proposed", proposal: {} })),
    offer: jest.fn(() => ({ endpoint: "/cases/101/intake/sessions/fictional/webrtc/offer", headers: new Headers() })),
    onAdmitted: jest.fn(), onConnected: jest.fn(), onPrepared: jest.fn(), onStopped: jest.fn(),
    onFailure: jest.fn(), onPlaybackBlocked: jest.fn(),
  };
  call = new ReviewedVoice(options);
});
afterEach(async () => { await call.stop(); jest.useRealTimers(); });

test("public onConnected gates readiness, not unresolved bot-ready connect promise", async () => {
  await call.start(); expect(mockClients).toHaveLength(1); expect(options.onConnected).not.toHaveBeenCalled();
  mockClients[0].callbacks.onConnected(); mockClients[0].callbacks.onConnected();
  expect(options.onConnected).toHaveBeenCalledTimes(1);
  await call.start(); expect(options.admit).toHaveBeenCalledTimes(1);
  expect(mockDaily.load).toHaveBeenCalledTimes(1); expect(mockClients[0].connect).toHaveBeenCalledTimes(1);
  expect(mockDaily.config.dailyConfig).toEqual({ avoidEval: true, bundlePathOverride: `${window.location.origin}/vendor/daily/0.90.0` });
});

test("rate rejection is distinguished from media failure without retrying admission", async () => {
  options.admit.mockRejectedValueOnce(new Error("LIVE_ADMISSION_RATE_LIMITED"));
  await call.start();
  expect(options.onFailure).toHaveBeenCalledWith("admission", "LIVE_ADMISSION_RATE_LIMITED");
  expect(mockDaily.load).not.toHaveBeenCalled(); expect(mockClients).toHaveLength(0);
  expect(options.admit).toHaveBeenCalledTimes(1);
});

test.each(["INTERVIEW_DAILY_LIMIT", "INTERVIEW_WEEKLY_LIMIT", "INTERVIEW_PLATFORM_LIMIT", "INTERVIEW_ALREADY_ACTIVE", "INTERVIEWS_PAUSED", "NEW_INTERVIEW_CONFIRMATION_REQUIRED"])("%s remains allowlisted without allocating media or retrying", async code => {
  options.admit.mockRejectedValueOnce(new Error(code));
  await call.start(); await call.start();
  expect(options.onFailure).toHaveBeenCalledWith("admission", code);
  expect(options.admit).toHaveBeenCalledTimes(1); expect(mockClients).toHaveLength(0);
  expect(mockDaily.load).not.toHaveBeenCalled(); expect(options.offer).not.toHaveBeenCalled();
});

test("arbitrary admission error text is not shown as a public diagnostic", async () => {
  options.admit.mockRejectedValueOnce(new Error("private-upstream-key-payload"));
  await call.start();
  expect(options.onFailure).toHaveBeenCalledWith("admission", "unavailable");
  expect(options.admit).toHaveBeenCalledTimes(1);
});

test("device failure reports only its stage and safe exception name, without retry", async () => {
  mockInit = async () => { throw new DOMException("fictional-sensitive-message", "NotReadableError"); };
  await call.start();
  expect(options.onFailure).toHaveBeenCalledWith("device-init", "NotReadableError");
  expect(options.offer).not.toHaveBeenCalled();
  expect(options.admit).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(options.onFailure.mock.calls)).not.toContain("fictional-sensitive-message");
});

test("media preload failure hides arbitrary SDK messages", async () => {
  mockDaily.load.mockRejectedValue(new Error("fictional-private-provider-payload"));
  await call.start();
  expect(options.onFailure).toHaveBeenCalledWith("media-preload", "unavailable");
  expect(mockClients).toHaveLength(0);
});

test("Prepare before connection is inert; connected Prepare gates media synchronously and runs once", async () => {
  expect(await call.prepare()).toBe(false); expect(options.request).not.toHaveBeenCalled();
  await call.start(); mockClients[0].callbacks.onConnected();
  const remote = track(); await call.play(remote as unknown as MediaStreamTrack);
  const preparing = call.prepare();
  expect(mockMic.enabled).toBe(false); expect(mockMic.stop).toHaveBeenCalled();
  expect(remote.enabled).toBe(false); expect(options.audio.srcObject).toBe(null); expect(options.audio.muted).toBe(true);
  expect(await preparing).toBe(true); expect(await call.prepare()).toBe(false);
  expect(options.request).toHaveBeenCalledTimes(1);
  expect(options.request).toHaveBeenCalledWith("/sessions/fictional/prepare", { acknowledge_unproven_tail: true });
  expect(options.onPrepared).toHaveBeenCalledTimes(1);
});

test("emergency Stop closes local media before network or SDK cleanup settles", async () => {
  await call.start(); mockClients[0].callbacks.onConnected();
  let resolve!: () => void;
  options.request.mockImplementation(() => new Promise<void>(r => { resolve = r; }));
  const stopping = call.stop();
  expect(mockMic.stop).toHaveBeenCalled(); expect(options.audio.muted).toBe(true);
  expect(options.onStopped).toHaveBeenCalledTimes(1);
  const lateMic = track(); mockClients[0].callbacks.onTrackStarted(lateMic, { local: true });
  expect(lateMic.enabled).toBe(false); expect(lateMic.stop).toHaveBeenCalledTimes(1);
  const lateRemote = track(); mockClients[0].callbacks.onTrackStarted(lateRemote, { local: false });
  expect(lateRemote.enabled).toBe(false);
  await tick(); resolve(); await stopping; await call.stop();
  expect(options.request).toHaveBeenCalledTimes(1); expect(mockDaily.destroy).toHaveBeenCalledTimes(1);
});

test("Stop while admission is in flight never opens devices and stops a late known session", async () => {
  let resolve!: (value: object) => void;
  options.admit.mockImplementation(() => new Promise(r => { resolve = r; }));
  const starting = call.start(); await call.stop();
  resolve({ sessionId: "late", expiresAt: new Date(Date.now() + 100000).toISOString(), caseVersion: 1 });
  await starting;
  expect(mockClients).toHaveLength(0); expect(mockDaily.load).not.toHaveBeenCalled();
  expect(options.request).toHaveBeenCalledWith("/sessions/late/stop", {}); expect(options.onAdmitted).not.toHaveBeenCalled();
});

test("Stop while Prepare is in flight ignores the late proposal", async () => {
  await call.start(); mockClients[0].callbacks.onConnected();
  let resolve!: (value: object) => void;
  options.request.mockImplementation((suffix: string) => suffix.endsWith("/prepare") ? new Promise(r => { resolve = r; }) : Promise.resolve({}));
  const preparing = call.prepare(); await call.stop(); resolve({ phase: "proposed", proposal: {} });
  expect(await preparing).toBe(false); expect(options.onPrepared).not.toHaveBeenCalled();
});

test("expired original deadline stops a connected call", async () => {
  jest.useFakeTimers(); await call.start(); mockClients[0].callbacks.onConnected();
  jest.advanceTimersByTime(300001);
  expect(options.onStopped).toHaveBeenCalledTimes(1); expect(mockMic.stop).toHaveBeenCalled();
});

test("foreign Daily call is not borrowed or destroyed", async () => {
  mockForeign = {}; await call.start(); await tick();
  expect(mockClients).toHaveLength(0); expect(options.onFailure).toHaveBeenCalledTimes(1);
  expect(mockDaily.destroy).not.toHaveBeenCalled();
});

test("admission failure never retries or allocates SDK media", async () => {
  options.admit.mockRejectedValueOnce(new Error("Unknown outcome")); await call.start(); await call.start();
  expect(options.admit).toHaveBeenCalledTimes(1); expect(mockClients).toHaveLength(0);
  expect(options.onFailure).toHaveBeenCalledTimes(1);
});

test("Stop during Daily preload never opens an SDK transport", async () => {
  let resolve!: () => void;
  mockDaily.load.mockImplementation(() => new Promise<void>(r => { resolve = r; }));
  const starting = call.start(); await tick(); expect(mockDaily.load).toHaveBeenCalledTimes(1);
  const stopping = call.stop(); resolve(); await starting; await stopping;
  expect(mockClients).toHaveLength(0); expect(mockDaily.destroy).toHaveBeenCalledTimes(1);
});

test("Stop during device permission wait suppresses a late owned microphone", async () => {
  let resolve!: () => void; mockMic = undefined;
  mockInit = () => new Promise<void>(r => { resolve = r; });
  const starting = call.start();
  for (let i = 0; i < 8; i++) await tick();
  expect(mockClients).toHaveLength(1);
  await call.stop(); mockMic = track(); resolve(); await starting;
  expect(mockMic.enabled).toBe(false); expect(mockMic.stop).toHaveBeenCalled(); expect(mockClients[0].connect).not.toHaveBeenCalled();
});

test("hung SDK disconnect does not prevent owned Daily destruction or receipt recovery", async () => {
  jest.useFakeTimers(); await call.start();
  mockClients[0].disconnect.mockImplementation(() => new Promise(() => {}));
  const stopping = call.stop(); await tick(); jest.advanceTimersByTime(3001); await stopping;
  expect(mockDaily.destroy).toHaveBeenCalledTimes(1); expect(mockMic.stop).toHaveBeenCalled();
});

test("remote playback failure is recoverable without re-admission", async () => {
  await call.start(); options.audio.play.mockRejectedValueOnce(new Error("Gesture required"));
  await call.play(track() as unknown as MediaStreamTrack); expect(options.onPlaybackBlocked).toHaveBeenCalledTimes(1);
  await call.play(); expect(options.audio.play).toHaveBeenCalledTimes(2); expect(options.admit).toHaveBeenCalledTimes(1);
});

test("late rejected playback after Stop cannot offer a resume or reopen audio", async () => {
  await call.start(); mockClients[0].callbacks.onConnected();
  let reject!: (reason: Error) => void;
  options.audio.play.mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; }));
  const remote = track(); const playing = call.play(remote as unknown as MediaStreamTrack);
  await call.stop(); reject(new Error("blocked")); await playing;
  expect(options.onPlaybackBlocked).not.toHaveBeenCalled();
  expect(options.audio.muted).toBe(true); expect(options.audio.srcObject).toBeNull();
  expect(remote.enabled).toBe(false); expect(options.admit).toHaveBeenCalledTimes(1);
});

test("an unknown Prepare outcome returns no proposal and never repeats model work", async () => {
  await call.start(); mockClients[0].callbacks.onConnected();
  options.request.mockImplementation((suffix: string) => suffix.endsWith("/prepare") ? Promise.reject(new TypeError("Lost response")) : Promise.resolve({}));
  expect(await call.prepare()).toBe(false);
  expect(await call.prepare()).toBe(false);
  expect(options.onPrepared).not.toHaveBeenCalled(); expect(options.onFailure).toHaveBeenCalledWith("prepare", "unavailable");
  expect(options.request.mock.calls.filter(([suffix]: [string]) => suffix.endsWith("/prepare"))).toHaveLength(1);
  expect(mockMic.enabled).toBe(false); expect(options.audio.muted).toBe(true);
});

test("blocked SDK reconnect callback synchronously suppresses owned media and stops", async () => {
  await call.start(); mockClients[0].callbacks.onConnected();
  const remote = track(); await call.play(remote as unknown as MediaStreamTrack);
  mockTransports[0].onReconnectBlocked();
  expect(mockMic.enabled).toBe(false); expect(mockMic.stop).toHaveBeenCalled();
  expect(remote.enabled).toBe(false); expect(options.audio.srcObject).toBe(null); expect(options.audio.muted).toBe(true);
  expect(options.onStopped).toHaveBeenCalledTimes(1); expect(options.onFailure).toHaveBeenCalledWith("conversation", "unavailable");
  await tick(); expect(options.request).toHaveBeenCalledWith("/sessions/fictional/stop", {});
  expect(mockClients[0].connect).toHaveBeenCalledTimes(1);
});

test("completion data is exact, session-owned, connected and one-shot", async () => {
  options.onInterviewFinished = jest.fn();
  await call.start();
  const notify = mockClients[0].callbacks.onServerMessage;
  const event = { type: "interview_finished", sessionId: "fictional" };
  notify(event); expect(options.onInterviewFinished).not.toHaveBeenCalled();
  mockClients[0].callbacks.onConnected();
  for (const data of [null, [], {}, { ...event, sessionId: "other" }, { ...event, extra: true }, { ...event, type: "disconnected" }]) notify(data);
  expect(options.onInterviewFinished).not.toHaveBeenCalled();
  notify(event); notify(event);
  expect(options.onInterviewFinished).toHaveBeenCalledTimes(1);
  expect(options.request).not.toHaveBeenCalled();
});

test.each(["stop", "prepare"])("completion after %s cannot initiate workflow", async boundary => {
  options.onInterviewFinished = jest.fn();
  await call.start(); mockClients[0].callbacks.onConnected();
  if (boundary === "stop") await call.stop(); else await call.prepare();
  mockClients[0].callbacks.onServerMessage({ type: "interview_finished", sessionId: "fictional" });
  expect(options.onInterviewFinished).not.toHaveBeenCalled();
});

test("strict transcript callbacks are display-only and stale/duplicate/conflicting events cannot finish or fail voice", async () => {
  options.onTranscript = jest.fn(); options.onInterviewFinished = jest.fn();
  const turn = { type: "transcript_turn", version: 1, sessionId: "fictional", entry: { sequence: 1, speaker: "assistant", text: "اصل <script> text", observed_at: "2026-01-01T00:00:00Z", interrupted: true } };
  await call.start(); const receive = mockClients[0].callbacks.onServerMessage;
  receive(turn); expect(options.onTranscript).not.toHaveBeenCalled();
  mockClients[0].callbacks.onConnected();
  receive({ ...turn, sessionId: "stale" }); receive({ ...turn, version: 2 }); receive({ ...turn, extra: true });
  receive(turn); receive(turn); receive({ ...turn, entry: { ...turn.entry, text: "conflict" } });
  expect(options.onTranscript).toHaveBeenCalledTimes(1);
  expect(options.onTranscript.mock.calls[0][0][0].text).toBe("اصل <script> text");
  expect(options.onFailure).not.toHaveBeenCalled(); expect(options.onInterviewFinished).not.toHaveBeenCalled(); expect(options.request).not.toHaveBeenCalled();
  await call.stop(); receive({ ...turn, entry: { ...turn.entry, sequence: 2 } });
  expect(options.onTranscript).toHaveBeenCalledTimes(1);
});
