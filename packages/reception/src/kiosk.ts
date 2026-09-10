import { registerPlugin } from "@capacitor/core";

export interface KioskPlugin {
  start(): Promise<void>;
  stop(): Promise<void>;
  isActive(): Promise<{ active: boolean }>;
  /** Best-effort deep link into Android's security settings, in case screen pinning has been disabled by a device policy. */
  openSecuritySettings(): Promise<void>;
  /** Forces the screen back on right now (e.g. after Android/OEM battery optimization has put it to sleep). */
  wake(): Promise<void>;
  /** Whether the physical display is currently on/interactive. */
  isScreenOn(): Promise<{ on: boolean }>;
  /** Whether "Display over other apps" is granted -- required for the app to actually show itself when auto-launched after boot. */
  isOverlayGranted(): Promise<{ granted: boolean }>;
  /** Deep link to the "Display over other apps" grant screen for this app. */
  openOverlaySettings(): Promise<void>;
  /** Whether this app is currently the device's default Home app -- the reliable way to get it on screen at boot. */
  isDefaultHome(): Promise<{ isDefault: boolean }>;
  /** Deep link to Android's "Default apps -> Home app" picker. */
  openHomeSettings(): Promise<void>;
  /** Immediately restarts the app process -- used by the no-video watchdog when a plain rejoin doesn't bring the camera preview back. */
  restartApp(): Promise<void>;
}

// No web implementation: kiosk lock is an Android-only, native-only feature.
// Calls simply reject in a browser (typecheck/dev-server usage), which callers
// already treat as "not available" rather than an error worth surfacing.
export const Kiosk = registerPlugin<KioskPlugin>("Kiosk");

const PREF_KEY = "reception-kiosk-enabled";

/** Whether kiosk lock should be (re-)armed on app launch -- persisted device-locally, same pattern as scheduleOverride. */
export function loadKioskPreference(): boolean {
  try {
    return localStorage.getItem(PREF_KEY) === "true";
  } catch {
    return false;
  }
}

export function saveKioskPreference(enabled: boolean): void {
  try {
    localStorage.setItem(PREF_KEY, enabled ? "true" : "false");
  } catch {
    // ignore
  }
}
