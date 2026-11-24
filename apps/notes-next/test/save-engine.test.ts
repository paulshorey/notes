import assert from "node:assert/strict"
import test from "node:test"
import type { ItemRecord } from "@lib/db-items"
import { createSaveEngine, openItemWithDetachedSave } from "../src/lib/saveEngine"
import {
  closeEntry,
  createEmptyOpenItemsState,
  getActiveEntry,
  openExistingItem,
  openNewDraft,
  patchEntry,
  type OpenItemEntry,
} from "../src/stores/openItems"
import type { DetachedSave } from "../src/workspace/shared"

const original: ItemRecord = {
  id: 17,
  uid: "00000000-0000-4000-8000-000000000017",
  workspaceId: 1,
  description: "original",
  category: null,
  subcategory: null,
  status: null,
  tags: [],
  timeStart: null,
  timeEnd: null,
  entryDate: null,
  timeDue: null,
  timeRemind: null,
  timeCreated: "2026-01-01T00:00:00.000Z",
  timeModified: "2026-01-01T00:00:00.000Z",
}

const revision = (description: string, day: number): ItemRecord => ({
  ...original,
  description,
  timeModified: `2026-01-0${day}T00:00:00.000Z`,
})

const saved = (item: ItemRecord, status = 200) => Response.json({ item }, { status })
const conflict = (item: ItemRecord) =>
  Response.json({ error: "Item changed", code: "item_changed", item }, { status: 409 })
const failed = () => Response.json({ error: "Save failed", code: "internal" }, { status: 500 })

// Queue HTTP replies independently of the ring. A pending reply lets the test choose
// exactly when a request is acknowledged, even after another request has been sent.
function setup(item: ItemRecord | null = original) {
  const empty = createEmptyOpenItemsState()
  let ring = item ? openExistingItem(empty, item).state : openNewDraft(empty, {}).state
  let cached = item
  const replies: (Response | Promise<Response>)[] = []
  const requests: {
    method: string | undefined
    keepalive: boolean
    body: {
      itemId?: number
      expectedTimeModified?: string
      item: { description: string; uid?: string }
    }
  }[] = []
  const notices: { uid: string | null; text: string | null; error: string | null } = {
    uid: null,
    text: null,
    error: null,
  }
  const detachedSaves = new Map<string, DetachedSave>()
  const saveInFlight = new Map<string, Promise<void>>()
  const queuedAutosaveKeys = new Set<string>()
  const shared = {
    detachedSaves,
    saveInFlight,
    queuedAutosaveKeys,
    patchEntry: (key: string, patch: Partial<OpenItemEntry>) => {
      ring = patchEntry(ring, key, patch)
    },
  }
  const engine = createSaveEngine({
    ...shared,
    fetch: async (url, init) => {
      assert.equal(url, "/api/items")
      requests.push({
        method: init?.method,
        keepalive: init?.keepalive ?? false,
        body: JSON.parse(String(init?.body)),
      })
      const reply = replies.shift()
      assert.ok(reply, "unexpected request")
      return reply
    },
    timeoutSignal: () => new AbortController().signal,
    getOpenItems: () => ring.openItems,
    getUser: () => ({ id: 1 }),
    getWorkspaceId: () => original.workspaceId,
    isGroupDialogOpen: () => false,
    directWrites: new Set(),
    groupDeferredSaveKeys: new Set(),
    exitKeepaliveKeys: new Set(),
    exitSentSignatures: new Map(),
    failedSignatures: new Map(),
    persistOpenItems: () => {},
    finishViewClaim: () => {},
    mergeSavedItem: (_, item) => {
      cached = item
    },
    forgetDeletedItem: () => {},
    scheduleTaxonomyRefresh: () => {},
    setErrorMessage: (error) => {
      notices.error = error
    },
    setSaveConflictUid: (uid) => {
      notices.uid = uid
    },
    setSaveConflictText: (text) => {
      notices.text = text
    },
    setStatusMessage: () => {},
  })
  const active = () => {
    const entry = getActiveEntry(ring)
    assert.ok(entry)
    return entry
  }
  return {
    engine,
    active,
    replies,
    requests,
    notices,
    cached: () => cached,
    edit(description: string) {
      const entry = active()
      shared.patchEntry(entry.key, { form: { ...entry.form, description } })
    },
    save: () => engine.saveEntry(active().key, "autosave"),
    syncStatus: () => engine.syncSaveStatuses(ring.openItems),
    async closeDirtyEntry() {
      const key = active().key
      const closed = closeEntry(ring, key)
      ring = closed.state
      engine.detachRemovedEntries(closed.removed)
      // A detached save is fire-and-forget in the UI. Wait for its HTTP operation
      // before reopening, so the test covers a settled failure under the draft key.
      const pending = saveInFlight.get(key)
      assert.ok(pending)
      await assert.rejects(pending, /Save failed/)
      assert.ok(detachedSaves.has(key))
    },
    reopen(item: ItemRecord) {
      openItemWithDetachedSave(item, {
        ...shared,
        ...engine,
        getStoredItem: (id) => (cached?.id === id ? cached : undefined),
        openExistingItem: (item) => {
          const opened = openExistingItem(ring, item)
          ring = opened.state
          return opened.removed
        },
      })
    },
  }
}

test("a create answered 200 patches the existing item with the draft", async () => {
  const h = setup(null)
  const found = { ...original, uid: h.active().uid }
  h.edit("latest")
  h.replies.push(saved(found), saved({ ...found, description: "latest" }))
  assert.equal(await h.save(), true)
  assert.deepEqual(
    h.requests.map((r) => r.method),
    ["POST", "PATCH"],
  )
  assert.equal(h.requests[0]?.body.item.uid, found.uid)
  assert.equal(h.requests[1]?.body.itemId, found.id)
  assert.equal(h.requests[1]?.body.item.description, "latest")
  assert.equal(h.cached()?.description, "latest")
})

for (const source of ["last saved", "hide-time request", "current request"] as const) {
  test(`a 409 matching the ${source} retries against the stored version`, async () => {
    const h = setup()
    const hidden = revision("hidden", 2)
    if (source === "hide-time request") {
      h.edit("hidden")
      h.replies.push(saved(hidden))
      h.engine.flushOnExit()
      assert.equal(h.requests[0]?.keepalive, true)
    }
    h.edit("current")
    const stored = revision(
      source === "last saved" ? "original" : source === "current request" ? "current" : "hidden",
      2,
    )
    h.replies.push(conflict(stored), saved(revision("current", 3)))
    assert.equal(await h.save(), true)
    const updates = h.requests.filter((r) => !r.keepalive)
    assert.deepEqual(
      updates.map((r) => [
        r.method,
        r.body.itemId,
        r.body.item.description,
        r.body.expectedTimeModified,
      ]),
      [
        ["PATCH", original.id, "current", original.timeModified],
        ["PATCH", original.id, "current", stored.timeModified],
      ],
    )
    assert.equal(h.active().saveStatus, "saved")
    assert.equal(h.notices.uid, null)
  })
}

test("a 409 with another tab's edit preserves the draft and shows the stored text", async () => {
  const h = setup()
  h.edit("local edit")
  h.replies.push(conflict(revision("remote edit", 2)))
  assert.equal(await h.save(), false)
  assert.equal(h.requests.length, 1)
  assert.deepEqual(h.notices, { uid: original.uid, text: "remote edit", error: null })
  assert.equal(h.active().form.description, "local edit")
  assert.equal(h.active().saveStatus, "error")
})

test("acknowledging A after keepalive B leaves C able to continue from B", async () => {
  const h = setup()
  const a = revision("A", 2)
  const b = revision("B", 3)
  const c = revision("C", 4)
  let acknowledgeA!: (reply: Response) => void
  let acknowledgeB!: (reply: Response) => void
  h.replies.push(
    new Promise((resolve) => {
      acknowledgeA = resolve
    }),
    new Promise((resolve) => {
      acknowledgeB = resolve
    }),
  )
  h.edit("A")
  const inFlight = h.save()
  h.edit("B")
  h.engine.flushOnExit()
  acknowledgeA(saved(a))
  assert.equal(await inFlight, true)
  acknowledgeB(saved(b))
  assert.equal(h.active().form.description, "B")
  h.edit("C")
  h.replies.push(conflict(b), saved(c))
  assert.equal(await h.save(), true)
  assert.deepEqual(
    h.requests.map((r) => [
      r.method,
      r.body.item.description,
      r.keepalive,
      r.body.expectedTimeModified,
    ]),
    [
      ["PATCH", "A", false, original.timeModified],
      ["PATCH", "B", true, undefined],
      ["PATCH", "C", false, a.timeModified],
      ["PATCH", "C", false, b.timeModified],
    ],
  )
  assert.equal(h.cached()?.description, "C")
  assert.equal(h.notices.uid, null)
})

test("reopening a failed detached draft checks its version and preserves another tab's edit", async () => {
  const h = setup(null)
  const lastKnown = { ...original, uid: h.active().uid }
  h.edit("original")
  h.replies.push(saved(lastKnown, 201))
  assert.equal(await h.save(), true)
  const draftKey = h.active().key
  h.edit("unsaved before closing")
  h.replies.push(failed())
  await h.closeDirtyEntry()
  const remote = { ...revision("another tab's edit", 2), uid: lastKnown.uid }
  h.reopen(lastKnown)
  assert.notEqual(h.active().key, draftKey)
  assert.equal(h.active().form.description, "unsaved before closing")
  h.replies.push(conflict(remote))
  assert.equal(await h.save(), false)
  assert.deepEqual(
    h.requests.map((r) => r.method),
    ["POST", "PATCH", "PATCH"],
  )
  const update = h.requests[2]!.body
  assert.equal(update.expectedTimeModified, lastKnown.timeModified)
  assert.equal(update.itemId, lastKnown.id)
  assert.equal(update.item.description, "unsaved before closing")
  assert.equal(h.notices.uid, lastKnown.uid)
  assert.equal(h.notices.text, remote.description)
  assert.equal(h.active().form.description, update.item.description)
})

test("an update answered 404 recreates the edited item under the entry uid", async () => {
  const h = setup()
  h.edit("recreated")
  const recreated = { ...revision("recreated", 2), id: 31 }
  h.replies.push(
    Response.json({ error: "Item missing", code: "not_found" }, { status: 404 }),
    saved(recreated, 201),
  )
  assert.equal(await h.save(), true)
  assert.deepEqual(
    h.requests.map((r) => r.method),
    ["PATCH", "POST"],
  )
  assert.equal(h.requests[1]?.body.item.uid, original.uid)
  assert.equal(h.requests[1]?.body.item.description, "recreated")
  assert.equal(h.active().itemId, recreated.id)
  assert.equal(h.active().baseTimeModified, recreated.timeModified)
})

test("a failed save keeps error status until the draft changes", async () => {
  const h = setup()
  h.edit("first edit")
  h.replies.push(failed())
  assert.equal(await h.save(), false)
  assert.equal(h.notices.error, "Save failed")
  h.syncStatus()
  assert.equal(h.active().saveStatus, "error")
  h.edit("second edit")
  h.syncStatus()
  assert.equal(h.active().saveStatus, "unsaved")
})
