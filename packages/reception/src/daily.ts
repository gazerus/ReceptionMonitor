import Daily, { type DailyCall, type DailyEventObjectAppMessage } from "@daily-co/daily-js";
import type { AppConfig } from "@reception/shared";

export type TalkRequestMessage = { type: "talk-request" };
export type TalkEndMessage = { type: "talk-end" };
type SignalMessage = TalkRequestMessage | TalkEndMessage;

function isSignalMessage(data: unknown): data is SignalMessage {
  return (
    typeof data === "object" &&
    data !== null &&
    "type" in data &&
    ((data as { type: unknown }).type === "talk-request" ||
      (data as { type: unknown }).type === "talk-end")
  );
}

export class ReceptionRoom {
  private call: DailyCall | null = null;
  private talkSessionTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private config: AppConfig,
    private onCameraError?: (error: unknown) => void,
  ) {}

  updateConfig(config: AppConfig) {
    this.config = config;
  }

  get isJoined(): boolean {
    return this.call !== null;
  }

  /** Joins the fixed room and publishes a video-only, low-res ambient track. No mic. */
  async joinAmbient(): Promise<void> {
    if (this.call) return;

    const call = Daily.createCallObject({
      // The mic device is acquired but kept muted so a talk request can
      // unmute instantly with no renegotiation delay.
      startAudioOff: true,
      startVideoOff: false,
    });
    call.on("app-message", this.handleAppMessage);
    call.on("camera-error", this.handleCameraError);

    try {
      await call.join({ url: this.config.room.roomUrl });
    } catch (err) {
      // Don't leave `this.call` pointing at a call object that never
      // actually joined — that would make isJoined true and stop the
      // schedule loop from ever retrying.
      call.off("app-message", this.handleAppMessage);
      call.off("camera-error", this.handleCameraError);
      call.destroy();
      throw err;
    }

    this.call = call;
    await this.applyAmbientQuality();
  }

  /** Leaves the room and fully releases the camera/mic. */
  async leave(): Promise<void> {
    if (!this.call) return;
    this.clearTalkTimeout();
    this.call.off("app-message", this.handleAppMessage);
    this.call.off("camera-error", this.handleCameraError);
    await this.call.leave();
    this.call.destroy();
    this.call = null;
  }

  private handleAppMessage = (event?: DailyEventObjectAppMessage) => {
    if (!event || !isSignalMessage(event.data)) return;
    if (event.data.type === "talk-request") {
      void this.startTalkSession();
    } else if (event.data.type === "talk-end") {
      void this.endTalkSession();
    }
  };

  // Daily doesn't fail join() over a camera/mic acquisition problem — it
  // just joins without that track and emits this instead. Without
  // surfacing it, the app would sit on "Monitoring active" while silently
  // publishing no video, with nothing on the tablet or in the viewer
  // hinting at why — exactly the failure mode an unattended kiosk device
  // most needs to avoid.
  private handleCameraError = (event?: unknown) => {
    this.onCameraError?.(event);
  };

  private async applyAmbientQuality(): Promise<void> {
    if (!this.call) return;
    const { width, height, frameRate } = this.config.video.ambient;
    await this.call.setBandwidth({ trackConstraints: { width, height, frameRate } });
  }

  private async applyTalkQuality(): Promise<void> {
    if (!this.call) return;
    const { width, height, frameRate } = this.config.video.talk;
    await this.call.setBandwidth({ trackConstraints: { width, height, frameRate } });
  }

  /** Un-mutes the mic and bumps video quality for the duration of the exchange. */
  async startTalkSession(): Promise<void> {
    if (!this.call) return;
    await this.applyTalkQuality();
    this.call.setLocalAudio(true);

    this.clearTalkTimeout();
    this.talkSessionTimer = setTimeout(() => {
      void this.endTalkSession();
    }, this.config.talkSessionTimeoutSeconds * 1000);
  }

  /** Drops back to ambient: mic off, low-res video. */
  async endTalkSession(): Promise<void> {
    if (!this.call) return;
    this.clearTalkTimeout();
    this.call.setLocalAudio(false);
    await this.applyAmbientQuality();
  }

  private clearTalkTimeout(): void {
    if (this.talkSessionTimer) {
      clearTimeout(this.talkSessionTimer);
      this.talkSessionTimer = null;
    }
  }
}
