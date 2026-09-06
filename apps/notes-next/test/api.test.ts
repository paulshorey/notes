import assert from "node:assert/strict"
import test from "node:test"
import { fetchWithTimeout, readJson, RequestError } from "../src/lib/api"

test("readJson preserves the response status on request failures", async () => {
  await assert.rejects(
    readJson(new Response(JSON.stringify({ error: "Temporarily unavailable." }), { status: 503 })),
    (error: unknown) => {
      assert.ok(error instanceof RequestError)
      assert.equal(error.message, "Temporarily unavailable.")
      assert.equal(error.status, 503)
      return true
    },
  )
})

test("readJson returns successful JSON payloads", async () => {
  const result = await readJson<{ ok: true }>(
    new Response(JSON.stringify({ ok: true }), { status: 200 }),
  )

  assert.deepEqual(result, { ok: true })
})

test("fetchWithTimeout turns a stalled request into a retryable deadline error", async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = (_input, init) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () =>
        reject(new DOMException("Aborted", "AbortError")),
      )
    })

  try {
    await assert.rejects(fetchWithTimeout("https://example.test", {}, 1), (error: unknown) => {
      assert.ok(error instanceof RequestError)
      assert.equal(error.status, 408)
      assert.match(error.message, /too long/i)
      return true
    })
  } finally {
    globalThis.fetch = originalFetch
  }
})
