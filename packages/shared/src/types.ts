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

export interface DoorbellPushConfig {
  /**
   * ntfy.sh topic the tablet posts to on doorbell press. Optional -- if
   * omitted, it's derived automatically from `room.roomUrl`, so a fresh
   * deployment gets a working, collision-resistant topic for free just by
   * having its own unique room URL (which it already needs). Set this
   * explicitly to pick a memorable name instead, or to rotate it
   * independently of the room URL.
   */
  ntfyTopic?: string;
  /** Defaults to https://ntfy.sh; override only if self-hosting ntfy. */
  ntfyBaseUrl?: string;
  /** Opened when the push notification itself is tapped -- typically the viewer page. */
  clickUrl?: string;
}

export interface AppConfig {
  room: RoomConfig;
  schedule: ScheduleConfig;
  video: VideoQualityConfig;
  /**
   * Safety-net: if a talk session doesn't receive an explicit end signal
   * within this many seconds, the reception app drops back to ambient mode.
   */
  talkSessionTimeoutSeconds: number;
  /** Optional: reaches Garry's phone via a real OS push even if the viewer page is closed/minimized. */
  doorbellPush?: DoorbellPushConfig;
}
