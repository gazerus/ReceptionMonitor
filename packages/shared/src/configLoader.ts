import type { AppConfig } from "./types.js";
import defaultConfig from "./config.default.json";

const CACHE_KEY = "reception-app-config-cache-v1";
const FETCH_TIMEOUT_MS = 5000;

function isAppConfig(value: unknown): value is AppConfig {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.room === "object" &&
    typeof v.schedule === "object" &&
    typeof v.allowlist === "object" &&
    typeof v.video === "object" &&
    typeof v.push === "object" &&
    typeof v.talkSessionTimeoutSeconds === "number"
  );
}

function readCache(): AppConfig | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return isAppConfig(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function writeCache(config: AppConfig): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(config));
  } catch {
    // best-effort only
  }
}

/**
 * Loads app config (room, schedule, allowlist, video quality) from a
 * hosted JSON file so hours/staff can be changed by editing that file,
 * with no app rebuild or redeploy. Falls back to the last-known-good
 * cached copy, then to the bundled default, if the fetch fails (e.g.
 * tablet briefly offline).
 */
export async function loadAppConfig(configUrl?: string): Promise<AppConfig> {
  if (!configUrl) {
    return readCache() ?? (defaultConfig as AppConfig);
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(configUrl, {
      cache: "no-store",
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) throw new Error(`config fetch failed: ${res.status}`);
    const parsed = await res.json();
    if (!isAppConfig(parsed)) throw new Error("config fetch returned malformed shape");
    writeCache(parsed);
    return parsed;
  } catch (err) {
    console.warn("[config] falling back, remote fetch failed:", err);
    return readCache() ?? (defaultConfig as AppConfig);
  }
}

export { defaultConfig };
