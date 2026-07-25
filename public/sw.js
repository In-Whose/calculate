/* The service worker cache is intentionally separate from IndexedDB game data. */
// Original cache key: go-stop-shell-v1
const VERSION = "go-stop-shell-v1.0.0";
const base = new URL("./", self.registration.scope);
const shell = ["./", "./index.html", "./manifest.webmanifest", "./favicon.svg", "./og.png"].map((path) => new URL(path, base).href);

self.addEventListener("install", (event) => {
  // Original behavior called skipWaiting() immediately. Waiting lets the app
  // show an update notice before replacing the active shell.
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(shell)));
});

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== VERSION).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET" || new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        if (response.ok) caches.open(VERSION).then((cache) => cache.put(event.request, response.clone()));
        return response;
      }).catch(() => caches.match(new URL("./index.html", base).href));
    }),
  );
});
