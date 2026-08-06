import { useEffect, useRef, useState } from "react";
import { loadAppConfig, isWithinScheduleWindow, type AppConfig } from "@reception/shared";
import { ReceptionRoom } from "./daily";
import { keepScreenAwake } from "./wakeLock";

const CONFIG_URL = import.meta.env.VITE_CONFIG_URL as string | undefined;
const SCHEDULE_CHECK_INTERVAL_MS = 30_000;
const CONFIG_REFRESH_INTERVAL_MS = 5 * 60_000;

type Status = "loading" | "waiting" | "live" | "error" | "no-camera";

export default function App() {
  const [status, setStatus] = useState<Status>("loading");
  const [now, setNow] = useState(() => new Date());
  const roomRef = useRef<ReceptionRoom | null>(null);
  const configRef = useRef<AppConfig | null>(null);
  const previewRef = useRef<HTMLVideoElement>(null);
  const remoteAudioRef = useRef<HTMLAudioElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const [showRemoteVideo, setShowRemoteVideo] = useState(false);
  const [doorbellState, setDoorbellState] = useState<"idle" | "rung">("idle");

  useEffect(() => {
    void keepScreenAwake();

    let cancelled = false;
    let scheduleTimer: ReturnType<typeof setInterval>;
    let configTimer: ReturnType<typeof setInterval>;
    let clockTimer: ReturnType<typeof setInterval>;
    let publishing = false;
    let wakeUntil: number | null = null;

    async function refreshConfig() {
      const config = await loadAppConfig(CONFIG_URL);
      if (cancelled) return;
      configRef.current = config;
      roomRef.current?.updateConfig(config);
    }

    async function tick() {
      const config = configRef.current;
      const room = roomRef.current;
      if (!config || !room) return;

      const scheduledLive = isWithinScheduleWindow(config.schedule);
      const wakeActive = wakeUntil !== null && Date.now() < wakeUntil;
      const shouldPublish = scheduledLive || wakeActive;

      if (shouldPublish === publishing) return;

      try {
        await room.setVideoPublishing(shouldPublish);
        publishing = shouldPublish;
        setStatus(shouldPublish ? "live" : "waiting");
      } catch (err) {
        console.error("[schedule] failed to update video publishing:", err);
        setStatus("error");
      }
    }

    (async () => {
      await refreshConfig();
      if (cancelled || !configRef.current) return;

      roomRef.current = new ReceptionRoom(
        configRef.current,
        (err) => {
          console.error("[camera] failed to acquire camera/mic:", err);
          setStatus("no-camera");
        },
        (track) => {
          if (previewRef.current) {
            previewRef.current.srcObject = track ? new MediaStream([track]) : null;
          }
        },
        (track) => {
          if (remoteAudioRef.current) {
            remoteAudioRef.current.srcObject = track ? new MediaStream([track]) : null;
          }
        },
        (track) => {
          if (track) {
            if (remoteVideoRef.current) {
              remoteVideoRef.current.srcObject = new MediaStream([track]);
            }
            setShowRemoteVideo(true);
          } else {
            // Drop straight back to the ambient view when the talk session
            // ends -- holding the last (now frozen, non-updating) frame on
            // screen reads as broken rather than intentional.
            setShowRemoteVideo(false);
            if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
          }
        },
        () => {
          // Out-of-hours "Check in" from the viewer. Extends (or starts) the
          // wake window and re-evaluates immediately rather than waiting up
          // to SCHEDULE_CHECK_INTERVAL_MS for the next tick.
          const minutes = configRef.current?.checkInDurationMinutes ?? 10;
          wakeUntil = Date.now() + minutes * 60_000;
          void tick();
        },
      );

      try {
        await roomRef.current.connect();
      } catch (err) {
        console.error("[reception] failed to connect:", err);
        setStatus("error");
        return;
      }

      await tick();

      scheduleTimer = setInterval(() => void tick(), SCHEDULE_CHECK_INTERVAL_MS);
      configTimer = setInterval(() => void refreshConfig(), CONFIG_REFRESH_INTERVAL_MS);
      clockTimer = setInterval(() => setNow(new Date()), 1000);
    })();

    return () => {
      cancelled = true;
      clearInterval(scheduleTimer);
      clearInterval(configTimer);
      clearInterval(clockTimer);
      void roomRef.current?.disconnect();
    };
  }, []);

  const pressDoorbell = () => {
    if (doorbellState !== "idle") return;
    roomRef.current?.ringDoorbell();
    setDoorbellState("rung");
    setTimeout(() => setDoorbellState("idle"), 4000);
  };

  return (
    <div
      style={{
        position: "relative",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 16,
        color: "#e5e5e5",
        fontFamily: "system-ui, sans-serif",
        background: "#0a0a0a",
      }}
    >
      <div style={{ fontSize: 20, letterSpacing: 1, opacity: 0.7 }}>SET Reception Monitor</div>
      <div style={{ fontSize: 48, fontVariantNumeric: "tabular-nums" }}>
        {now.toLocaleTimeString()}
      </div>
      <StatusPill status={status} />
      <DoorbellButton state={doorbellState} onPress={pressDoorbell} />
      <audio ref={remoteAudioRef} autoPlay />
      <video
        ref={remoteVideoRef}
        autoPlay
        playsInline
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          objectFit: "cover",
          background: "#000",
          zIndex: 5,
          display: showRemoteVideo ? "block" : "none",
        }}
      />
      <video
        ref={previewRef}
        autoPlay
        muted
        playsInline
        style={{
          position: "absolute",
          bottom: 16,
          right: 16,
          width: 120,
          height: 90,
          objectFit: "cover",
          borderRadius: 8,
          border: "1px solid #333",
          background: "#000",
          zIndex: 10,
        }}
      />
    </div>
  );
}

function DoorbellButton({ state, onPress }: { state: "idle" | "rung"; onPress: () => void }) {
  const label = {
    idle: "Press for assistance",
    rung: "Someone will be with you shortly",
  }[state];

  return (
    <button
      onClick={onPress}
      disabled={state !== "idle"}
      style={{
        padding: "14px 28px",
        borderRadius: 999,
        border: "none",
        fontSize: 16,
        fontWeight: 600,
        cursor: state === "idle" ? "pointer" : "default",
        background: state === "rung" ? "#2e7d32" : "#1565c0",
        color: "#fff",
      }}
    >
      {label}
    </button>
  );
}

function StatusPill({ status }: { status: Status }) {
  const label: Record<Status, string> = {
    loading: "Starting…",
    waiting: "Outside monitoring hours",
    live: "Monitoring active",
    error: "Connection issue — retrying",
    "no-camera": "No camera — check app permissions",
  };
  const color: Record<Status, string> = {
    loading: "#888",
    waiting: "#555",
    live: "#2e7d32",
    error: "#b71c1c",
    "no-camera": "#e65100",
  };
  return (
    <div
      style={{
        padding: "6px 16px",
        borderRadius: 999,
        background: color[status],
        fontSize: 14,
      }}
    >
      {label[status]}
    </div>
  );
}
