import { useEffect, useRef, useState } from "react";
import type { DailyEventObjectAppMessage, DailyEventObjectTrack } from "@daily-co/daily-js";
import { loadAppConfig, isAllowedViewer, type AppConfig } from "@reception/shared";
import { ViewerRoom } from "./daily";

const CONFIG_URL = import.meta.env.VITE_CONFIG_URL as string | undefined;
const SESSION_KEY = "reception-viewer-email";

// Two short beeps via the Web Audio API -- no asset to ship, and reliable
// regardless of Notification permission/OS sound settings, since this
// only ever needs to work while the page is already open and foreground.
function playDoorbellBeep() {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AudioCtx();
    const beepAt = (startOffset: number) => {
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = 880;
      gain.gain.setValueAtTime(0.35, ctx.currentTime + startOffset);
      oscillator.connect(gain);
      gain.connect(ctx.destination);
      oscillator.start(ctx.currentTime + startOffset);
      oscillator.stop(ctx.currentTime + startOffset + 0.2);
    };
    beepAt(0);
    beepAt(0.3);
  } catch (err) {
    console.warn("[viewer] failed to play doorbell beep:", err);
  }
}

export default function App() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [email, setEmail] = useState(() => sessionStorage.getItem(SESSION_KEY) ?? "");
  const [authorized, setAuthorized] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [talking, setTalking] = useState(false);
  const [remoteAudioActive, setRemoteAudioActive] = useState(false);
  const [doorbellAlert, setDoorbellAlert] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const roomRef = useRef<ViewerRoom | null>(null);
  const streamRef = useRef<MediaStream>(new MediaStream());

  useEffect(() => {
    void loadAppConfig(CONFIG_URL).then(setConfig);
  }, []);

  useEffect(() => {
    if (config && email && isAllowedViewer(email, config.allowlist)) {
      setAuthorized(true);
    }
  }, [config, email]);

  useEffect(() => {
    // Best-effort: lets a doorbell press also fire a real OS-level
    // notification (with its default sound) while this page is open, on
    // top of the in-page beep/flash below. No service worker or server
    // involved -- this only ever shows while the page itself is alive.
    if (authorized && "Notification" in window && Notification.permission === "default") {
      void Notification.requestPermission();
    }
  }, [authorized]);

  useEffect(() => {
    if (!authorized || !config) return;

    const room = new ViewerRoom();
    roomRef.current = room;
    const stream = streamRef.current;

    const handleTrackStarted = (event?: DailyEventObjectTrack) => {
      if (!event) return;
      // Self-preview of Garry's own outgoing video, shown only while
      // talking -- standard video-call convention, doesn't touch the
      // reception tablet's feed at all.
      if (event.participant?.local) {
        if (event.track.kind === "video" && localVideoRef.current) {
          localVideoRef.current.srcObject = new MediaStream([event.track]);
        }
        return;
      }
      stream.addTrack(event.track);
      if (event.track.kind === "audio") setRemoteAudioActive(true);
      if (videoRef.current && videoRef.current.srcObject !== stream) {
        videoRef.current.srcObject = stream;
      }
      // Autoplay policies can silently block playback that isn't tied to a
      // user gesture; the srcObject assignment above happens async inside a
      // WebRTC callback, so explicitly (re)try play() and log if blocked
      // rather than leaving the pane looking "connected" but black with no
      // visible reason why.
      videoRef.current?.play().catch((err) => console.warn("[viewer] video.play() blocked:", err));
    };

    const handleTrackStopped = (event?: DailyEventObjectTrack) => {
      if (!event) return;
      if (event.participant?.local) {
        if (event.track.kind === "video" && localVideoRef.current) {
          localVideoRef.current.srcObject = null;
        }
        return;
      }
      stream.removeTrack(event.track);
      if (event.track.kind === "audio") setRemoteAudioActive(false);
    };

    // Doorbell alert: only fires if this page is open and connected --
    // deliberately no server-side push infrastructure behind this.
    const handleAppMessage = (event?: DailyEventObjectAppMessage) => {
      if (
        event &&
        typeof event.data === "object" &&
        event.data !== null &&
        (event.data as { type?: unknown }).type === "doorbell"
      ) {
        setDoorbellAlert(true);
        playDoorbellBeep();
        if ("Notification" in window && Notification.permission === "granted") {
          new Notification("SET Reception", { body: "Someone is at reception." });
        }
        setTimeout(() => setDoorbellAlert(false), 10_000);
      }
    };

    (async () => {
      const call = await room.join(config.room.roomUrl);
      call.on("track-started", handleTrackStarted);
      call.on("track-stopped", handleTrackStopped);
      call.on("app-message", handleAppMessage);
      setConnected(true);
    })();

    return () => {
      const call = roomRef.current?.callObject;
      call?.off("track-started", handleTrackStarted);
      call?.off("track-stopped", handleTrackStopped);
      call?.off("app-message", handleAppMessage);
      stream.getTracks().forEach((t) => stream.removeTrack(t));
      void room.leave();
      setConnected(false);
    };
  }, [authorized, config]);

  if (!config) {
    return <Centered>Loading…</Centered>;
  }

  if (!authorized) {
    return (
      <Centered>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (isAllowedViewer(email, config.allowlist)) {
              sessionStorage.setItem(SESSION_KEY, email);
              setAuthorized(true);
              setAuthError(null);
            } else {
              setAuthError("That email isn't on the reception viewer list.");
            }
          }}
          style={{ display: "flex", flexDirection: "column", gap: 12, width: 280 }}
        >
          <h2 style={{ color: "#eee", margin: 0 }}>SET Reception</h2>
          <input
            type="email"
            required
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={{ padding: 10, borderRadius: 6, border: "1px solid #444", background: "#1a1a1a", color: "#eee" }}
          />
          <button type="submit" style={{ padding: 10, borderRadius: 6, cursor: "pointer" }}>
            View feed
          </button>
          {authError && <div style={{ color: "#f66", fontSize: 13 }}>{authError}</div>}
        </form>
      </Centered>
    );
  }

  const toggleTalk = () => {
    if (talking) {
      roomRef.current?.endTalk();
      setTalking(false);
    } else {
      void roomRef.current?.startTalk(true);
      setTalking(true);
    }
  };

  return (
    <div style={{ position: "relative", height: "100%", display: "flex", flexDirection: "column", background: "#111" }}>
      {doorbellAlert && (
        <div
          style={{
            padding: "10px 16px",
            background: "#1565c0",
            color: "#fff",
            textAlign: "center",
            fontWeight: 600,
          }}
        >
          🔔 Someone is at reception
        </div>
      )}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        className={doorbellAlert ? "doorbell-flash" : undefined}
        // Ambient mode never carries audio, and mobile browsers routinely
        // block unmuted autoplay outside a direct user gesture. Stay muted
        // until a talk session actually attaches an audio track, then
        // un-mute — toggling an already-playing element's `muted` state
        // isn't subject to the same restriction as starting unmuted.
        muted={!remoteAudioActive}
        style={{ flex: 1, objectFit: "contain", background: "#000" }}
      />
      <video
        ref={localVideoRef}
        autoPlay
        muted
        playsInline
        style={{
          position: "absolute",
          top: 16,
          right: 16,
          width: 90,
          height: 120,
          objectFit: "cover",
          borderRadius: 8,
          border: "1px solid #333",
          background: "#000",
          display: talking ? "block" : "none",
        }}
      />
      <div style={{ padding: 16, display: "flex", justifyContent: "center", gap: 12 }}>
        <span style={{ color: connected ? "#2e7d32" : "#888", alignSelf: "center", fontSize: 13 }}>
          {connected ? "Connected" : "Connecting…"}
        </span>
        <button
          onClick={toggleTalk}
          style={{
            padding: "14px 32px",
            borderRadius: 999,
            border: "none",
            fontSize: 16,
            fontWeight: 600,
            cursor: "pointer",
            background: talking ? "#c62828" : "#2e7d32",
            color: "#fff",
            userSelect: "none",
          }}
        >
          {talking ? "End" : "Talk"}
        </button>
        {!talking && (
          <button
            onClick={() => roomRef.current?.switchCamera()}
            title="Switch tablet camera"
            style={{
              padding: "14px 16px",
              borderRadius: 999,
              border: "1px solid #444",
              fontSize: 16,
              cursor: "pointer",
              background: "#1a1a1a",
              color: "#eee",
            }}
          >
            🔄
          </button>
        )}
      </div>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "#eee",
      }}
    >
      {children}
    </div>
  );
}
