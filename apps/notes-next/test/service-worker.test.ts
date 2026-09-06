import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"
import vm from "node:vm"

type WorkerEvent = {
  request?: { method: string; mode: string; url: string }
  respondWith?: (response: Promise<Response>) => void
  waitUntil: (work: Promise<unknown>) => void
}

const workerSource = await readFile(new URL("../public/sw.js", import.meta.url), "utf8")

const createWorkerHarness = (origin: string) => {
  const listeners = new Map<string, (event: WorkerEvent) => void>()
  const deletedCaches: string[] = []
  const addedUrls: string[][] = []
  let unregisterCalls = 0
  let claimCalls = 0
  let skipWaitingCalls = 0

  const cache = {
    addAll: async (urls: string[]) => {
      addedUrls.push([...urls])
    },
    match: async () => new Response("cached icon"),
    put: async () => undefined,
  }

  vm.runInNewContext(workerSource, {
    URL,
    Promise,
    Set,
    caches: {
      delete: async (name: string) => {
        deletedCaches.push(name)
        return true
      },
      keys: async () => ["unrelated-cache", "notes-pwa-v1", "notes-pwa-v2", "notes-pwa-v3"],
      open: async () => cache,
    },
    fetch: async () => new Response("network response"),
    self: {
      clients: {
        claim: async () => {
          claimCalls += 1
        },
      },
      location: new URL(origin),
      registration: {
        unregister: async () => {
          unregisterCalls += 1
          return true
        },
      },
      skipWaiting: async () => {
        skipWaitingCalls += 1
      },
      addEventListener: (type: string, listener: (event: WorkerEvent) => void) => {
        listeners.set(type, listener)
      },
    },
  })

  const dispatchLifetimeEvent = async (type: "install" | "activate") => {
    let lifetime: Promise<unknown> | undefined
    listeners.get(type)?.({
      waitUntil(work) {
        lifetime = work
      },
    })
    await lifetime
  }

  const dispatchFetch = async (request: NonNullable<WorkerEvent["request"]>) => {
    let response: Promise<Response> | undefined
    const lifetime: Promise<unknown>[] = []
    listeners.get("fetch")?.({
      request,
      respondWith(value) {
        response = value
      },
      waitUntil(work) {
        lifetime.push(work)
      },
    })
    if (response) await response
    await Promise.all(lifetime)
    return Boolean(response)
  }

  return {
    addedUrls,
    deletedCaches,
    dispatchFetch,
    dispatchLifetimeEvent,
    get claimCalls() {
      return claimCalls
    },
    get skipWaitingCalls() {
      return skipWaitingCalls
    },
    get unregisterCalls() {
      return unregisterCalls
    },
  }
}

test("localhost worker unregisters and never intercepts requests", async () => {
  const worker = createWorkerHarness("http://localhost:3000")

  await worker.dispatchLifetimeEvent("install")
  await worker.dispatchLifetimeEvent("activate")

  assert.equal(worker.skipWaitingCalls, 1)
  assert.equal(worker.unregisterCalls, 1)
  assert.equal(worker.claimCalls, 0)
  assert.deepEqual(worker.addedUrls, [])
  assert.deepEqual(worker.deletedCaches.sort(), ["notes-pwa-v1", "notes-pwa-v2", "notes-pwa-v3"])
  assert.equal(
    await worker.dispatchFetch({
      method: "GET",
      mode: "navigate",
      url: "http://localhost:3000/",
    }),
    false,
  )
})

test("production worker never intercepts HTML, API, or Next.js chunks", async () => {
  const worker = createWorkerHarness("https://notes.example")

  await worker.dispatchLifetimeEvent("install")
  await worker.dispatchLifetimeEvent("activate")

  assert.deepEqual(worker.addedUrls, [
    ["/icons/icon-192x192.png", "/icons/icon-512x512.png"],
  ])
  assert.deepEqual(worker.deletedCaches.sort(), ["notes-pwa-v1", "notes-pwa-v2"])
  assert.equal(worker.claimCalls, 1)

  for (const request of [
    { method: "GET", mode: "navigate", url: "https://notes.example/" },
    { method: "GET", mode: "cors", url: "https://notes.example/api/bootstrap" },
    {
      method: "GET",
      mode: "cors",
      url: "https://notes.example/_next/static/chunks/current.js",
    },
  ]) {
    assert.equal(await worker.dispatchFetch(request), false)
  }

  assert.equal(
    await worker.dispatchFetch({
      method: "GET",
      mode: "no-cors",
      url: "https://notes.example/icons/icon-192x192.png",
    }),
    true,
  )
})
