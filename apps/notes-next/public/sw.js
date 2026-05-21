// Bump on any strategy change so existing PWA installs pick it up and discard
// the previous cache (which used network-first and also cached API responses).
const CACHE_NAME = "notes-pwa-v2"

const PRECACHE_URLS = ["/", "/icons/icon-192x192.png", "/icons/icon-512x512.png"]

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name))),
      )
      .then(() => self.clients.claim()),
  )
})

self.addEventListener("fetch", (event) => {
  const request = event.request
  if (request.method !== "GET") return

  let url
  try {
    url = new URL(request.url)
  } catch {
    return
  }

  if (url.origin !== self.location.origin) return

  // Never cache API responses. The app has its own per-user data cache in
  // localStorage (see src/lib/notesCache.ts), so API calls must always hit the
  // network so the user sees the latest data.
  if (url.pathname.startsWith("/api/")) return

  // Stale-while-revalidate for the app shell (HTML, JS, CSS, fonts, icons).
  // Serving from cache immediately is what makes the PWA paint without waiting
  // on a network round-trip - especially important on flaky mobile networks
  // where network-first can take several seconds to fall back. The background
  // fetch keeps the cache fresh for the next launch.
  event.respondWith(
    caches.open(CACHE_NAME).then((cache) =>
      cache.match(request).then((cached) => {
        const networkFetch = fetch(request)
          .then((response) => {
            if (response && response.ok) {
              cache.put(request, response.clone())
            }
            return response
          })
          .catch(() => cached)
        return cached || networkFetch
      }),
    ),
  )
})
