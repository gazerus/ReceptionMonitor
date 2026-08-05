import { useEffect, useRef, useState } from "react";
import type { DailyEventObjectTrack } from "@daily-co/daily-js";
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
  const videoRef = useRef<HTMLVideoElement>(null);
  const roomRef = useRef<ViewerRoom | null>(null);

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

    const handleTrack = (event?: DailyEventObjectTrack) => {
      if (!event || event.participant?.local) return;
      if (event.track.kind !== "video") return;
      if (videoRef.current) {
        videoRef.current.srcObject = new MediaStream([event.track]);
      }
    };

    (async () => {
      const call = await room.join(config.room.roomUrl);
      call.on("track-started", handleTrack);
      setConnected(true);
    })();

    return () => {
      roomRef.current?.callObject?.off("track-started", handleTrack);
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
    roomRef.current?.startTalk(false);
    setTalking(true);
  };
  const endTalk = () => {
    roomRef.current?.endTalk();
    setTalking(false);
  };

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", background: "#111" }}>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={false}
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
