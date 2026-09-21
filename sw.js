const CACHE_PREFIX = "bellbrook-floodwatch-";
const CACHE = CACHE_PREFIX + "v6-2026.09.22.13";
const CORE = ["./", "./index.html", "./about.html", "./icon-192.png", "./icon-512.png", "./manifest.webmanifest"];

async function fetchWithDeadline(request, timeoutMs = 6000) {
  const controller = new AbortController();
  let timer;
  try {
    return await Promise.race([
      fetch(request, { cache: "no-store", signal: controller.signal }).then(async response => {
        // Include the response body in the deadline, not just its headers.
        await response.clone().arrayBuffer();
        return response;
      }),
      new Promise((resolve, reject) => {
        timer = setTimeout(() => {
          reject(new Error("App request timed out."));
          controller.abort();
        }, timeoutMs);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.all(CORE.map(async path => {
      const url = new URL(path, self.registration.scope).href;
      const response = await fetchWithDeadline(url, 12000);
      if (!response.ok) throw new Error("App download HTTP " + response.status);
      await cache.put(url, response);
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener("message", event => {
  if (event.data && event.data.type === "SKIP_WAITING") event.waitUntil(self.skipWaiting());
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  const scope = new URL(self.registration.scope);
  // Gauge requests use the page's own deadline and are never cached as live data.
  if (url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return;
  const cacheKey = url.origin + url.pathname;
  const isCamera = url.pathname.includes("/camera/");
  event.respondWith((async () => {
    try {
      const response = await fetchWithDeadline(isCamera ? new Request(event.request, { cache: "no-store" }) : event.request);
      if (!response.ok) throw new Error("App request HTTP " + response.status);
      if (!isCamera) {
        const copy = response.clone();
        await caches.open(CACHE).then(cache => cache.put(cacheKey, copy)).catch(() => {});
      }
      return response;
    } catch (error) {
      if (!isCamera) {
        const cache = await caches.open(CACHE);
        const saved = await cache.match(cacheKey);
        if (saved) return saved;
      }
      return new Response("Floodwatch is offline. Reconnect and reload.", {
        status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" }
      });
    }
  })());
});
