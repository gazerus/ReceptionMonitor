/**
 * Listens for an admin viewer's "override wake" request via ntfy's
 * Server-Sent-Events stream -- a lightweight, always-open HTTP connection
 * rather than keeping the tablet connected to the Daily room 24/7 just to
 * make this reachable (tried once, reverted: too much Daily
 * participant-minutes usage for a rarely-used feature). Returns an
 * unsubscribe function.
 */
export function listenForOverrideWake(topicUrl: string, onWake: () => void): () => void {
  const source = new EventSource(`${topicUrl}/sse`);
  source.onmessage = () => onWake();
  source.onerror = (err) => {
    // EventSource auto-reconnects on its own after a transient error --
    // nothing to do here beyond logging, and definitely nothing worth
    // treating as fatal for the rest of the app.
    console.warn("[override-wake] SSE connection error (will auto-retry):", err);
  };
  return () => source.close();
}
