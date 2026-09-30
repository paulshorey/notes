import assert from "node:assert/strict"
import test from "node:test"
import { createFakeNotesAppService } from "@lib/db-notes/testing/notes-api-adapter-suite"
import { createBootstrapRouteHandler } from "../app/api/_lib/bootstrap-route-handler"
import { readJson, RequestError } from "../src/lib/api"
import { readOpenNotesSnapshot, writeOpenNotesSnapshot } from "../src/lib/openNotesStorage"
import { clearNotesCache } from "../src/lib/notesCache"
import { useNotesAppStore } from "../src/stores/notesAppStore"
import { recoverExpiredSession } from "../src/lib/sessionRecovery"

const request = () => new Request("https://notes.test/api/bootstrap")

test("a deleted cookie user returns 401 without attempting workspace creation", async () => {
  let workspaceCalls = 0
  const service = createFakeNotesAppService({
    getNotesAppSession: async ({ userId }) => {
      assert.equal(userId, 331)
      return null
    },
    listWorkspacesForNotesApp: async () => {
      workspaceCalls += 1
      throw new Error("user_workspace_v1_user_id_fkey")
    },
  })
  const response = await createBootstrapRouteHandler(service, async () => 331)(request())

  assert.equal(response.status, 401)
  assert.equal(workspaceCalls, 0, "a deleted user must never reach the workspace insert")
  assert.deepEqual(await response.json(), { error: "The session is no longer valid." })
})

test("a deleted session recovers through the real bootstrap response and client error parser", async () => {
  const service = createFakeNotesAppService({ getNotesAppSession: async () => null })
  const response = await createBootstrapRouteHandler(service, async () => 331)(request())
  const events: string[] = []
  try {
    await readJson(response)
    assert.fail("the deleted session must be rejected")
  } catch (error) {
    assert.equal(
      await recoverExpiredSession(error, {
        persistDrafts: () => {
          events.push("persist drafts")
        },
        resetSession: () => {
          events.push("reset session")
        },
        signOut: async () => {
          events.push("sign out")
        },
      }),
      true,
    )
  }
  assert.deepEqual(events, ["persist drafts", "reset session", "sign out"])
})

test("a valid user loads bootstrap data after session validation", async () => {
  const service = createFakeNotesAppService()
  const getSession = service.getNotesAppSession
  const listWorkspaces = service.listWorkspacesForNotesApp
  let validated = false
  service.getNotesAppSession = async (input) => {
    const session = await getSession(input)
    validated = true
    return session
  }
  service.listWorkspacesForNotesApp = async (input) => {
    assert.equal(validated, true, "validate the user before loading workspaces")
    return listWorkspaces(input)
  }
  const response = await createBootstrapRouteHandler(service, async () => 7)(request())
  assert.equal(response.status, 200)
  const payload = await response.json()
  assert.equal(payload.user.id, 7)
  assert.equal(payload.activeWorkspaceId, 3)
  assert.equal(payload.notes[0].id, 41)
})

test("an unauthenticated bootstrap does not query user data", async () => {
  const service = createFakeNotesAppService({
    getNotesAppSession: async () => {
      assert.fail("no user lookup without authentication")
    },
  })
  assert.equal((await createBootstrapRouteHandler(service)(request())).status, 401)
})

test("database failures remain 503 and do not invalidate the session", async (t) => {
  t.mock.method(console, "error", () => undefined)
  const service = createFakeNotesAppService({
    getNotesAppSession: async () => {
      throw new Error("database unavailable")
    },
  })
  const response = await createBootstrapRouteHandler(service, async () => 7)(request())
  assert.equal(response.status, 503)
  assert.equal((await response.json()).code, "STARTUP_UNAVAILABLE")
})

for (const error of [
  new RequestError("Database unavailable", 503),
  new RequestError("Timeout", 408),
  new TypeError("Failed to fetch"),
]) {
  test(`session recovery preserves session and drafts for ${error.message}`, async () => {
    const unexpected = () => assert.fail("outages must not reset or sign out the session")
    assert.equal(
      await recoverExpiredSession(error, {
        persistDrafts: unexpected,
        resetSession: unexpected,
        signOut: async () => unexpected(),
      }),
      false,
    )
  })
}

test("failed sign-out is surfaced instead of automatically retrying", async () => {
  let attempts = 0
  await assert.rejects(
    recoverExpiredSession(new RequestError("Expired", 401), {
      persistDrafts: () => undefined,
      resetSession: () => undefined,
      signOut: async () => {
        attempts += 1
        throw new Error("logout unavailable")
      },
    }),
    /logout unavailable/,
  )
  assert.equal(attempts, 1)
})

test("expired-session recovery keeps unsaved text under the old identity and empties the live ring", async () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window")
  const values = new Map<string, string>()
  const localStorage = {
    get length() {
      return values.size
    },
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value)
    },
    removeItem: (key: string) => {
      values.delete(key)
    },
    key: (index: number) => [...values.keys()][index] ?? null,
  }
  Object.defineProperty(globalThis, "window", { value: { localStorage }, configurable: true })
  const store = useNotesAppStore
  store.getState().resetDefaultState()
  store.getState().openNewDraft()
  const draft = store.getState().openNotes[0]!
  store.getState().patchEntry(draft.key, {
    form: { ...draft.form, description: "unsaved text from the expired account" },
  })
  try {
    await recoverExpiredSession(new RequestError("Expired", 401), {
      persistDrafts: () => {
        assert.equal(
          writeOpenNotesSnapshot(331, 3, store.getState(), () => true),
          true,
        )
      },
      resetSession: () => {
        clearNotesCache()
        store.getState().resetDefaultState()
      },
      signOut: async () => {
        assert.equal(
          store.getState().openNotes.length,
          0,
          "old notes must not enter the next session",
        )
      },
    })
    assert.equal(
      readOpenNotesSnapshot(331, 3)?.entries[0]?.form.description,
      "unsaved text from the expired account",
    )
    assert.equal(readOpenNotesSnapshot(332, 3), null, "drafts remain scoped to their original user")
  } finally {
    store.getState().resetDefaultState()
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow)
    else Reflect.deleteProperty(globalThis, "window")
  }
})
