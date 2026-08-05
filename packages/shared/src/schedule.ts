import type { ScheduleConfig } from "./types.js";

function partsInZone(date: Date, timeZone: string) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
  const parts = fmt.formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  const hour = get("hour") === "24" ? 0 : Number(get("hour"));
  return {
    minutesSinceMidnight: hour * 60 + Number(get("minute")),
    dayOfWeek: weekdayMap[get("weekday")] ?? date.getDay(),
  };
}

function toMinutes(clock: string): number {
  const [h, m] = clock.split(":").map(Number);
  return h * 60 + m;
}

/** True when `now` falls inside the configured daily window (and day-of-week, if set). */
export function isWithinScheduleWindow(schedule: ScheduleConfig, now: Date = new Date()): boolean {
  const { minutesSinceMidnight, dayOfWeek } = partsInZone(now, schedule.timezone);

  if (schedule.daysOfWeek && !schedule.daysOfWeek.includes(dayOfWeek)) {
    return false;
  }

  const start = toMinutes(schedule.start);
  const end = toMinutes(schedule.end);

  if (start === end) return false;
  if (start < end) {
    return minutesSinceMidnight >= start && minutesSinceMidnight < end;
  }
  // Overnight window (e.g. start "22:00", end "06:00").
  return minutesSinceMidnight >= start || minutesSinceMidnight < end;
}
