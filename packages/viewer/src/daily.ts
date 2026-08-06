import Daily, { type DailyCall } from "@daily-co/daily-js";

export class ViewerRoom {
  private call: DailyCall | null = null;

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
  }

  /** Publishes the viewer's mic (and front camera) and signals the reception tablet to unmute + upgrade quality. */
  async startTalk(withVideo: boolean): Promise<void> {
    if (!this.call) return;
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

  /**
   * Asks the reception tablet to turn its ambient video on outside its
   * normal scheduled hours. The tablet stays connected to the room 24/7
   * specifically so this reaches it instantly, with no server involved.
   */
  checkIn(): void {
    this.call?.sendAppMessage({ type: "wake-request" }, "*");
  }
}
