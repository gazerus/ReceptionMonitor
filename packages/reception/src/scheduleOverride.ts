import type { ScheduleConfig } from "@reception/shared";

const STORAGE_KEY = "reception-schedule-override";

export interface ScheduleOverride {
  start: string;
  end: string;
}

/**
 * Local-only override for the schedule start/end times, set via the
 * on-tablet PIN-protected settings screen. Lives in this device's
 * localStorage rather than the hosted config -- it only ever needs to
 * affect this one tablet, and doesn't require any server/rebuild to
 * change.
 */
export function loadScheduleOverride(): ScheduleOverride | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed?.start === "string" && typeof parsed?.end === "string") {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

export function saveScheduleOverride(override: ScheduleOverride): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(override));
  } catch (err) {
    console.warn("[schedule] failed to save override:", err);
  }
}

export function applyScheduleOverride(schedule: ScheduleConfig): ScheduleConfig {
  const override = loadScheduleOverride();
  if (!override) return schedule;
  return { ...schedule, start: override.start, end: override.end };
}
