const DEFAULT_ICON = "/icon.svg";
const DEFAULT_BADGE = "/icon.svg";

self.addEventListener("push", (event) => {
  let payload = { title: "Notification", body: "", icon: DEFAULT_ICON, badge: DEFAULT_BADGE, link: "/" };

  if (event.data) {
    try {
      const data = event.data.json();
      payload = {
        title: data.title || payload.title,
        body: data.body || "",
        icon: data.icon || DEFAULT_ICON,
        badge: data.badge || DEFAULT_BADGE,
        link: data.link || "/",
      };
    } catch {
      payload.body = event.data.text();
    }
  }

  const options = {
    body: payload.body,
    icon: payload.icon,
    badge: payload.badge,
    data: { link: payload.link },
  };

  event.waitUntil(self.registration.showNotification(payload.title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const targetUrl = new URL(event.notification.data?.link || "/", self.location.origin).href;

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url === targetUrl && "focus" in client) {
          return client.focus();
        }
      }
      return clients.openWindow(targetUrl);
    })
  );
});

self.addEventListener("pushsubscriptionchange", () => {
  event.waitUntil(
    self.registration.pushManager
      .subscribe({ userVisibleOnly: true, applicationServerKey: self.__VAPID_KEY })
      .then((subscription) => {
        const keys = subscription.toJSON().keys;
        return fetch("/api/push-subscriptions/subscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            endpoint: subscription.endpoint,
            p256dhKey: keys?.p256dh,
            authKey: keys?.auth,
          }),
        });
      })
      .catch(() => {})
  );
});
