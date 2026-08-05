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

  constructor(private config: AppConfig) {}

  updateConfig(config: AppConfig) {
    this.config = config;
  }

  get isJoined(): boolean {
    return this.call !== null;
  }

  /** Joins the fixed room and publishes a video-only, low-res ambient track. No mic. */
  async joinAmbient(): Promise<void> {
    if (this.call) return;

    this.call = Daily.createCallObject({
      // The mic device is acquired but kept muted so a talk request can
      // unmute instantly with no renegotiation delay.
      startAudioOff: true,
      startVideoOff: false,
    });

    this.call.on("app-message", this.handleAppMessage);

    await this.call.join({ url: this.config.room.roomUrl });
    await this.applyAmbientQuality();
  }

  /** Leaves the room and fully releases the camera/mic. */
  async leave(): Promise<void> {
    if (!this.call) return;
    this.clearTalkTimeout();
    this.call.off("app-message", this.handleAppMessage);
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
