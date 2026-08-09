// Service Worker
const CACHE_NAME = "piotrunius-bio-v4";
const urlsToCache = [
  "/",
  "/index.html",
  "/styles.css",
  "/app.js",
  "/manifest.json",
  "/assets/pfp.png",
  "/assets/nobara-icon.png",
];

self.addEventListener("install", (event) => {
  console.log("[SW] install");
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => {
        console.log("[SW] cache assets");
        return cache.addAll(urlsToCache);
      })
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  console.log("[SW] activate");
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => {
            if (cacheName !== CACHE_NAME) {
              console.log("[SW] delete old cache:", cacheName);
              return caches.delete(cacheName);
            }
          }),
        );
      })
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (url.origin !== location.origin) {
    return;
  }

  // We cannot cache non-GET requests (e.g. POST to Cloudflare Analytics)
  if (request.method !== "GET") {
    return;
  }

  if (url.pathname.includes("/data/")) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, responseClone);
          });
          return response;
        })
        .catch(() => {
          return caches.match(request).then((cachedResponse) => {
            return (
              cachedResponse ||
              new Response(JSON.stringify({ error: "Offline", cached: true }), {
                headers: { "Content-Type": "application/json" },
              })
            );
          });
        }),
    );
    return;
  }

  if (request.mode === "navigate" || request.destination === "document") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const responseClone = response.clone();
          caches
            .open(CACHE_NAME)
            .then((cache) => cache.put(request, responseClone));
          return response;
        })
        .catch(() =>
          caches
            .match(request)
            .then(
              (cachedResponse) =>
                cachedResponse || new Response("Offline", { status: 503 }),
            ),
        ),
    );
    return;
  }

  event.respondWith(
    caches
      .match(request)
      .then((cachedResponse) => {
        if (cachedResponse) {
          fetch(request)
            .then((response) => {
              caches
                .open(CACHE_NAME)
                .then((cache) => {
                  cache.put(request, response);
                })
                .catch((error) => {
                  console.warn("[SW] Cache update failed:", error);
                });
            })
            .catch(() => {}); // Silently fail if network is unavailable

          return cachedResponse;
        }

        return fetch(request).then((response) => {
          if (!response || response.status !== 200) {
            return response;
          }

          const responseClone = response.clone();

          caches
            .open(CACHE_NAME)
            .then((cache) => {
              cache.put(request, responseClone);
            })
            .catch((error) => {
              console.warn("[SW] Failed to cache response:", error);
            });

          return response;
        });
      })
      .catch(() => new Response("Offline", { status: 503 })),
  );
});

// Message event
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});
