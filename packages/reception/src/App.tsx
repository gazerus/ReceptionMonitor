import { useEffect, useRef, useState } from "react";
import { loadAppConfig, isWithinScheduleWindow, type AppConfig, type ScheduleConfig } from "@reception/shared";
import { ReceptionRoom } from "./daily";
import { keepScreenAwake } from "./wakeLock";
import { applyScheduleOverride, saveScheduleOverride } from "./scheduleOverride";
import { Kiosk, loadKioskPreference, saveKioskPreference } from "./kiosk";

const CONFIG_URL = import.meta.env.VITE_CONFIG_URL as string | undefined;
const SCHEDULE_CHECK_INTERVAL_MS = 30_000;
const CONFIG_REFRESH_INTERVAL_MS = 5 * 60_000;
const SETTINGS_PIN = "45656";

type Status = "loading" | "waiting" | "live" | "error" | "no-camera";

/** Splits a locale-formatted time into the numeric part and the am/pm marker, so the marker can render smaller. */
function splitClock(date: Date): { time: string; period: string } {
  const parts = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).formatToParts(date);
  let time = "";
  let period = "";
  for (const part of parts) {
    if (part.type === "dayPeriod") period = part.value;
    else time += part.value;
  }
  return { time: time.trim(), period };
}

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
  const [kioskEnabled, setKioskEnabled] = useState(() => loadKioskPreference());
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

  useEffect(() => {
    // Screen pinning doesn't survive an app restart/reboot on its own --
    // re-arm it on launch if it was left enabled last time.
    if (kioskEnabled) {
      Kiosk.start().catch((err) => console.warn("[kiosk] failed to re-arm on launch:", err));
    }
  }, []);

  const toggleKiosk = async (enabled: boolean) => {
    try {
      if (enabled) {
        await Kiosk.start();
      } else {
        await Kiosk.stop();
      }
      setKioskEnabled(enabled);
      saveKioskPreference(enabled);
    } catch (err) {
      console.warn("[kiosk] toggle failed:", err);
      throw err;
    }
  };

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
        color: "#1a1a1a",
        fontFamily: "system-ui, sans-serif",
        background: "#fdfdfd",
        overflow: "hidden",
      }}
    >
      <div style={{ marginTop: 28, textAlign: "center" }}>
        <div style={{ fontSize: "clamp(36px, 6vw, 60px)", color: "#666" }}>Welcome to:</div>
        <GbcWordmark />
      </div>

      <div style={{ marginTop: 12 }}>
        <StatusPill status={status} />
      </div>

      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <DoorbellButton state={doorbellState} onPress={pressDoorbell} />
      </div>

      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: 70,
          right: 150,
          fontFamily: "'Tangerine', cursive",
          fontWeight: 700,
          fontSize: "clamp(56px, 11vw, 110px)",
          lineHeight: 1,
          color: "#1a1a1a",
          whiteSpace: "nowrap",
          overflow: "hidden",
        }}
      >
        {(() => {
          const { time, period } = splitClock(now);
          return (
            <>
              {time}
              {period && <span style={{ fontSize: "0.5em" }}> {period}</span>}
            </>
          );
        })()}
      </div>

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
          border: "1px solid #ccc",
          background: "#000",
          zIndex: 10,
        }}
      />
      {schedule && (
        <ScheduleSettings
          schedule={schedule}
          onSave={saveSchedule}
          kioskEnabled={kioskEnabled}
          onToggleKiosk={toggleKiosk}
        />
      )}
    </div>
  );
}

function GbcWordmark() {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
      <div
        style={{
          fontFamily: "'Permanent Marker', cursive",
          fontSize: "clamp(110px, 18vw, 180px)",
          lineHeight: 1,
          display: "flex",
          gap: 10,
          marginTop: 12,
        }}
      >
        <span style={{ color: "#2e7d32" }}>G</span>
        <span style={{ color: "#1565c0" }}>B</span>
        <span style={{ color: "#ef6c00" }}>C</span>
      </div>
      <div
        style={{
          fontFamily: "Georgia, 'Times New Roman', serif",
          fontVariant: "small-caps",
          fontWeight: 700,
          fontSize: "clamp(26px, 4.5vw, 46px)",
          letterSpacing: 2,
          color: "#111",
          marginTop: 6,
          textAlign: "center",
        }}
      >
        Gladstone Business Centre
      </div>
    </div>
  );
}

function ScheduleSettings({
  schedule,
  onSave,
  kioskEnabled,
  onToggleKiosk,
}: {
  schedule: ScheduleConfig;
  onSave: (start: string, end: string) => void;
  kioskEnabled: boolean;
  onToggleKiosk: (enabled: boolean) => Promise<void>;
}) {
  const [stage, setStage] = useState<"closed" | "pin" | "edit">("closed");
  const [pin, setPin] = useState("");
  const [pinError, setPinError] = useState(false);
  const [start, setStart] = useState(schedule.start);
  const [end, setEnd] = useState(schedule.end);
  const [kioskError, setKioskError] = useState<string | null>(null);

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

  const handleKioskToggle = async () => {
    setKioskError(null);
    try {
      await onToggleKiosk(!kioskEnabled);
    } catch {
      setKioskError(
        kioskEnabled
          ? "Couldn't release the lock. You can also exit by holding Back and Recent Apps together."
          : 'Couldn\'t enable screen pinning -- it may be turned off. Open Android security settings, turn on "Screen pinning" (sometimes called "App pinning"), then try again.',
      );
    }
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
          border: "1px solid #ccc",
          background: "rgba(0,0,0,0.05)",
          color: "#666",
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

          <div
            style={{
              borderTop: "1px solid #333",
              paddingTop: 12,
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            <div style={{ color: "#eee", fontWeight: 600, fontSize: 14 }}>Kiosk lock</div>
            <div style={{ color: "#999", fontSize: 12, lineHeight: 1.4 }}>
              Pins the app to the screen using Android's built-in Screen Pinning, so it
              can't be minimized, switched away from, or closed by an accidental tap.
              Android will show a one-time confirmation the first time this is turned on.
            </div>
            <button
              type="button"
              onClick={() => void handleKioskToggle()}
              style={{
                padding: 10,
                borderRadius: 6,
                border: "none",
                cursor: "pointer",
                background: kioskEnabled ? "#c62828" : "#2e7d32",
                color: "#fff",
                fontWeight: 600,
              }}
            >
              {kioskEnabled ? "Disable kiosk lock" : "Enable kiosk lock"}
            </button>
            <button
              type="button"
              onClick={() => void Kiosk.openSecuritySettings().catch(() => setKioskError("Couldn't open Android settings."))}
              style={{
                padding: 8,
                borderRadius: 6,
                border: "1px solid #444",
                background: "transparent",
                color: "#ccc",
                fontSize: 12,
                cursor: "pointer",
              }}
            >
              Open Android security settings
            </button>
            {kioskError && <div style={{ color: "#f66", fontSize: 12 }}>{kioskError}</div>}
            {kioskEnabled && (
              <div style={{ color: "#999", fontSize: 12 }}>
                To exit without the code: hold Back and Recent Apps together (varies by device).
              </div>
            )}
          </div>

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
  const idle = state === "idle";
  const label = idle ? "Press for Assistance" : "Someone will be with you shortly";

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
      <button
        onClick={onPress}
        disabled={!idle}
        aria-label="Press for assistance"
        style={{
          width: 220,
          height: 220,
          borderRadius: "50%",
          border: "none",
          cursor: idle ? "pointer" : "default",
          background: idle ? "#00c3e3" : "#2e7d32",
          boxShadow: "0 8px 20px rgba(0,0,0,0.18)",
          fontSize: 96,
          lineHeight: "220px",
          textAlign: "center",
        }}
      >
        {idle ? "🔔" : "✅"}
      </button>
      <div style={{ fontSize: 22, fontWeight: 600, color: "#333", textAlign: "center", maxWidth: 280 }}>
        {label}
      </div>
    </div>
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
