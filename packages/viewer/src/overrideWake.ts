import { deriveWakeTopic, type AppConfig } from "@reception/shared";

/**
 * Admin-only: forces the tablet online outside its normal schedule (e.g.
 * someone rings the doorbell on a closed day), via the same lightweight
 * ntfy.sh channel the tablet listens to continuously (see
 * reception/src/overrideWake.ts) -- no Daily/WebRTC connection involved on
 * this side either, just a plain HTTP POST like the doorbell push itself.
 */
export async function sendOverrideWake(config: AppConfig): Promise<void> {
  const push = config.doorbellPush;
  if (!push) throw new Error("doorbellPush isn't configured -- override wake has no channel to use.");
  const topic = push.wakeTopic ?? (await deriveWakeTopic(config.room.roomUrl));
  const baseUrl = push.ntfyBaseUrl ?? "https://ntfy.sh";
  await fetch(`${baseUrl}/${topic}`, { method: "POST", body: "wake" });
}
