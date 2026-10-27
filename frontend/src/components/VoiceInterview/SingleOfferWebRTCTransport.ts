import { SmallWebRTCTransport, SmallWebRTCTransportConstructorOptions } from "@pipecat-ai/small-webrtc-transport";

type RetryInternals = { attemptReconnection?: unknown; negotiate?: unknown; stop?: unknown };

// Pinned to small-webrtc-transport 1.10.8's INTERNAL retry seam (not a public SDK
// option). Failed offers, ICE restarts and server renegotiation all enter here.
// Fail closed if that shape changes; never fall back to the retrying default.
export class SingleOfferWebRTCTransport extends SmallWebRTCTransport {
  constructor(private readonly onReconnectBlocked: () => void, options: SmallWebRTCTransportConstructorOptions) {
    const internals = SmallWebRTCTransport.prototype as unknown as RetryInternals;
    if (![internals.attemptReconnection, internals.negotiate, internals.stop].every(method => typeof method === "function")) {
      throw new Error("Unsupported single-offer transport");
    }
    super(options);
  }

  async attemptReconnection(): Promise<void> {
    if (this._abortController?.signal.aborted) return;
    // The owner synchronously suppresses capture/playback and starts its bounded
    // disconnect/Stop path. Do not invoke the SDK's reconnect or negotiate code.
    this.onReconnectBlocked();
  }
}
