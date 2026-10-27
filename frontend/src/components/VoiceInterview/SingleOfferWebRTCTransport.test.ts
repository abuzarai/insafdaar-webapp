import { LogLevel, logger } from "@pipecat-ai/client-js";
import type { SmallWebRTCTransport as TransportType } from "@pipecat-ai/small-webrtc-transport";
// The bundled media library creates worklet URLs at import time; jsdom has no
// implementation. Supply only this browser primitive before loading the SDK.
Object.defineProperty(URL, "createObjectURL", { configurable: true, value: () => "blob:offline-worklet" });
Object.defineProperty(HTMLCanvasElement.prototype, "getContext", { configurable: true, value: () => null });
const { SmallWebRTCTransport } = require("@pipecat-ai/small-webrtc-transport") as typeof import("@pipecat-ai/small-webrtc-transport");
const { SingleOfferWebRTCTransport } = require("./SingleOfferWebRTCTransport") as typeof import("./SingleOfferWebRTCTransport");

// The SDK and its connect/negotiate/retry/teardown methods are REAL. Only browser
// peer/media primitives and HTTP are mocked; no provider or device is contacted.
class FakeChannel extends EventTarget {
  readyState = "connecting";
  send = jest.fn();
  open() { this.readyState = "open"; this.dispatchEvent(new Event("open")); }
  close() { this.readyState = "closed"; this.dispatchEvent(new Event("close")); }
}
class FakePeer extends EventTarget {
  static instances: FakePeer[] = [];
  iceConnectionState = "new";
  iceGatheringState = "complete";
  signalingState = "stable";
  localDescription: any;
  channel = new FakeChannel();
  transceivers: any[] = [];
  onicecandidate?: (event: any) => Promise<void>;
  constructor() { super(); FakePeer.instances.push(this); }
  createDataChannel() { return this.channel; }
  addTransceiver() {
    const sender = { track: undefined, replaceTrack: jest.fn(async () => {}) };
    this.transceivers.push({ sender, stop: jest.fn() });
  }
  getTransceivers() { return this.transceivers; }
  getSenders() { return this.transceivers.map(t => t.sender); }
  createOffer = jest.fn(async () => ({ type: "offer", sdp: "offline-offer" }));
  setLocalDescription = jest.fn(async value => { this.localDescription = value; });
  setRemoteDescription = jest.fn(async () => {});
  close = jest.fn(() => { this.iceConnectionState = "closed"; });
}
const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
const endpoint = () => new Request("https://offline.invalid/intake/sessions/test/webrtc/offer", { method: "POST" });
let transport: TransportType, fetchMock: jest.Mock, blocked: jest.Mock, disconnected: jest.Mock;
let stopPromise: Promise<void> | undefined;
const media = () => ({
  setClientOptions: jest.fn(), connect: jest.fn(async () => {}), disconnect: jest.fn(async () => {}),
  tracks: () => ({ local: {} }), supportsScreenShare: false, isMicEnabled: true, isCamEnabled: false,
});
const initialize = (guarded = true) => {
  const options = { iceServers: [], waitForICEGathering: true, mediaManager: media() as any };
  blocked = jest.fn(() => { stopPromise = transport.disconnect(); });
  transport = guarded ? new SingleOfferWebRTCTransport(blocked, options) : new SmallWebRTCTransport(options);
  disconnected = jest.fn();
  transport.initialize({ transport, callbacks: { onDisconnected: disconnected } }, jest.fn());
  // Attach rejection handling immediately; SDK stop can reject while negotiating.
  return transport.connect({ webrtcRequestParams: { endpoint: endpoint() } }).then(() => "connected", () => "failed");
};
const offers = () => fetchMock.mock.calls.filter(([input, init]) => (init?.method || input.method) === "POST");
beforeEach(() => {
  jest.useFakeTimers(); logger.setLevel(LogLevel.NONE); FakePeer.instances = []; stopPromise = undefined;
  Object.defineProperty(global, "RTCPeerConnection", { configurable: true, value: FakePeer });
  fetchMock = jest.fn(async () => new Response(JSON.stringify({ type: "answer", sdp: "offline-answer", pc_id: "test-peer" }), { status: 200 }));
  global.fetch = fetchMock;
});
afterEach(async () => { await transport?.disconnect(); await stopPromise; jest.useRealTimers(); });

test("control: real default SDK retries a lost initial offer after its timer", async () => {
  fetchMock.mockRejectedValue(new TypeError("Lost response"));
  const connecting = initialize(false); await flush(); expect(offers()).toHaveLength(1);
  jest.advanceTimersByTime(2001); await flush();
  expect(offers()).toHaveLength(2); expect(FakePeer.instances).toHaveLength(2);
  await transport.disconnect(); await connecting;
});

test.each(["rejected", "lost", "5xx"])("real SDK %s initial offer cannot emit another offer after retry timers", async outcome => {
  fetchMock.mockImplementation(async () => {
    if (outcome === "lost") throw new TypeError("Lost response");
    return new Response(null, { status: outcome === "rejected" ? 422 : 503 });
  });
  const connecting = initialize(); await flush(); expect(offers()).toHaveLength(1);
  jest.advanceTimersByTime(2001); await flush();
  jest.advanceTimersByTime(60000); await flush();
  await connecting; await stopPromise;
  expect(offers()).toHaveLength(1); expect(FakePeer.instances).toHaveLength(1);
  expect(FakePeer.instances[0].close).toHaveBeenCalled(); expect(disconnected).toHaveBeenCalled();
  if (outcome !== "rejected") expect(blocked).toHaveBeenCalledTimes(1);
  expect(fetchMock.mock.calls[0][0].method).toBe("POST");
  expect(await fetchMock.mock.calls[0][0].json()).toEqual({ sdp: "offline-offer", type: "offer", pc_id: null, restart_pc: false });
});

test.each(["failed", "disconnected", "gathering", "server renegotiate"])("real SDK %s reconnection path stops without another offer", async event => {
  const connecting = initialize(); await flush();
  const peer = FakePeer.instances[0]; peer.channel.open(); await connecting;
  expect(transport.state).toBe("connected");
  if (event === "server renegotiate") {
    peer.channel.dispatchEvent(new MessageEvent("message", { data: JSON.stringify({ type: "signalling", message: { type: "renegotiate" } }) }));
  } else if (event === "gathering") {
    peer.iceConnectionState = "checking"; peer.dispatchEvent(new Event("icegatheringstatechange"));
  } else {
    peer.iceConnectionState = event; peer.dispatchEvent(new Event("iceconnectionstatechange"));
  }
  jest.advanceTimersByTime(5001); await flush();
  jest.advanceTimersByTime(60000); await flush(); await stopPromise;
  expect(blocked).toHaveBeenCalledTimes(1); expect(offers()).toHaveLength(1);
  expect(FakePeer.instances).toHaveLength(1); expect(peer.close).toHaveBeenCalled();
  expect(transport.state).toBe("disconnected");
});

test("normal initial connection, candidate PATCH and explicit Stop still use the real SDK", async () => {
  const connecting = initialize(); await flush(); const peer = FakePeer.instances[0];
  peer.channel.open(); await connecting;
  await peer.onicecandidate?.({ candidate: { candidate: "offline-candidate", sdpMid: "0", sdpMLineIndex: 0 } });
  jest.advanceTimersByTime(201); await flush();
  expect(offers()).toHaveLength(1);
  const patch = fetchMock.mock.calls.find(([, init]) => init?.method === "PATCH");
  expect(patch).toBeDefined(); expect(JSON.parse(patch![1].body)).toEqual({ pc_id: "test-peer", candidates: [{ candidate: "offline-candidate", sdp_mid: "0", sdp_mline_index: 0 }] });
  await transport.disconnect(); jest.advanceTimersByTime(60000); await flush();
  expect(blocked).not.toHaveBeenCalled(); expect(peer.close).toHaveBeenCalled(); expect(offers()).toHaveLength(1);
});

test("missing pinned retry seam fails closed instead of constructing the default transport", () => {
  const prototype = SmallWebRTCTransport.prototype as any, original = prototype.attemptReconnection;
  try {
    prototype.attemptReconnection = undefined;
    expect(() => new SingleOfferWebRTCTransport(jest.fn(), { iceServers: [] })).toThrow("Unsupported single-offer transport");
  } finally { prototype.attemptReconnection = original; }
});

test("explicit Stop before the failed-offer retry timer makes that timer inert", async () => {
  fetchMock.mockRejectedValue(new TypeError("Lost response"));
  const connecting = initialize(); await flush(); expect(offers()).toHaveLength(1);
  await transport.disconnect(); await connecting;
  jest.advanceTimersByTime(60000); await flush();
  expect(offers()).toHaveLength(1); expect(blocked).not.toHaveBeenCalled(); expect(FakePeer.instances).toHaveLength(1);
});

test("real pinned transport framing reaches real client onServerMessage callback", async () => {
  const { PipecatClient } = require("@pipecat-ai/client-js") as typeof import("@pipecat-ai/client-js");
  const onServerMessage = jest.fn();
  transport = new SingleOfferWebRTCTransport(jest.fn(), { iceServers: [], mediaManager: media() as any });
  const client = new PipecatClient({ transport, callbacks: { onServerMessage } });
  expect(client).toBeDefined();
  const data = { type: "interview_finished", sessionId: "non-secret-session" };
  (transport as any).handleMessage(JSON.stringify({ label: "rtvi-ai", type: "server-message", id: "opaque-event", data }));
  await flush();
  expect(onServerMessage).toHaveBeenCalledTimes(1);
  expect(onServerMessage).toHaveBeenCalledWith(data);
});
