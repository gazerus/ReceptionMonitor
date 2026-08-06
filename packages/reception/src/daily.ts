import Daily, {
  type DailyCall,
  type DailyEventObjectAppMessage,
  type DailyEventObjectTrack,
} from "@daily-co/daily-js";
import type { AppConfig } from "@reception/shared";

export type TalkRequestMessage = { type: "talk-request" };
export type TalkEndMessage = { type: "talk-end" };
export type WakeRequestMessage = { type: "wake-request" };
type SignalMessage = TalkRequestMessage | TalkEndMessage | WakeRequestMessage;

function isSignalMessage(data: unknown): data is SignalMessage {
  return (
    typeof data === "object" &&
    data !== null &&
    "type" in data &&
    ((data as { type: unknown }).type === "talk-request" ||
      (data as { type: unknown }).type === "talk-end" ||
      (data as { type: unknown }).type === "wake-request")
  );
}

export class ReceptionRoom {
  private call: DailyCall | null = null;
  private talkSessionTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private config: AppConfig,
    private onCameraError?: (error: unknown) => void,
    private onLocalVideoTrack?: (track: MediaStreamTrack | null) => void,
    private onRemoteAudioTrack?: (track: MediaStreamTrack | null) => void,
    private onRemoteVideoTrack?: (track: MediaStreamTrack | null) => void,
    private onWakeRequested?: () => void,
  ) {}

  updateConfig(config: AppConfig) {
    this.config = config;
  }

  get isConnected(): boolean {
    return this.call !== null;
  }

  /**
   * Joins the fixed room once and stays joined indefinitely, video and mic
   * both off to start. Video/mic are toggled separately via
   * setVideoPublishing()/startTalkSession() -- staying connected 24/7 (not
   * just during scheduled hours) is what lets an out-of-hours "Check in"
   * request from the viewer reach the tablet instantly over the same Daily
   * connection, with no polling or server component needed.
   */
  async connect(): Promise<void> {
    if (this.call) return;

    const call = Daily.createCallObject({
      startAudioOff: true,
      startVideoOff: true,
    });
    call.on("app-message", this.handleAppMessage);
    call.on("camera-error", this.handleCameraError);
    call.on("track-started", this.handleLocalTrackStarted);
    call.on("track-stopped", this.handleLocalTrackStopped);
    call.on("track-started", this.handleRemoteTrackStarted);
    call.on("track-stopped", this.handleRemoteTrackStopped);

    try {
      await call.join({
        url: this.config.room.roomUrl,
        startAudioOff: true,
        startVideoOff: true,
      });
    } catch (err) {
      call.off("app-message", this.handleAppMessage);
      call.off("camera-error", this.handleCameraError);
      call.off("track-started", this.handleLocalTrackStarted);
      call.off("track-stopped", this.handleLocalTrackStopped);
      call.off("track-started", this.handleRemoteTrackStarted);
      call.off("track-stopped", this.handleRemoteTrackStopped);
      call.destroy();
      throw err;
    }

    this.call = call;
  }

  /** Fully disconnects -- only meant for app teardown, not the schedule loop. */
  async disconnect(): Promise<void> {
    if (!this.call) return;
    this.clearTalkTimeout();
    this.call.off("app-message", this.handleAppMessage);
    this.call.off("camera-error", this.handleCameraError);
    this.call.off("track-started", this.handleLocalTrackStarted);
    this.call.off("track-stopped", this.handleLocalTrackStopped);
    this.call.off("track-started", this.handleRemoteTrackStarted);
    this.call.off("track-stopped", this.handleRemoteTrackStopped);
    await this.call.leave();
    this.call.destroy();
    this.call = null;
  }

  /** Turns the ambient video feed on or off without touching the room connection itself. */
  async setVideoPublishing(enabled: boolean): Promise<void> {
    if (!this.call) return;
    if (enabled) {
      await this.applyAmbientQuality();
      this.call.setLocalVideo(true);

      const localVideo = this.call.participants().local?.tracks?.video;
      console.log(
        "[reception] local video track state after enabling:",
        localVideo?.state,
        "off reason:",
        (localVideo as { off?: { reason?: string } } | undefined)?.off?.reason,
      );
    } else {
      this.call.setLocalVideo(false);
    }
  }

  private handleAppMessage = (event?: DailyEventObjectAppMessage) => {
    if (!event || !isSignalMessage(event.data)) return;
    if (event.data.type === "talk-request") {
      void this.startTalkSession();
    } else if (event.data.type === "talk-end") {
      void this.endTalkSession();
    } else if (event.data.type === "wake-request") {
      this.onWakeRequested?.();
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

  // Surfaces the local camera track (if any) so App.tsx can render a small
  // self-preview -- the only way to see, from the tablet itself, whether
  // the camera is actually producing frames rather than just having
  // "joined" successfully with a dead or black track.
  private handleLocalTrackStarted = (event?: DailyEventObjectTrack) => {
    console.log(
      "[reception] track-started: local=",
      event?.participant?.local,
      "kind=",
      event?.track?.kind,
      "readyState=",
      event?.track?.readyState,
    );
    if (!event?.participant?.local || event.track.kind !== "video") return;
    this.onLocalVideoTrack?.(event.track);
  };

  private handleLocalTrackStopped = (event?: DailyEventObjectTrack) => {
    console.log(
      "[reception] track-stopped: local=",
      event?.participant?.local,
      "kind=",
      event?.track?.kind,
    );
    if (!event?.participant?.local || event.track.kind !== "video") return;
    this.onLocalVideoTrack?.(null);
  };

  // Daily's call-object mode auto-subscribes to remote tracks by default,
  // but subscribing isn't the same as playing: nothing attaches the
  // viewer's incoming mic audio (or, during a talk session, video) to an
  // actual media element unless we do it ourselves.
  private handleRemoteTrackStarted = (event?: DailyEventObjectTrack) => {
    if (event?.participant?.local) return;
    if (event?.track?.kind === "audio") this.onRemoteAudioTrack?.(event.track);
    else if (event?.track?.kind === "video") this.onRemoteVideoTrack?.(event.track);
  };

  private handleRemoteTrackStopped = (event?: DailyEventObjectTrack) => {
    if (event?.participant?.local) return;
    if (event?.track?.kind === "audio") this.onRemoteAudioTrack?.(null);
    else if (event?.track?.kind === "video") this.onRemoteVideoTrack?.(null);
  };

  private async applyAmbientQuality(): Promise<void> {
    if (!this.call) return;
    const { width, height, frameRate } = this.config.video.ambient;
    // facingMode "user" (front/selfie camera) so the tablet faces whoever
    // walks up to the desk, rather than whatever the rear camera happens
    // to point at.
    await this.call.updateInputSettings({
      video: { settings: { width, height, frameRate, facingMode: "user" } },
    });
  }

  private async applyTalkQuality(): Promise<void> {
    if (!this.call) return;
    const { width, height, frameRate } = this.config.video.talk;
    await this.call.updateInputSettings({
      video: { settings: { width, height, frameRate, facingMode: "user" } },
    });
  }

  /**
   * Un-mutes the mic and bumps video quality for the duration of the
   * exchange. Also forces video on regardless of current publishing state,
   * in case a talk request arrives while the tablet is idle outside
   * scheduled hours without a prior Check in.
   */
  async startTalkSession(): Promise<void> {
    if (!this.call) return;
    await this.applyTalkQuality();
    this.call.setLocalVideo(true);
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

  /**
   * Called when a visitor presses the on-screen doorbell button. Signals
   * any viewer currently connected to the room -- only reaches Garry if the
   * viewer page happens to be open, by design: no server-side push
   * infrastructure to stand up or maintain for this.
   */
  ringDoorbell(): void {
    this.call?.sendAppMessage({ type: "doorbell" }, "*");
  }
}
