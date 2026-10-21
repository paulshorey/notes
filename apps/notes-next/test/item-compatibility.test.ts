import assert from "node:assert/strict"
import { test } from "node:test"
import { NextRequest } from "next/server"
import {
  createFakeItemsAppService,
  sampleApiToken,
} from "@lib/db-items/testing/items-api-adapter-suite"
import {
  createItemsRouteHandlers,
  createCategoriesRouteHandlers,
  createStatusesRouteHandlers,
  createWorkspacesRouteHandlers,
} from "../app/api/_lib/items-app-route-handlers"
import { legacyNoteHandler } from "../app/api/_lib/legacy-note-contract"
import { readItemsUserId } from "../src/lib/sessionIdentity"
import { createBackupRouteHandlers } from "../app/api/_lib/backup-route-handlers"
import { backupFixture } from "@lib/db-items/testing/user-backup-fixture"
import { parseUserBackup } from "@lib/db-items/contracts/user-backup"

test("legacy note writes and canonical item reads reach the same authenticated item service", async () => {
  const received: unknown[] = []
  const base = createFakeItemsAppService()
  const handlers = createItemsRouteHandlers(
    createFakeItemsAppService({
      createItemForItemsApp: async (input) => {
        received.push(input)
        const result = await base.createItemForItemsApp(input)
        return { item: { ...result.item, description: input.item.description } }
      },
    }),
  )
  const legacy = await legacyNoteHandler(handlers.POST)(
    new Request("https://test/api/notes", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${sampleApiToken}` },
      body: JSON.stringify({
        userId: 999,
        note: { workspaceId: 3, description: "A note", categoryIds: [], tagIds: [] },
      }),
    }),
  )
  const payload = await legacy.json()
  assert.equal(legacy.status, 201)
  assert.equal(payload.note.description, "A note")
  assert.equal(payload.item, undefined)
  assert.equal((received[0] as { userId: number }).userId, 7)
  const canonical = await handlers.GET(
    new NextRequest("https://test/api/items?workspaceId=3", {
      headers: { authorization: `Bearer ${sampleApiToken}` },
    }),
  )
  assert.ok(Array.isArray((await canonical.json()).items))
})

test("common vocabulary routes preserve old counts while exposing a canonical item contract", async () => {
  const handlers = createCategoriesRouteHandlers(createFakeItemsAppService())
  const request = (canonical: boolean) =>
    new NextRequest("https://test/api/categories?workspaceId=3", {
      headers: {
        authorization: `Bearer ${sampleApiToken}`,
        ...(canonical ? { "x-items-contract": "1" } : {}),
      },
    })
  const old = await (await handlers.GET(request(false))).json()
  assert.equal(old.categories[0].noteCount, old.categories[0].itemCount)
  const current = await (await handlers.GET(request(true))).json()
  assert.equal(typeof current.categories[0].itemCount, "number")
  assert.equal(current.categories[0].noteCount, undefined)
})

test("old signed session identities stay valid and canonical identity takes precedence", () => {
  assert.equal(readItemsUserId({ notesUserId: 41 }), 41)
  assert.equal(readItemsUserId({ itemsUserId: 42, notesUserId: 41 }), 42)
  assert.equal(readItemsUserId({ notesUserId: "41" }), null)
})

test("an older web build downloads a version-one backup that the new backend still imports", async () => {
  const handlers = createBackupRouteHandlers(
    createFakeItemsAppService({ exportUserBackup: async () => backupFixture() }),
  )
  const response = await handlers.GET(
    new Request("https://test/api/backup", {
      headers: { authorization: `Bearer ${sampleApiToken}` },
    }),
  )
  assert.equal(response.status, 200)
  const legacy = await response.json()
  assert.equal(legacy.version, 1)
  assert.ok(Array.isArray(legacy.workspaces[0].notes))
  assert.deepEqual(parseUserBackup(legacy), backupFixture())
})

test("timeout-bound client requests select item payloads while retaining authorization", async () => {
  const { fetchWithTimeout } = await import("../src/lib/api")
  const originalFetch = globalThis.fetch
  let headers: Headers | undefined
  globalThis.fetch = async (_input, init) => {
    headers = new Headers(init?.headers)
    return Response.json({ version: 2 })
  }
  try {
    const response = await fetchWithTimeout("https://test/api/backup", {
      headers: { authorization: `Bearer ${sampleApiToken}` },
    })
    assert.equal(response.status, 200)
    assert.equal(headers?.get("x-items-contract"), "1")
    assert.equal(headers?.get("authorization"), `Bearer ${sampleApiToken}`)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("legacy PATCH and DELETE translate streamed Next.js requests and retain authenticated IDs", async () => {
  const calls: { method: string; itemId: number; userId: number }[] = []
  const base = createFakeItemsAppService()
  const handlers = createItemsRouteHandlers(
    createFakeItemsAppService({
      updateItemForItemsApp: async (request) => {
        calls.push({ method: "PATCH", itemId: request.itemId, userId: request.userId })
        return base.updateItemForItemsApp(request)
      },
      deleteItemForItemsApp: async (request) => {
        calls.push({ method: "DELETE", itemId: request.itemId, userId: request.userId })
        return base.deleteItemForItemsApp(request)
      },
    }),
  )
  for (const method of ["PATCH", "DELETE"] as const) {
    const body = JSON.stringify({
      userId: 999,
      noteId: 41,
      ...(method === "PATCH"
        ? { note: { workspaceId: 3, categoryIds: [], tagIds: [], description: null } }
        : {}),
    })
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(body))
        controller.close()
      },
    })
    const request = new NextRequest("https://test/api/notes", {
      method,
      body: stream,
      headers: {
        "content-type": "application/json",
        "content-length": String(Buffer.byteLength(body)),
        authorization: `Bearer ${sampleApiToken}`,
      },
    })
    const response = await legacyNoteHandler(handlers[method])(request)
    assert.equal(response.status, 200, JSON.stringify(await response.json()))
  }
  assert.deepEqual(calls, [
    { method: "PATCH", itemId: 41, userId: 7 },
    { method: "DELETE", itemId: 41, userId: 7 },
  ])
})

for (const { path, createHandlers, singular, plural } of [
  {
    path: "statuses",
    createHandlers: createStatusesRouteHandlers,
    singular: "status",
    plural: "statuses",
  },
  {
    path: "workspaces",
    createHandlers: createWorkspacesRouteHandlers,
    singular: "workspace",
    plural: "workspaces",
  },
]) {
  for (const method of ["GET", "POST"] as const) {
    for (const canonical of [false, true]) {
      test(`${method} /api/${path} preserves ${canonical ? "canonical item" : "legacy note"} counts`, async () => {
        const handlers = createHandlers(createFakeItemsAppService())
        const response = await handlers[method](
          new NextRequest(`https://test/api/${path}?workspaceId=3`, {
            method,
            headers: {
              authorization: `Bearer ${sampleApiToken}`,
              ...(canonical ? { "x-items-contract": "1" } : {}),
              ...(method === "POST" ? { "content-type": "application/json" } : {}),
            },
            ...(method === "POST"
              ? { body: JSON.stringify({ userId: 999, workspaceId: 3, label: "project" }) }
              : {}),
          }),
        )
        assert.equal(response.status, method === "POST" ? 201 : 200)
        const payload = await response.json()
        const record = method === "GET" ? payload[plural][0] : payload[singular]
        assert.equal(typeof record.itemCount, "number")
        assert.equal(record.noteCount, canonical ? undefined : record.itemCount)
        assert.ok(response.headers.get("vary")?.includes("X-Items-Contract"))
      })
    }
  }
}
