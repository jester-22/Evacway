const PRECACHE_URLS = [];
const SHELL_CACHE = "evacway-app-shell-v2";
const CENTERS_CACHE = "evacway-public-centers-v2";
const MAP_TILES_CACHE = "evacway-public-map-tiles-v1";
const MAP_ASSETS_CACHE = "evacway-openfreemap-assets-v1";
const MAP_TILE_PATH = /^\/api\/public\/offline-map\/tiles\/(\d+)\/(\d+)\/(\d+)$/;
const MAX_MAP_TILES = 3000;
const MAX_MAP_BYTES = 50 * 1024 * 1024;
const MAP_ASSET_HOST = "tiles.openfreemap.org";
let mapTileWriteQueue = Promise.resolve();

function parsePushPayload(data) {
  if (!data) return {};
  try {
    return data.json();
  } catch {
    return { body: data.text() || "New EvacWay update." };
  }
}

function hasAuthorization(request) {
  return request.headers.has("Authorization") || request.headers.has("Cookie");
}

function responseWithHeaders(response, changes) {
  const headers = new Headers(response.headers);
  Object.entries(changes).forEach(([name, value]) => headers.set(name, String(value)));
  return new Response(response.clone().body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function announceSavedData(savedAt) {
  if (!savedAt) return;
  const pages = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  pages.forEach((page) => page.postMessage({ type: "evacway-saved-data", savedAt }));
}

async function refreshCenters(request, cache) {
  const networkRequest = new Request(request, { cache: "reload", credentials: "omit" });
  const response = await fetch(networkRequest);
  if (!response.ok) return response;

  let savedAt = response.headers.get("Date") || new Date().toISOString();
  try {
    const payload = await response.clone().json();
    if (payload.last_updated) savedAt = payload.last_updated;
  } catch {
    // Keep the HTTP response date when the public center payload is unavailable.
  }

  const cacheable = responseWithHeaders(response, { "X-EvacWay-Saved-At": savedAt });
  await cache.put(request, cacheable);
  await announceSavedData(savedAt);
  return response;
}

async function handlePublicCenters(request, event) {
  if (hasAuthorization(request)) return fetch(request);

  const cache = await caches.open(CENTERS_CACHE);
  const cached = await cache.match(request);
  if (cached) {
    const savedAt = cached.headers.get("X-EvacWay-Saved-At");
    if (savedAt) await announceSavedData(savedAt);
    event.waitUntil(refreshCenters(request, cache).catch(() => undefined));
    return cached;
  }

  return refreshCenters(request, cache);
}

function isSogodTileRequest(request) {
  if (request.method !== "GET" || hasAuthorization(request)) return false;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return false;
  const match = url.pathname.match(MAP_TILE_PATH);
  if (!match) return false;
  const [, zoom, x, y] = match.map(Number);
  if (zoom < 11 || zoom > 14 || x < 0 || y < 0 || x >= 2 ** zoom || y >= 2 ** zoom) return false;

  const tileX = (longitude, level) => Math.floor(((longitude + 180) / 360) * (2 ** level));
  const tileY = (latitude, level) => {
    const radians = (Math.max(-85.05112878, Math.min(85.05112878, latitude)) * Math.PI) / 180;
    return Math.floor(((1 - Math.asinh(Math.tan(radians)) / Math.PI) / 2) * (2 ** level));
  };
  const level = zoom;
  return x >= tileX(124.912, level) && x <= tileX(125.078, level)
    && y >= tileY(10.525, level) && y <= tileY(10.368, level);
}

async function tileCacheSize(cache, entries) {
  let total = 0;
  for (const request of entries) {
    const response = await cache.match(request);
    total += Number(response?.headers.get("X-EvacWay-Tile-Bytes") || 0);
  }
  return total;
}

async function storeMapTile(request, response) {
  if (!response.ok) return;
  const bytes = await response.clone().arrayBuffer();
  const size = bytes.byteLength;
  if (size > MAX_MAP_BYTES) return;

  const savedAt = new Date().toISOString();
  const cache = await caches.open(MAP_TILES_CACHE);
  let entries = await cache.keys();
  let currentBytes = await tileCacheSize(cache, entries);
  while (entries.length >= MAX_MAP_TILES || currentBytes + size > MAX_MAP_BYTES) {
    const oldest = entries.shift();
    if (!oldest) break;
    const oldResponse = await cache.match(oldest);
    currentBytes -= Number(oldResponse?.headers.get("X-EvacWay-Tile-Bytes") || 0);
    await cache.delete(oldest);
  }

  const cachedResponse = responseWithHeaders(response, {
    "X-EvacWay-Saved-At": savedAt,
    "X-EvacWay-Tile-Bytes": size,
  });
  await cache.put(request, cachedResponse);
  await announceSavedData(savedAt);
}

async function cacheTile(request, response) {
  mapTileWriteQueue = mapTileWriteQueue.then(() => storeMapTile(request, response));
  await mapTileWriteQueue;
}

async function handleMapTile(request, event) {
  const cache = await caches.open(MAP_TILES_CACHE);
  const cached = await cache.match(request);
  if (cached) {
    const savedAt = cached.headers.get("X-EvacWay-Saved-At");
    if (savedAt) await announceSavedData(savedAt);
    event.waitUntil(fetch(request).then((response) => cacheTile(request, response)).catch(() => undefined));
    return cached;
  }

  const response = await fetch(request);
  if (response.ok) await cacheTile(request, response.clone());
  return response;
}

function isOpenFreeMapAsset(request) {
  if (request.method !== "GET" || hasAuthorization(request)) return false;
  const url = new URL(request.url);
  return url.hostname === MAP_ASSET_HOST
    && !url.pathname.startsWith("/planet/")
    && (url.pathname === "/planet" || /^\/(styles|sprites|fonts)\//.test(url.pathname));
}

async function handleOpenFreeMapAsset(request, event) {
  const cache = await caches.open(MAP_ASSETS_CACHE);
  const cached = await cache.match(request);
  if (cached) {
    event.waitUntil(fetch(request).then(async (response) => {
      if (response.ok) await cache.put(request, response.clone());
    }).catch(() => undefined));
    return cached;
  }
  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    if (PRECACHE_URLS.length) {
      const cache = await caches.open(SHELL_CACHE);
      await cache.addAll(PRECACHE_URLS);
    }
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keep = new Set([SHELL_CACHE, CENTERS_CACHE, MAP_TILES_CACHE, MAP_ASSETS_CACHE]);
    const names = await caches.keys();
    await Promise.all(names
      .filter((name) => name.startsWith("evacway-") && !keep.has(name))
      .map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== "GET") return;

  if (url.origin === self.location.origin && PRECACHE_URLS.includes(url.pathname)) {
    event.respondWith((async () => {
      const shell = await caches.open(SHELL_CACHE);
      const cached = await shell.match(request, { ignoreVary: true });
      if (cached) return cached;
      return fetch(request);
    })());
    return;
  }

  if (url.origin === self.location.origin && url.pathname === "/api/public/offline-centers") {
    event.respondWith(handlePublicCenters(request, event));
    return;
  }

  if (isSogodTileRequest(request)) {
    event.respondWith(handleMapTile(request, event));
    return;
  }

  if (isOpenFreeMapAsset(request)) {
    event.respondWith(handleOpenFreeMapAsset(request, event));
    return;
  }

  if (url.origin === self.location.origin && request.mode === "navigate") {
    event.respondWith(fetch(request).catch(async () => {
      const shell = await caches.open(SHELL_CACHE);
      const cached = await shell.match("/index.html");
      return cached || Response.error();
    }));
  }
});

self.addEventListener("push", (event) => {
  const payload = parsePushPayload(event.data);
  const isEmergency = Boolean(payload.emergency);
  event.waitUntil(Promise.all([
    self.registration.showNotification(payload.title || "EvacWay", {
      body: payload.body || "There is a new dashboard notification.",
      icon: "/evacway-app.png",
      badge: "/evacway-app.png",
      tag: payload.notificationId ? `evacway-${payload.notificationId}` : "evacway-update",
      requireInteraction: isEmergency,
      vibrate: isEmergency ? [300, 120, 300, 120, 400] : [200, 100, 200],
      data: { url: payload.url || "/" },
    }),
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      clients.forEach((client) => {
        client.postMessage({
          type: "evacway-push-notification",
          notificationId: payload.notificationId || null,
          resource_type: payload.resourceType || null,
          event_type: payload.eventType || null,
          is_emergency: isEmergency,
        });
      });
    }),
  ]));
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
