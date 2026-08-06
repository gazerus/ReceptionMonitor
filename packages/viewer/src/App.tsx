import { useEffect, useRef, useState } from "react";
import type { DailyEventObjectAppMessage, DailyEventObjectTrack } from "@daily-co/daily-js";
import { loadAppConfig, isAllowedViewer, type AppConfig } from "@reception/shared";
import { ViewerRoom } from "./daily";

const CONFIG_URL = import.meta.env.VITE_CONFIG_URL as string | undefined;
const SESSION_KEY = "reception-viewer-email";

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
    if (!authorized || !config) return;

    const room = new ViewerRoom();
    roomRef.current = room;
    const stream = streamRef.current;

    const handleTrackStarted = (event?: DailyEventObjectTrack) => {
      if (!event || event.participant?.local) return;
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
      if (!event || event.participant?.local) return;
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

  const startTalk = () => {
    void roomRef.current?.startTalk(true);
    setTalking(true);
  };
  const endTalk = () => {
    roomRef.current?.endTalk();
    setTalking(false);
  };

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", background: "#111" }}>
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
        // Ambient mode never carries audio, and mobile browsers routinely
        // block unmuted autoplay outside a direct user gesture. Stay muted
        // until a talk session actually attaches an audio track, then
        // un-mute — toggling an already-playing element's `muted` state
        // isn't subject to the same restriction as starting unmuted.
        muted={!remoteAudioActive}
        style={{ flex: 1, objectFit: "contain", background: "#000" }}
      />
      <div style={{ padding: 16, display: "flex", justifyContent: "center", gap: 12 }}>
        <span style={{ color: connected ? "#2e7d32" : "#888", alignSelf: "center", fontSize: 13 }}>
          {connected ? "Connected" : "Connecting…"}
        </span>
        <button
          onMouseDown={startTalk}
          onMouseUp={endTalk}
          onMouseLeave={() => talking && endTalk()}
          onTouchStart={(e) => {
            e.preventDefault();
            startTalk();
          }}
          onTouchEnd={(e) => {
            e.preventDefault();
            endTalk();
          }}
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
          {talking ? "Talking… release to end" : "Hold to talk"}
        </button>
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
