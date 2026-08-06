import { useEffect, useRef, useState } from "react";
import { loadAppConfig, isWithinScheduleWindow, type AppConfig } from "@reception/shared";
import { ReceptionRoom } from "./daily";
import { keepScreenAwake } from "./wakeLock";

const CONFIG_URL = import.meta.env.VITE_CONFIG_URL as string | undefined;
const SCHEDULE_CHECK_INTERVAL_MS = 30_000;
const CONFIG_REFRESH_INTERVAL_MS = 5 * 60_000;
const TALK_VIDEO_HOLD_MS = 30_000;

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
  const remoteVideoHideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [doorbellState, setDoorbellState] = useState<"idle" | "rung">("idle");

  useEffect(() => {
    void keepScreenAwake();

    let cancelled = false;
    let scheduleTimer: ReturnType<typeof setInterval>;
    let configTimer: ReturnType<typeof setInterval>;
    let clockTimer: ReturnType<typeof setInterval>;

    async function refreshConfig() {
      const config = await loadAppConfig(CONFIG_URL);
      if (cancelled) return;
      configRef.current = config;
      roomRef.current?.updateConfig(config);
    }

    async function tick() {
      const config = configRef.current;
      if (!config) return;

      const shouldBeLive = isWithinScheduleWindow(config.schedule);
      const room = roomRef.current;
      if (!room) return;

      try {
        if (shouldBeLive && !room.isJoined) {
          await room.joinAmbient();
          setStatus("live");
        } else if (!shouldBeLive && room.isJoined) {
          await room.leave();
          setStatus("waiting");
        }
      } catch (err) {
        console.error("[schedule] join/leave failed:", err);
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
          if (remoteVideoHideTimer.current) {
            clearTimeout(remoteVideoHideTimer.current);
            remoteVideoHideTimer.current = null;
          }
          if (track) {
            if (remoteVideoRef.current) {
              remoteVideoRef.current.srcObject = new MediaStream([track]);
            }
            setShowRemoteVideo(true);
          } else {
            // Hold the last frame on screen for a while after the talk
            // session ends rather than snapping straight back to the
            // ambient view.
            remoteVideoHideTimer.current = setTimeout(() => {
              setShowRemoteVideo(false);
              if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
            }, TALK_VIDEO_HOLD_MS);
          }
        },
      );
      setStatus(isWithinScheduleWindow(configRef.current.schedule) ? "loading" : "waiting");
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
      if (remoteVideoHideTimer.current) clearTimeout(remoteVideoHideTimer.current);
      void roomRef.current?.leave();
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
