// Shows the daily reminders and opens the app when one is tapped.
self.addEventListener("push", event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = { title: "Yeti", body: event.data && event.data.text() }; }
  event.waitUntil(self.registration.showNotification(data.title || "Yeti", {
    body: data.body || "",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    tag: data.tag || "daily-plan",
    renotify: !!data.renotify,
    requireInteraction: !!data.requireInteraction,
    vibrate: data.vibrate,
    data: { url: data.url || "/" },
  }));
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  event.waitUntil((async () => {
    const url = (event.notification.data && event.notification.data.url) || "/";
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const w of wins) if ("focus" in w) { if (url !== "/" && "navigate" in w) await w.navigate(url).catch(() => {}); return w.focus(); }
    return self.clients.openWindow(url);
  })());
});

// The phone can replace its push subscription (or let it expire). Register the new one straight
// away, keeping this phone's reminder settings, so reminders don't silently stop.
self.addEventListener("pushsubscriptionchange", event => {
  event.waitUntil((async () => {
    const old = event.oldSubscription;
    const key = old && old.options && old.options.applicationServerKey;
    const sub = event.newSubscription || (key ? await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }) : null);
    if (!sub) return;
    await fetch("/api/push", {
      method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subscription: sub.toJSON(), oldEndpoint: old ? old.endpoint : undefined, refresh: true }),
    });
  })());
});
