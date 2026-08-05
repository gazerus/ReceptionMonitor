function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const output = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    output[i] = rawData.charCodeAt(i);
  }
  return output;
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;
  return navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`);
}

/**
 * Requests notification permission (if needed), subscribes to push via the
 * service worker, and registers the subscription with the server so the
 * doorbell notify endpoint has somewhere to send to. Returns whether the
 * viewer is now subscribed.
 */
export async function subscribeToPush(
  registration: ServiceWorkerRegistration,
  vapidPublicKey: string,
  subscribeUrl: string,
  email: string,
): Promise<boolean> {
  if (!("PushManager" in window)) return false;

  if (Notification.permission !== "granted") {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return false;
  }

  const existing = await registration.pushManager.getSubscription();
  const subscription =
    existing ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) as BufferSource,
    }));

  await fetch(subscribeUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, subscription: subscription.toJSON() }),
  });

  return true;
}
