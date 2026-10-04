import assert from "node:assert/strict"
import { test } from "node:test"
import { createBackupRouteHandlers } from "../app/api/_lib/backup-route-handlers"
import {
  createFakeNotesAppService,
  sampleApiToken,
} from "@lib/db-notes/testing/notes-api-adapter-suite"
import { backupFixture } from "@lib/db-notes/testing/user-backup-fixture"
import { USER_BACKUP_MAX_BYTES } from "@lib/db-notes/contracts/user-backup"
import { BackupAccountError } from "@lib/db-notes/services/notes-app"

const request = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("http://notes.test/api/backup", {
    method: "POST",
    body: JSON.stringify(body),
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${sampleApiToken}`,
      ...headers,
    },
  })
const sampleUser = (await createFakeNotesAppService().getNotesAppSession({ userId: 1 }))!.user

test("backup authentication derives identity from cookie or token and exports a private attachment", async () => {
  let exportedUser: number | undefined
  const service = createFakeNotesAppService({
    exportUserBackup: async (id) => {
      exportedUser = id
      return backupFixture()
    },
  })
  const handlers = createBackupRouteHandlers(service)
  assert.equal(
    (await handlers.GET(new Request("http://notes.test/api/backup?userId=999"))).status,
    401,
  )
  const result = await handlers.GET(
    new Request("http://notes.test/api/backup?userId=999", {
      headers: { Authorization: `Bearer ${sampleApiToken}` },
    }),
  )
  assert.equal(exportedUser, sampleUser.id)
  assert.equal(result.status, 200)
  assert.equal(result.headers.get("cache-control"), "no-store")
  assert.match(result.headers.get("content-disposition")!, /attachment; filename=".*\.json"/)
  assert.deepEqual(await result.json(), backupFixture())
  await createBackupRouteHandlers(service, async () => 27).GET(
    new Request("http://notes.test/api/backup"),
  )
  assert.equal(exportedUser, 27)
})

test("restore validates before service call and ignores uploaded or query-string user ids", async () => {
  const calls: unknown[] = []
  const handlers = createBackupRouteHandlers(
    createFakeNotesAppService({
      restoreUserBackup: async (id, file) => {
        calls.push([id, file])
        return { notesImported: 1, notesSkipped: 0 }
      },
    }),
  )
  assert.equal((await handlers.POST(request({ ...backupFixture(), userId: 999 }))).status, 200)
  assert.deepEqual(calls, [[sampleUser.id, backupFixture()]])
  assert.equal((await handlers.POST(request({ version: 99 }))).status, 400)
  assert.equal(calls.length, 1)
  assert.equal(
    (await handlers.POST(request(backupFixture(), { Authorization: "Bearer invalid" }))).status,
    401,
  )
  assert.equal(
    (await handlers.POST(request(backupFixture(), { "Content-Type": "text/plain" }))).status,
    415,
  )
  assert.equal(
    (await handlers.POST(request(backupFixture(), { "Content-Type": "application/jsonp" }))).status,
    415,
  )
  assert.equal(
    (
      await handlers.POST(
        new Request("http://notes.test/api/backup", {
          method: "POST",
          body: "invalid JSON",
          headers: {
            Authorization: `Bearer ${sampleApiToken}`,
            "Content-Type": "application/json",
          },
        }),
      )
    ).status,
    400,
  )
})

test("restore rejects invalid UTF-8 instead of silently replacing note text", async () => {
  let calls = 0
  const handlers = createBackupRouteHandlers(
    createFakeNotesAppService({
      restoreUserBackup: async () => {
        calls++
        return { notesImported: 1, notesSkipped: 0 }
      },
    }),
  )
  const bytes = Buffer.from(JSON.stringify(backupFixture()))
  bytes[bytes.indexOf("Backed up")] = 255
  const result = await handlers.POST(
    new Request("http://notes.test/api/backup", {
      method: "POST",
      body: new Uint8Array(bytes),
      headers: { Authorization: `Bearer ${sampleApiToken}`, "Content-Type": "application/json" },
    }),
  )
  assert.equal(result.status, 400)
  assert.equal(calls, 0)
})

test("export refuses an attachment too large for a later restore", async () => {
  const file = backupFixture()
  file.workspaces[0]!.notes[0]!.description = "a".repeat(USER_BACKUP_MAX_BYTES)
  const handlers = createBackupRouteHandlers(
    createFakeNotesAppService({ exportUserBackup: async () => file }),
  )
  const result = await handlers.GET(
    new Request("http://notes.test/api/backup", {
      headers: { Authorization: `Bearer ${sampleApiToken}` },
    }),
  )
  assert.equal(result.status, 413)
  assert.equal(result.headers.get("content-disposition"), null)
})

test("restore enforces actual streamed size even without Content-Length", async () => {
  const handlers = createBackupRouteHandlers(createFakeNotesAppService())
  let sent = 0
  let cancelled = false
  const body = new ReadableStream({
    pull(controller) {
      sent++
      controller.enqueue(new Uint8Array(1024 * 1024))
      if (sent > 50) controller.close()
    },
    cancel() {
      cancelled = true
    },
  })
  const init = {
    method: "POST",
    body,
    duplex: "half",
    headers: { Authorization: `Bearer ${sampleApiToken}`, "Content-Type": "application/json" },
  }
  const result = await handlers.POST(
    new Request("http://notes.test/api/backup", init as RequestInit),
  )
  assert.equal(result.status, 413)
  // Cancellation may be unnecessary when the stream already closed at 51 MB.
  assert.ok(cancelled || sent === 51)
  assert.equal(
    (
      await handlers.POST(
        request(backupFixture(), { "Content-Length": String(USER_BACKUP_MAX_BYTES + 1) }),
      )
    ).status,
    413,
  )
})

test("backup errors keep credentials and SQL private and return useful status codes", async () => {
  for (const [error, expected] of [
    [new BackupAccountError("Sign in first.", 403), 403],
    [new Error("SQL failure: postgres://secret:password@host"), 500],
  ] as const) {
    const handlers = createBackupRouteHandlers(
      createFakeNotesAppService({
        restoreUserBackup: async () => {
          throw error
        },
      }),
    )
    const result = await handlers.POST(request(backupFixture()))
    assert.equal(result.status, expected)
    assert.equal((await result.text()).includes("password@host"), false)
  }
})
