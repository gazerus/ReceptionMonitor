import { useEffect, useRef, useState } from "react";
import { loadAppConfig, isWithinScheduleWindow, type AppConfig, type ScheduleConfig } from "@reception/shared";
import { ReceptionRoom } from "./daily";
import { keepScreenAwake } from "./wakeLock";
import { applyScheduleOverride, saveScheduleOverride } from "./scheduleOverride";

const CONFIG_URL = import.meta.env.VITE_CONFIG_URL as string | undefined;
const SCHEDULE_CHECK_INTERVAL_MS = 30_000;
const CONFIG_REFRESH_INTERVAL_MS = 5 * 60_000;
const SETTINGS_PIN = "45656";

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
  const [schedule, setSchedule] = useState<ScheduleConfig | null>(null);
  const tickNowRef = useRef<() => void>(() => {});

  useEffect(() => {
    void keepScreenAwake();

    let cancelled = false;
    let scheduleTimer: ReturnType<typeof setInterval>;
    let configTimer: ReturnType<typeof setInterval>;
    let clockTimer: ReturnType<typeof setInterval>;

    async function refreshConfig() {
      const config = await loadAppConfig(CONFIG_URL);
      if (cancelled) return;
      config.schedule = applyScheduleOverride(config.schedule);
      configRef.current = config;
      setSchedule(config.schedule);
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
    tickNowRef.current = () => void tick();

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
      void roomRef.current?.leave();
    };
  }, []);

  const pressDoorbell = () => {
    if (doorbellState !== "idle") return;
    roomRef.current?.ringDoorbell();
    setDoorbellState("rung");
    setTimeout(() => setDoorbellState("idle"), 4000);
  };

  const saveSchedule = (start: string, end: string) => {
    saveScheduleOverride({ start, end });
    setSchedule((prev) => (prev ? { ...prev, start, end } : prev));
    if (configRef.current) {
      configRef.current = { ...configRef.current, schedule: { ...configRef.current.schedule, start, end } };
      roomRef.current?.updateConfig(configRef.current);
    }
    // Re-evaluate immediately rather than waiting up to
    // SCHEDULE_CHECK_INTERVAL_MS for the new hours to take effect.
    tickNowRef.current();
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
      {schedule && <ScheduleSettings schedule={schedule} onSave={saveSchedule} />}
    </div>
  );
}

function ScheduleSettings({
  schedule,
  onSave,
}: {
  schedule: ScheduleConfig;
  onSave: (start: string, end: string) => void;
}) {
  const [stage, setStage] = useState<"closed" | "pin" | "edit">("closed");
  const [pin, setPin] = useState("");
  const [pinError, setPinError] = useState(false);
  const [start, setStart] = useState(schedule.start);
  const [end, setEnd] = useState(schedule.end);

  const openPin = () => {
    setPin("");
    setPinError(false);
    setStage("pin");
  };

  const submitPin = (e: React.FormEvent) => {
    e.preventDefault();
    if (pin === SETTINGS_PIN) {
      setStart(schedule.start);
      setEnd(schedule.end);
      setStage("edit");
    } else {
      setPinError(true);
    }
  };

  const submitSchedule = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(start, end);
    setStage("closed");
  };

  if (stage === "closed") {
    return (
      <button
        onClick={openPin}
        aria-label="Settings"
        style={{
          position: "absolute",
          bottom: 16,
          left: 16,
          width: 36,
          height: 36,
          borderRadius: "50%",
          border: "1px solid #333",
          background: "rgba(255,255,255,0.06)",
          color: "#888",
          fontSize: 16,
          zIndex: 10,
        }}
      >
        ⚙
      </button>
    );
  }

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        background: "rgba(0,0,0,0.85)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 20,
      }}
    >
      {stage === "pin" ? (
        <form
          onSubmit={submitPin}
          style={{ display: "flex", flexDirection: "column", gap: 12, width: 220 }}
        >
          <div style={{ color: "#eee", textAlign: "center" }}>Enter code</div>
          <input
            type="password"
            inputMode="numeric"
            autoFocus
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            style={{
              padding: 10,
              borderRadius: 6,
              border: "1px solid #444",
              background: "#1a1a1a",
              color: "#eee",
              textAlign: "center",
              fontSize: 20,
              letterSpacing: 4,
            }}
          />
          {pinError && (
            <div style={{ color: "#f66", fontSize: 13, textAlign: "center" }}>Incorrect code</div>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <button type="submit" style={{ flex: 1, padding: 10, borderRadius: 6 }}>
              OK
            </button>
            <button
              type="button"
              onClick={() => setStage("closed")}
              style={{ flex: 1, padding: 10, borderRadius: 6 }}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <form
          onSubmit={submitSchedule}
          style={{ display: "flex", flexDirection: "column", gap: 12, width: 260 }}
        >
          <div style={{ color: "#eee", textAlign: "center", fontWeight: 600 }}>
            Monitoring hours
          </div>
          <label style={{ color: "#ccc", fontSize: 13, display: "flex", flexDirection: "column", gap: 4 }}>
            Start
            <input
              type="time"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              style={{ padding: 8, borderRadius: 6, border: "1px solid #444", background: "#1a1a1a", color: "#eee" }}
            />
          </label>
          <label style={{ color: "#ccc", fontSize: 13, display: "flex", flexDirection: "column", gap: 4 }}>
            End
            <input
              type="time"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              style={{ padding: 8, borderRadius: 6, border: "1px solid #444", background: "#1a1a1a", color: "#eee" }}
            />
          </label>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="submit" style={{ flex: 1, padding: 10, borderRadius: 6 }}>
              Save
            </button>
            <button
              type="button"
              onClick={() => setStage("closed")}
              style={{ flex: 1, padding: 10, borderRadius: 6 }}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
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
