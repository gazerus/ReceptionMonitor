/** HH:MM 24-hour, evaluated in `timezone`. */
export type ClockTime = string;

export interface ScheduleConfig {
  /** IANA timezone, e.g. "Australia/Brisbane". */
  timezone: string;
  /** Days of week the schedule applies, 0=Sunday..6=Saturday. Defaults to all 7 if omitted. */
  daysOfWeek?: number[];
  start: ClockTime;
  end: ClockTime;
}

export interface AllowlistConfig {
  /** Email addresses permitted to view the reception feed / issue talk requests. */
  viewers: string[];
}

export interface RoomConfig {
  /** Daily.co room URL, e.g. "https://your-domain.daily.co/reception". */
  roomUrl: string;
}

export interface AmbientVideoConfig {
  width: number;
  height: number;
  frameRate: number;
}

export interface TalkVideoConfig {
  width: number;
  height: number;
  frameRate: number;
}

export interface VideoQualityConfig {
  ambient: AmbientVideoConfig;
  talk: TalkVideoConfig;
}

export interface PushConfig {
  /** Public VAPID key (base64url) used by the viewer to subscribe to push. */
  vapidPublicKey: string;
  /** Endpoint the viewer POSTs its push subscription to, to be stored server-side. */
  subscribeUrl: string;
  /** Endpoint the reception tablet POSTs to when the doorbell is pressed. */
  notifyUrl: string;
  /**
   * Shared secret sent as a header on notifyUrl requests so the endpoint
   * isn't a fully open URL anyone on the internet could hit to spam fake
   * doorbell rings. Not meant to be strong security, just a basic gate --
   * matches the allowlist's "good enough for an internal tool" posture.
   */
  notifySecret: string;
}

export interface AppConfig {
  room: RoomConfig;
  schedule: ScheduleConfig;
  allowlist: AllowlistConfig;
  video: VideoQualityConfig;
  push: PushConfig;
  /**
   * Safety-net: if a talk session doesn't receive an explicit end signal
   * within this many seconds, the reception app drops back to ambient mode.
   */
  talkSessionTimeoutSeconds: number;
}
