export const isPushSupported = (): boolean =>
  typeof navigator !== "undefined" &&
  "serviceWorker" in navigator &&
  "PushManager" in window;

export const getPermissionState = (): NotificationPermission =>
  Notification.permission;

export const registerServiceWorker = async (): Promise<ServiceWorkerRegistration> =>
  navigator.serviceWorker.register("/push-sw.js", { scope: "/" });

export const urlBase64ToUint8Array = (base64String: string): Uint8Array => {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
};

export const subscribeToPush = async (
  registration: ServiceWorkerRegistration,
  vapidPublicKey: string,
): Promise<PushSubscription> =>
  registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) as Uint8Array<ArrayBuffer>,
  });

export const unsubscribeFromPush = async (
  subscription: PushSubscription,
): Promise<boolean> => subscription.unsubscribe();

const arrayBufferToBase64 = (buffer: ArrayBuffer | null): string => {
  if (!buffer) return "";
  return btoa(String.fromCharCode(...new Uint8Array(buffer)));
};

export const serializeSubscription = (
  subscription: PushSubscription,
): { endpoint: string; p256dhKey: string; authKey: string } => ({
  endpoint: subscription.endpoint,
  p256dhKey: arrayBufferToBase64(subscription.getKey("p256dh")),
  authKey: arrayBufferToBase64(subscription.getKey("auth")),
});
