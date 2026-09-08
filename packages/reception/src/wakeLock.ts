import { KeepAwake } from "@capacitor-community/keep-awake";
import { App } from "@capacitor/app";

/**
 * Default posture (open decision, confirmed): keep the tablet screen on
 * during ambient streaming rather than letting Android sleep, to avoid
 * any OEM background-restriction risk to the camera/Daily connection.
 * Revisit after power-draw testing on the actual device.
 */
export async function keepScreenAwake(): Promise<void> {
  try {
    await KeepAwake.keepAwake();
  } catch (err) {
    console.warn("[wakeLock] keepAwake unavailable (likely running in a browser tab):", err);
  }
}

/**
 * Re-applies the keep-awake flag every time the app comes back to the
 * foreground, not just once on first launch -- if Android/OEM battery
 * optimization ever pauses the activity and the flag gets cleared, this is
 * what puts it back without needing a full app restart.
 */
export function watchAppResume(): void {
  void App.addListener("resume", () => {
    void keepScreenAwake();
  });
}

export async function allowScreenSleep(): Promise<void> {
  try {
    await KeepAwake.allowSleep();
  } catch {
    // best-effort only
  }
}
