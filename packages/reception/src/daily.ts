import Daily, {
  type DailyCall,
  type DailyEventObjectAppMessage,
  type DailyEventObjectTrack,
} from "@daily-co/daily-js";
import type { AppConfig } from "@reception/shared";

export type TalkRequestMessage = { type: "talk-request" };
export type TalkEndMessage = { type: "talk-end" };
export type SwitchCameraMessage = { type: "switch-camera" };
type SignalMessage = TalkRequestMessage | TalkEndMessage | SwitchCameraMessage;

/**
 * Deterministic default ntfy.sh topic derived from the room URL, so any
 * deployment gets a working, collision-resistant doorbell-push topic for
 * free just by having its own unique Daily room (which it already needs) --
 * no separate "remember to generate a random topic" step for whoever else
 * ends up deploying a copy of this app.
 */
async function deriveNtfyTopic(roomUrl: string): Promise<string> {
  const bytes = new TextEncoder().encode(roomUrl);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `reception-monitor-${hex.slice(0, 16)}`;
}

function isSignalMessage(data: unknown): data is SignalMessage {
  return (
    typeof data === "object" &&
    data !== null &&
    "type" in data &&
    ((data as { type: unknown }).type === "talk-request" ||
      (data as { type: unknown }).type === "talk-end" ||
      (data as { type: unknown }).type === "switch-camera")
  );
}

export class ReceptionRoom {
  private call: DailyCall | null = null;
  private talkSessionTimer: ReturnType<typeof setTimeout> | null = null;
  // Ambient-mode-only; talk sessions always use the front camera regardless
  // of this, so switching cameras mid-conversation isn't a concern.
  private ambientFacingMode: "user" | "environment" = "user";

  constructor(
    private config: AppConfig,
    private onCameraError?: (error: unknown) => void,
    private onLocalVideoTrack?: (track: MediaStreamTrack | null) => void,
    private onRemoteAudioTrack?: (track: MediaStreamTrack | null) => void,
    private onRemoteVideoTrack?: (track: MediaStreamTrack | null) => void,
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
      // Requested at acquisition time, not just via a later
      // updateInputSettings() call -- many browsers/WebViews only actually
      // apply echoCancellation etc. when the mic is first grabbed, and
      // silently ignore a later constraint change on an already-live track.
      // This is the device whose own speaker plays the viewer's voice back
      // out loud, so it's the one that most needs its own mic's AEC
      // referencing that output correctly.
      inputSettings: {
        audio: { settings: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } },
      },
    });
    call.on("app-message", this.handleAppMessage);
    call.on("camera-error", this.handleCameraError);
    call.on("track-started", this.handleLocalTrackStarted);
    call.on("track-stopped", this.handleLocalTrackStopped);
    call.on("track-started", this.handleRemoteTrackStarted);
    call.on("track-stopped", this.handleRemoteTrackStopped);

    try {
      // startAudioOff/startVideoOff are accepted independently by both
      // createCallObject() and join() -- setting them only at creation
      // left the local video track sitting at state "off" after join()
      // (confirmed via the post-join track-state log below), so set them
      // at both call sites.
      await call.join({
        url: this.config.room.roomUrl,
        startAudioOff: true,
        startVideoOff: false,
        inputSettings: {
          audio: { settings: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } },
        },
      });
    } catch (err) {
      // Don't leave `this.call` pointing at a call object that never
      // actually joined — that would make isJoined true and stop the
      // schedule loop from ever retrying.
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
    await this.applyAmbientQuality();

    // Belt-and-suspenders: force video on explicitly in case join()'s
    // startVideoOff isn't enough on its own either.
    call.setLocalVideo(true);

    const localVideo = call.participants().local?.tracks?.video;
    console.log(
      "[reception] post-join local video track state:",
      localVideo?.state,
      "off reason:",
      (localVideo as { off?: { reason?: string } } | undefined)?.off?.reason,
    );
  }

  /** Leaves the room and fully releases the camera/mic. */
  async leave(): Promise<void> {
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

  private handleAppMessage = (event?: DailyEventObjectAppMessage) => {
    if (!event || !isSignalMessage(event.data)) return;
    if (event.data.type === "talk-request") {
      void this.startTalkSession();
    } else if (event.data.type === "talk-end") {
      void this.endTalkSession();
    } else if (event.data.type === "switch-camera") {
      void this.switchAmbientCamera();
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
    // Confirms whether the requested audio constraints actually landed on
    // the live track -- some browsers/WebViews silently ignore constraints
    // they don't support, so this is the only way to know for sure rather
    // than assuming the request succeeded.
    if (event?.participant?.local && event.track.kind === "audio") {
      console.log("[reception] local audio track settings:", event.track.getSettings());
    }
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
    // Defaults to "user" (front/selfie camera) so the tablet faces whoever
    // walks up to the desk; switchAmbientCamera() can flip it to
    // "environment" for a quick look around the room.
    await this.call.updateInputSettings({
      video: { settings: { width, height, frameRate, facingMode: this.ambientFacingMode } },
    });
  }

  private async applyTalkQuality(): Promise<void> {
    if (!this.call) return;
    const { width, height, frameRate } = this.config.video.talk;
    // Always front camera for talk sessions regardless of the ambient
    // facing mode -- the point is showing whoever's at the desk to Garry.
    // Audio constraints are set explicitly here too: this is the device
    // whose own speaker output (playing the viewer's voice) can re-enter
    // its own mic and echo back to the viewer -- echoCancellation is what
    // actually cancels that loop, so it's worth forcing on rather than
    // trusting the platform default.
    await this.call.updateInputSettings({
      video: { settings: { width, height, frameRate, facingMode: "user" } },
      audio: { settings: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } },
    });
  }

  /** Flips the ambient camera between front/back. Only meaningful outside a talk session. */
  private async switchAmbientCamera(): Promise<void> {
    this.ambientFacingMode = this.ambientFacingMode === "user" ? "environment" : "user";
    await this.applyAmbientQuality();
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

  /**
   * Called when a visitor presses the on-screen doorbell button. Signals
   * any viewer currently connected to the room (in-page beep/flash, only
   * reaches an already-open viewer), and separately fires a real OS push
   * via ntfy.sh so it still reaches Garry's phone if the viewer page is
   * closed or minimized -- no server of our own involved either way.
   */
  ringDoorbell(): void {
    this.call?.sendAppMessage({ type: "doorbell" }, "*");
    void this.sendNtfyPush();
  }

  private async sendNtfyPush(): Promise<void> {
    const push = this.config.doorbellPush;
    if (!push) return;
    const topic = push.ntfyTopic ?? (await deriveNtfyTopic(this.config.room.roomUrl));
    const baseUrl = push.ntfyBaseUrl ?? "https://ntfy.sh";
    try {
      await fetch(`${baseUrl}/${topic}`, {
        method: "POST",
        body: "Someone is at reception.",
        headers: {
          Title: "SET Reception",
          Priority: "urgent",
          Tags: "bellhop_bell",
          ...(push.clickUrl ? { Click: push.clickUrl } : {}),
        },
      });
    } catch (err) {
      // Best-effort -- a failed push shouldn't block the in-room signal above.
      console.warn("[reception] ntfy push failed:", err);
    }
  }
}
