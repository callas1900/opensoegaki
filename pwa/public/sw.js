/**
 * Hand-rolled service worker: offline app-shell cache for the OpenSoegaki
 * PWA. Stale-while-revalidate for same-origin GET requests inside this SW's
 * own scope; falls back to the cached shell for navigations when offline.
 *
 * User images and exported PNGs are never fetched over the network — they
 * live only in the page's in-memory Editor state (see src/editor/canvas.ts)
 * and never pass through this file. Nothing but the app shell's own static
 * assets is ever cached here.
 */

const VERSION = new URL(self.location.href).searchParams.get("v") ?? "dev";
const CACHE = "soegaki-v" + VERSION;

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // "./" resolves relative to this script's own URL, i.e. the deployed
      // base path (e.g. /opensoegaki/), not the origin root.
      await cache.add("./");
      self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names.filter((name) => name.startsWith("soegaki-v") && name !== CACHE).map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  // Only same-origin GET requests under this SW's own scope are ever
  // touched. Everything else (cross-origin requests, non-GET, blob:/data:
  // URLs) passes through to the network untouched.
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (!url.pathname.startsWith(new URL(self.registration.scope).pathname)) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(req);
      const network = fetch(req)
        .then((res) => {
          if (res.ok) void cache.put(req, res.clone());
          return res;
        })
        .catch(() => undefined);

      if (cached) {
        void network; // revalidate in the background; this response uses the cache immediately
        return cached;
      }
      const fresh = await network;
      if (fresh) return fresh;
      // Offline and nothing cached for this exact request: for a page
      // navigation, fall back to the cached app shell instead of a network
      // error.
      if (req.mode === "navigate") {
        const shell = await cache.match("./");
        if (shell) return shell;
      }
      return Response.error();
    })(),
  );
});
