import { registerPlugin } from "@capacitor/core";

export interface KioskPlugin {
  start(): Promise<void>;
  stop(): Promise<void>;
  isActive(): Promise<{ active: boolean }>;
  /** Best-effort deep link into Android's security settings, in case screen pinning has been disabled by a device policy. */
  openSecuritySettings(): Promise<void>;
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
