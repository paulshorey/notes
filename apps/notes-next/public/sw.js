// This worker deliberately does not cache the Next.js app shell. HTML and
// `/_next/*` files must come from the same deployment; mixing a cached document
// with another build's chunks can leave the app permanently unbootable.
const CACHE_NAME = "notes-pwa-v3"
const CACHE_PREFIX = "notes-pwa-"
const STATIC_URLS = ["/icons/icon-192x192.png", "/icons/icon-512x512.png"]
const DEVELOPMENT_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"])
const IS_LOCAL_DEVELOPMENT = DEVELOPMENT_HOSTS.has(self.location.hostname)

self.addEventListener("install", (event) => {
  event.waitUntil(
    (IS_LOCAL_DEVELOPMENT
      ? Promise.resolve()
      : caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_URLS))
    ).then(() => self.skipWaiting()),
  )
})

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
            .map((name) => caches.delete(name)),
        ),
      )
      .then(async () => {
        if (IS_LOCAL_DEVELOPMENT) {
          await caches.delete(CACHE_NAME)
          await self.registration.unregister()
          return
        }
        await self.clients.claim()
      }),
  )
})

self.addEventListener("fetch", (event) => {
  if (IS_LOCAL_DEVELOPMENT) return

  const request = event.request
  if (request.method !== "GET") return

  let url
  try {
    url = new URL(request.url)
  } catch {
    return
  }

  if (url.origin !== self.location.origin) return

  // Navigation, API, and build output always use the normal network/browser
  // cache path. Next.js gives immutable production chunks content-based names,
  // while the document points at one exact set of those names.
  if (
    request.mode === "navigate" ||
    url.pathname === "/" ||
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/_next/")
  ) {
    return
  }

  if (!STATIC_URLS.includes(url.pathname)) return

  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(request)
      if (cached) return cached

      const response = await fetch(request)
      if (response.ok) {
        event.waitUntil(cache.put(request, response.clone()))
      }
      return response
    }),
  )
})
