/**
 * Deterministic ntfy.sh topic for the viewer-to-tablet "override wake"
 * channel -- lets the admin viewer force the tablet online outside its
 * normal schedule (e.g. someone rings the doorbell on a closed day)
 * without keeping it connected to the Daily room 24/7 just to make that
 * possible (tried once, reverted: too much Daily participant-minutes usage
 * for a rarely-used feature). Both reception and viewer derive the same
 * topic from the room URL independently, so no extra config is needed by
 * default -- distinct from the doorbell's own outbound topic (derived in
 * reception's daily.ts) so the two channels, which carry messages in
 * opposite directions, never collide.
 */
export async function deriveWakeTopic(roomUrl: string): Promise<string> {
  const bytes = new TextEncoder().encode(`wake:${roomUrl}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `reception-monitor-wake-${hex.slice(0, 16)}`;
}
