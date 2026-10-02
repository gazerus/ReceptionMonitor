import { deriveWakeTopic, type AppConfig } from "@reception/shared";

/**
 * Posts to the ntfy.sh topic the tablet listens on (see
 * reception/src/overrideWake.ts) -- a plain HTTP POST, no Daily involvement.
 */
async function postToWakeTopic(config: AppConfig, body: "watch" | "wake"): Promise<void> {
  const push = config.doorbellPush;
  if (!push) throw new Error("doorbellPush isn't configured -- the tablet has no wake channel to listen on.");
  const topic = push.wakeTopic ?? (await deriveWakeTopic(config.room.roomUrl));
  const baseUrl = push.ntfyBaseUrl ?? "https://ntfy.sh";
  const res = await fetch(`${baseUrl}/${topic}`, { method: "POST", body });
  if (!res.ok) throw new Error(`ntfy POST failed: ${res.status}`);
}

/**
 * Asks the tablet to join the Daily room because this viewer wants the
 * feed. The tablet sits outside the room (unbilled) until it receives one of
 * these, and leaves again once no viewer is connected. Honoured inside
 * scheduled hours, within an admin override, or shortly after a doorbell press.
 */
export function sendWatch(config: AppConfig): Promise<void> {
  return postToWakeTopic(config, "watch");
}

/** Admin-only: brings the tablet online even outside its normal schedule. */
export function sendOverrideWake(config: AppConfig): Promise<void> {
  return postToWakeTopic(config, "wake");
}
