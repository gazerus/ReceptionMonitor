/**
 * Listens on the ntfy.sh wake topic via Server-Sent Events -- a lightweight,
 * always-open HTTP connection that costs nothing per minute, unlike sitting
 * in the Daily room. Two message bodies are used:
 *   - "watch": a viewer page has opened and wants the feed (on demand).
 *   - "wake":  admin override, also allowed outside scheduled hours.
 * Returns an unsubscribe function.
 */
export type WakeKind = "watch" | "wake";

// EventSource auto-reconnects and ntfy may replay recent messages on
// reconnect -- ignore anything older than this so a stale request can't
// pull the tablet into the room (and back onto the Daily meter) for nothing.
const MAX_MESSAGE_AGE_SECONDS = 60;

export function listenForOverrideWake(topicUrl: string, onMessage: (kind: WakeKind) => void): () => void {
  const source = new EventSource(`${topicUrl}/sse`);
  source.onmessage = (event: MessageEvent) => {
    let body = "wake";
    try {
      const data = JSON.parse(event.data) as { time?: number; message?: string };
      if (typeof data.time === "number" && Date.now() / 1000 - data.time > MAX_MESSAGE_AGE_SECONDS) return;
      if (typeof data.message === "string") body = data.message.trim();
    } catch {
      // Unparseable -- treat as a plain wake, matching the old behaviour.
    }
    onMessage(body === "watch" ? "watch" : "wake");
  };
  source.onerror = (err) => {
    // EventSource auto-reconnects on its own after a transient error.
    console.warn("[override-wake] SSE connection error (will auto-retry):", err);
  };
  return () => source.close();
}
