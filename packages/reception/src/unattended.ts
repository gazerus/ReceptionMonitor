const PREF_KEY = "reception-manual-unattended";

/**
 * Whether the admin viewer has manually marked reception as unattended (e.g.
 * stepped away during normal hours) -- persisted device-locally so it
 * survives a reboot/restart until someone explicitly toggles it off, the
 * same pattern as the kiosk-lock preference.
 */
export function loadUnattendedPreference(): boolean {
  try {
    return localStorage.getItem(PREF_KEY) === "true";
  } catch {
    return false;
  }
}

export function saveUnattendedPreference(value: boolean): void {
  try {
    localStorage.setItem(PREF_KEY, value ? "true" : "false");
  } catch {
    // ignore
  }
}
