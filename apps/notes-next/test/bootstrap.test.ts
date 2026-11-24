import assert from "node:assert/strict"
import test from "node:test"
import { createFakeItemsAppService } from "@lib/db-items/testing/items-api-adapter-suite"
import { createBootstrapRouteHandler } from "../app/api/_lib/bootstrap-route-handler"
import { readJson, RequestError } from "../src/lib/api"
import { readOpenItemsSnapshot, writeOpenItemsSnapshot } from "../src/lib/openItemsStorage"
import { clearItemsCache } from "../src/lib/itemsCache"
import { useItemsAppStore } from "../src/stores/itemsAppStore"
import { recoverExpiredSession } from "../src/lib/sessionRecovery"

const request = () => new Request("https://notes.test/api/bootstrap")

test("a deleted cookie user returns 401 without attempting workspace creation", async () => {
  let workspaceCalls = 0
  const service = createFakeItemsAppService({
    getItemsAppSession: async ({ userId }) => {
      assert.equal(userId, 331)
      return null
    },
    listWorkspacesForItemsApp: async () => {
      workspaceCalls += 1
      throw new Error("user_workspace_v1_user_id_fkey")
    },
  })
  const response = await createBootstrapRouteHandler(service, async () => 331)(request())

  assert.equal(response.status, 401)
  assert.equal(workspaceCalls, 0, "a deleted user must never reach the workspace insert")
  assert.deepEqual(await response.json(), {
    error: "The session is no longer valid.",
    code: "unauthenticated",
  })
})

test("a deleted session recovers through the real bootstrap response and client error parser", async () => {
  const service = createFakeItemsAppService({ getItemsAppSession: async () => null })
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
  const service = createFakeItemsAppService()
  const getSession = service.getItemsAppSession
  const listWorkspaces = service.listWorkspacesForItemsApp
  let validated = false
  service.getItemsAppSession = async (input) => {
    const session = await getSession(input)
    validated = true
    return session
  }
  service.listWorkspacesForItemsApp = async (input) => {
    assert.equal(validated, true, "validate the user before loading workspaces")
    return listWorkspaces(input)
  }
  const response = await createBootstrapRouteHandler(service, async () => 7)(request())
  assert.equal(response.status, 200)
  const payload = await response.json()
  assert.equal(payload.user.id, 7)
  assert.equal(payload.activeWorkspaceId, 3)
  assert.equal(payload.items[0].id, 41)
})

test("an unauthenticated bootstrap does not query user data", async () => {
  const service = createFakeItemsAppService({
    getItemsAppSession: async () => {
      assert.fail("no user lookup without authentication")
    },
  })
  assert.equal((await createBootstrapRouteHandler(service)(request())).status, 401)
})

test("database failures remain 503 and do not invalidate the session", async (t) => {
  t.mock.method(console, "error", () => undefined)
  const service = createFakeItemsAppService({
    getItemsAppSession: async () => {
      throw new Error("database unavailable")
    },
  })
  const response = await createBootstrapRouteHandler(service, async () => 7)(request())
  assert.equal(response.status, 503)
  assert.equal((await response.json()).code, "unavailable")
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
  const store = useItemsAppStore
  store.getState().resetDefaultState()
  store.getState().openNewDraft()
  const draft = store.getState().openItems[0]!
  store.getState().patchEntry(draft.key, {
    form: { ...draft.form, description: "unsaved text from the expired account" },
  })
  try {
    await recoverExpiredSession(new RequestError("Expired", 401), {
      persistDrafts: () => {
        assert.equal(
          writeOpenItemsSnapshot(331, 3, store.getState(), () => true),
          true,
        )
      },
      resetSession: () => {
        clearItemsCache()
        store.getState().resetDefaultState()
      },
      signOut: async () => {
        assert.equal(
          store.getState().openItems.length,
          0,
          "old notes must not enter the next session",
        )
      },
    })
    assert.equal(
      readOpenItemsSnapshot(331, 3)?.entries[0]?.form.description,
      "unsaved text from the expired account",
    )
    assert.equal(readOpenItemsSnapshot(332, 3), null, "drafts remain scoped to their original user")
  } finally {
    store.getState().resetDefaultState()
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow)
    else Reflect.deleteProperty(globalThis, "window")
  }
})

test("a link to an item opens the workspace that holds it", async () => {
  const uid = "0b6f1c1e-8f0a-4c56-9d3e-2a7b5c9e4f10"
  const workspaces = [
    {
      id: 3,
      uid: "7d2a9f04-3b1c-4e8d-a6f5-9c0e1b2d3a44",
      userId: 7,
      label: "personal",
      itemCount: 0,
    },
    { id: 9, uid: "1c3e5a70-2b4d-4f6a-8c9e-0a1b2c3d4e5f", userId: 7, label: "side", itemCount: 1 },
  ]
  const asked: unknown[] = []
  const loaded: number[] = []
  const base = createFakeItemsAppService()
  const service = createFakeItemsAppService({
    listWorkspacesForItemsApp: async () => ({ workspaces }),
    findItemWorkspaceForItemsApp: async (input) => {
      asked.push(input)
      return input.target === uid || input.target === 41 ? 9 : null
    },
    listItemsForItemsApp: async (input) => {
      loaded.push(input.workspaceId)
      return base.listItemsForItemsApp(input)
    },
  })
  const open = async (query: string) => {
    const response = await createBootstrapRouteHandler(
      service,
      async () => 7,
    )(new Request(`https://notes.test/api/bootstrap${query}`))
    if (response.status === 404) {
      assert.deepEqual(await response.json(), {
        error: "This item is unavailable.",
        code: "not_found",
      })
      return null
    }
    assert.equal(response.status, 200)
    return ((await response.json()) as { activeWorkspaceId: number }).activeWorkspaceId
  }

  assert.equal(await open(`?item=${uid.toUpperCase()}`), 9, "the item's workspace opens")
  assert.deepEqual(asked, [{ userId: 7, target: uid }])
  assert.equal(await open("?item=11111111-2222-4333-8444-555555555555"), null)
  assert.equal(await open("?item=41"), null)
  assert.equal(await open("?item=&id=41"), null)
  assert.equal(await open(`?workspaceId=3&item=${uid}`), 9)
  assert.equal(await open("?id=41"), 9)
  assert.equal(await open("?id=41junk"), null)
  assert.equal(await open("?workspaceId=3"), 3)
  assert.deepEqual(loaded, [9, 9, 9, 3])
})

test("copying an open item keeps its identity across filing changes", async () => {
  const { writeItemsUrlSelection } = await import("../src/lib/itemsUrlSelection")
  const original = Object.getOwnPropertyDescriptor(globalThis, "window")
  const uid = "0b6f1c1e-8f0a-4c56-9d3e-2a7b5c9e4f10"
  const location = new URL(
    "https://notes.test/?id=41&workspaceId=3&category=5&subcategory=6&tags=12&ref=mail#origin",
  )
  const paths: string[] = []
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      location,
      history: {
        replaceState: (_state: unknown, _title: string, path: string) => paths.push(path),
      },
    },
  })
  try {
    writeItemsUrlSelection({ itemUid: uid, categoryId: 9, subcategoryId: 10, tagIds: [13] })
    assert.deepEqual(paths, [`/?ref=mail&item=${uid}#origin`])
  } finally {
    if (original) Object.defineProperty(globalThis, "window", original)
    else Reflect.deleteProperty(globalThis, "window")
  }
})
