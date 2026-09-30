"use client"

import { useEffect } from "react"

export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return

    const configureServiceWorker = async () => {
      const isLocalHost = ["localhost", "127.0.0.1", "[::1]"].includes(
        window.location.hostname,
      )

      if (isLocalHost) {
        // An older worker can keep controlling localhost even after registration
        // is removed from the app. Clean it up explicitly so dev HTML, chunks,
        // and Turbopack's HMR client always come from the running dev server.
        const registrations = await navigator.serviceWorker.getRegistrations()
        await Promise.all(
          registrations
            .filter((registration) => registration.scope.startsWith(window.location.origin))
            .map((registration) => registration.unregister()),
        )

        if ("caches" in window) {
          const cacheNames = await window.caches.keys()
          await Promise.all(
            cacheNames
              .filter((name) => name.startsWith("notes-pwa-"))
              .map((name) => window.caches.delete(name)),
          )
        }
        return
      }

      const registration = await navigator.serviceWorker.register("/sw.js", {
        updateViaCache: "none",
      })
      await registration.update()
    }

    void configureServiceWorker().catch(() => {
      // PWA installation is optional. A registration or cleanup failure must
      // never block the web app from starting.
    })
  }, [])

  return null
}
