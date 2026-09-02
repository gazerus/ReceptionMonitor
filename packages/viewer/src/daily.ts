import Daily, { type DailyCall } from "@daily-co/daily-js";

export class ViewerRoom {
  private call: DailyCall | null = null;
  private audioContext: AudioContext | null = null;
  private micGainNode: GainNode | null = null;
  private rawMicStream: MediaStream | null = null;
  private processedMicTrack: MediaStreamTrack | null = null;
  // Applied to the gain node as soon as it exists; also stored so a slider
  // touched before the first Talk press still takes effect once it does.
  private desiredMicGain = 1;

  get callObject(): DailyCall | null {
    return this.call;
  }

  /** Joins as a subscribe-only participant: no local mic/camera published. */
  async join(roomUrl: string): Promise<DailyCall> {
    if (this.call) return this.call;
    this.call = Daily.createCallObject({
      startAudioOff: true,
      startVideoOff: true,
    });
    await this.call.join({ url: roomUrl });
    return this.call;
  }

  async leave(): Promise<void> {
    if (!this.call) return;
    await this.call.leave();
    this.call.destroy();
    this.call = null;
    this.teardownMicProcessing();
  }

  /**
   * Routes the mic through a Web Audio gain node before Daily sends it, so
   * the on-screen level slider can attenuate it live -- mainly a testing aid
   * for when the tablet and viewer are in the same room and the tablet's own
   * speaker output re-entering its mic causes an audible echo/reverb.
   *
   * Echo cancellation is requested explicitly here rather than left to
   * whatever the browser defaults to -- this is the device whose own
   * speaker output (playing the tablet's/talk audio) can re-enter this same
   * device's mic if it's on loudspeaker rather than earpiece/headphones,
   * which reads as the same kind of feedback even with the two devices far
   * apart, since the loop never leaves this one phone.
   */
  private async ensureMicProcessing(): Promise<MediaStreamTrack> {
    if (this.processedMicTrack) return this.processedMicTrack;
    this.rawMicStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.audioContext = new AudioCtx();
    const source = this.audioContext.createMediaStreamSource(this.rawMicStream);
    this.micGainNode = this.audioContext.createGain();
    this.micGainNode.gain.value = this.desiredMicGain;
    const destination = this.audioContext.createMediaStreamDestination();
    source.connect(this.micGainNode).connect(destination);
    this.processedMicTrack = destination.stream.getAudioTracks()[0];
    return this.processedMicTrack;
  }

  private teardownMicProcessing(): void {
    this.rawMicStream?.getTracks().forEach((t) => t.stop());
    this.processedMicTrack?.stop();
    void this.audioContext?.close();
    this.rawMicStream = null;
    this.processedMicTrack = null;
    this.micGainNode = null;
    this.audioContext = null;
  }

  /** 1 = unity gain, 0 = silent, >1 = boosted. Safe to call any time, before or during a talk session. */
  setMicGain(value: number): void {
    this.desiredMicGain = value;
    if (this.micGainNode) this.micGainNode.gain.value = value;
  }

  /** Publishes the viewer's mic (and front camera) and signals the reception tablet to unmute + upgrade quality. */
  async startTalk(withVideo: boolean): Promise<void> {
    if (!this.call) return;
    const micTrack = await this.ensureMicProcessing();
    await this.call.setInputDevicesAsync({ audioSource: micTrack });
    this.call.setLocalAudio(true);
    if (withVideo) {
      await this.call.updateInputSettings({ video: { settings: { facingMode: "user" } } });
      this.call.setLocalVideo(true);
    }
    this.call.sendAppMessage({ type: "talk-request" }, "*");
  }

  /** Drops the viewer back to view-only and tells the reception tablet the exchange is over. */
  endTalk(): void {
    if (!this.call) return;
    this.call.setLocalAudio(false);
    this.call.setLocalVideo(false);
    this.call.sendAppMessage({ type: "talk-end" }, "*");
  }

  /** Flips the tablet's ambient camera front/back. Only meaningful outside a talk session. */
  switchCamera(): void {
    this.call?.sendAppMessage({ type: "switch-camera" }, "*");
  }
}
