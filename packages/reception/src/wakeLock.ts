import { KeepAwake } from "@capacitor-community/keep-awake";

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

export async function allowScreenSleep(): Promise<void> {
  try {
    await KeepAwake.allowSleep();
  } catch {
    // best-effort only
  }
}
