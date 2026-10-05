const CACHE_NAME = "evacway-shell-v1";
const SHELL_URLS = ["/", "/manifest.webmanifest", "/evacway-icon.svg"];

function parsePushPayload(data) {
  if (!data) return {};
  try {
    return data.json();
  } catch {
    return { body: data.text() || "New EvacWay update." };
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_URLS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
    ))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) {
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match("/")));
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request).then((response) => {
      if (response.ok) {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
      }
      return response;
    }))
  );
});

self.addEventListener("push", (event) => {
  const payload = parsePushPayload(event.data);

  event.waitUntil(self.registration.showNotification(payload.title || "EvacWay", {
    body: payload.body || "There is a new dashboard notification.",
    icon: "/evacway-icon.svg",
    badge: "/evacway-icon.svg",
    tag: payload.notificationId ? `evacway-${payload.notificationId}` : "evacway-update",
    requireInteraction: Boolean(payload.emergency),
    data: { url: payload.url || "/" },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "/", self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
    const existing = clients.find((client) => new URL(client.url).origin === self.location.origin);
    if (existing) {
      return existing.navigate(target).then((client) => client.focus());
    }
    return self.clients.openWindow(target);
  }));
});