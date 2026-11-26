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
      if (init?.body === undefined) assert.equal(url, "/api/items?userId=1&workspaceId=1")
      else assert.equal(url, "/api/items")
      requests.push({
        method: init?.method ?? "GET",
        keepalive: init?.keepalive ?? false,
        body: JSON.parse(String(init?.body ?? "{}")),
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
    unconfirmedSignatures: new Map(),
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
    setSaveConflictItem: (item) => {
      notices.uid = item?.uid ?? null
      notices.text = item?.description ?? null
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
    restoreWithoutVersion() {
      shared.patchEntry(active().key, { baseTimeModified: null })
    },
    edit(description: string) {
      const entry = active()
      shared.patchEntry(entry.key, { form: { ...entry.form, description } })
    },
    save: () => engine.saveEntry(active().key, "autosave"),
    syncStatus: () => engine.syncSaveStatuses(ring.openItems),
    close() {
      const key = active().key
      const closed = closeEntry(ring, key)
      ring = closed.state
      engine.detachRemovedEntries(closed.removed)
      return key
    },
    async closeDirtyEntry() {
      const key = this.close()
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
        openExistingItem: (item) => {
          const opened = openExistingItem(ring, item)
          ring = opened.state
          return opened.removed
        },
      })
    },
  }
}

test("a duplicate create updates a known hide-time create using the returned version", async () => {
  const h = setup(null)
  const found = { ...original, uid: h.active().uid }
  h.edit("original")
  h.replies.push(saved(found, 201))
  h.engine.flushOnExit()
  h.edit("latest")
  h.replies.push(saved(found), saved({ ...found, description: "latest" }))
  assert.equal(await h.save(), true)
  assert.deepEqual(
    h.requests.map((r) => r.method),
    ["POST", "POST", "PATCH"],
  )
  assert.equal(h.requests[1]?.body.item.uid, found.uid)
  assert.equal(h.requests[2]?.body.itemId, found.id)
  assert.equal(h.requests[2]?.body.item.description, "latest")
  assert.equal(h.requests[2]?.body.expectedTimeModified, found.timeModified)
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

test("when A wins, keepalive B conflicts and C continues from A", async () => {
  const h = setup()
  const a = revision("A", 2)
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
  acknowledgeB(conflict(a))
  assert.equal(h.active().form.description, "B")
  h.edit("C")
  h.replies.push(saved(c))
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
      ["PATCH", "B", true, original.timeModified],
      ["PATCH", "C", false, a.timeModified],
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
  assert.equal(h.requests[1]?.body.expectedTimeModified, lastKnown.timeModified)
  h.reopen(remote)
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

test("when hide-time B wins, a late response to A cannot revert B or discard C", async () => {
  const h = setup()
  let acknowledge!: (response: Response) => void
  const b = revision("B", 2)
  h.replies.push(
    new Promise((resolve) => {
      acknowledge = resolve
    }),
    saved(b),
  )
  h.edit("A")
  const pending = h.save()
  h.edit("B")
  h.engine.flushOnExit()
  h.edit("C")
  acknowledge(conflict(b))
  assert.equal(await pending, true)
  assert.equal(h.requests.length, 2)
  assert.equal(h.cached()?.description, "B")
  assert.equal(h.active().form.description, "C")
  assert.equal(h.active().saveStatus, "unsaved")
  h.replies.push(saved(revision("C", 3)))
  assert.equal(await h.save(), true)
  assert.equal(h.requests[2]?.body.expectedTimeModified, b.timeModified)
})

test("a duplicate create accepts matching content and asks before overwriting other content", async () => {
  for (const storedText of ["local", "remote"]) {
    const h = setup(null)
    const found = { ...revision(storedText, 2), uid: h.active().uid }
    h.edit("local")
    h.replies.push(saved(found))
    assert.equal(await h.save(), storedText === "local")
    assert.equal(h.requests.length, 1)
    if (storedText === "local") {
      assert.equal(h.active().itemId, found.id)
      continue
    }
    assert.equal(h.active().form.description, "local")
    assert.equal(h.notices.text, "remote")
    const newer = { ...revision("third edit", 3), uid: found.uid }
    h.replies.push(conflict(newer))
    assert.equal(await h.engine.keepEntryOverStoredItem(found), false)
    assert.equal(h.requests[1]?.body.expectedTimeModified, found.timeModified)
    assert.equal(h.notices.text, newer.description)
  }
})

test("a concurrent edit between duplicate lookup and follow-up PATCH is shown", async () => {
  const h = setup(null)
  const found = { ...original, uid: h.active().uid }
  h.edit("original")
  h.replies.push(saved(found, 201))
  h.engine.flushOnExit()
  h.edit("local")
  h.replies.push(saved(found), conflict({ ...found, description: "remote" }))
  assert.equal(await h.save(), false)
  assert.equal(h.requests[2]?.body.expectedTimeModified, found.timeModified)
  assert.equal(h.notices.text, "remote")
  assert.equal(h.active().form.description, "local")
})

test("the final 409 supplies the notice, and hiding it still checks the draft version", async () => {
  const h = setup()
  h.edit("local")
  const remote = revision("remote", 3)
  h.replies.push(conflict(revision("original", 2)), conflict(remote), conflict(remote))
  assert.equal(await h.save(), false)
  assert.equal(h.notices.text, "remote")
  h.engine.flushOnExit()
  assert.equal(h.requests[2]?.keepalive, true)
  assert.equal(h.requests[2]?.body.expectedTimeModified, original.timeModified)
})

test("an empty edit checks the stored version on autosave and on exit", async () => {
  const h = setup()
  h.edit("")
  const remote = revision("added elsewhere", 2)
  h.replies.push(conflict(remote), conflict(remote))
  assert.equal(await h.save(), false)
  assert.equal(h.notices.text, remote.description)
  assert.equal(h.active().itemId, original.id)
  h.engine.flushOnExit()
  assert.deepEqual(
    h.requests.map((r) => [r.method, r.keepalive, r.body.expectedTimeModified]),
    [
      ["DELETE", false, original.timeModified],
      ["DELETE", true, original.timeModified],
    ],
  )
})

for (const close of [false, true]) {
  test(`undo while saving is flushed before ${close ? "close and session change" : "session change"}`, async () => {
    const h = setup()
    const b = revision("B", 2)
    let acknowledge!: (response: Response) => void
    h.replies.push(
      new Promise((resolve) => {
        acknowledge = resolve
      }),
      saved(revision("original", 3)),
    )
    h.edit("B")
    const saving = h.save()
    h.edit("original")
    if (close) h.close()
    const flushing = h.engine.flushAllPendingSaves()
    acknowledge(saved(b))
    assert.equal(await saving, true)
    assert.equal(await flushing, true)
    assert.equal(h.requests.length, 2)
    assert.equal(h.requests[1]?.body.item.description, "original")
    assert.equal(h.requests[1]?.body.expectedTimeModified, b.timeModified)
    assert.equal(h.cached()?.description, "original")
  })
}

test("a restored draft without a version compares the stored item before writing", async () => {
  for (const changed of [false, true]) {
    const h = setup()
    h.restoreWithoutVersion()
    h.edit("local")
    h.engine.flushOnExit()
    assert.equal(h.requests.length, 0)
    const stored = revision(changed ? "other tab" : "original", 2)
    h.replies.push(Response.json({ items: [stored] }))
    if (!changed) h.replies.push(saved(revision("local", 3)))
    assert.equal(await h.save(), !changed)
    if (changed) {
      assert.equal(h.requests.length, 1)
      assert.equal(h.notices.text, "other tab")
    } else {
      assert.equal(h.requests[1]?.body.expectedTimeModified, stored.timeModified)
    }
  }
})

test("a lost update reply followed by undo still reconciles before session change", async () => {
  const h = setup()
  let loseReply!: (error: Error) => void
  h.replies.push(
    new Promise((_, reject) => {
      loseReply = reject
    }),
  )
  h.edit("B")
  const saving = h.save()
  h.edit("original")
  const flushing = h.engine.flushAllPendingSaves()
  const b = revision("B", 2)
  h.replies.push(conflict(b), saved(revision("original", 3)))
  loseReply(new TypeError("connection reset"))
  assert.equal(await saving, false)
  assert.equal(await flushing, true)
  assert.equal(h.requests[2]?.body.expectedTimeModified, b.timeModified)
  assert.equal(h.cached()?.description, "original")
})

test("reopening before a detached reply uses only that request's actual acknowledgment", async () => {
  for (const succeeds of [false, true]) {
    const h = setup(null)
    const first = { ...original, uid: h.active().uid }
    h.edit("original")
    h.replies.push(saved(first, 201))
    await h.save()
    const next = { ...revision("detached", 2), uid: first.uid }
    let settle!: (reply: Response) => void
    h.edit("detached")
    h.replies.push(
      new Promise((resolve) => {
        settle = resolve
      }),
    )
    h.close()
    h.reopen({ ...revision("refreshed remotely", 3), uid: first.uid })
    h.edit("latest local")
    const flush = h.engine.flushAllPendingSaves()
    h.replies.push(saved({ ...revision("latest local", 4), uid: first.uid }))
    settle(succeeds ? saved(next) : failed())
    assert.equal(await flush, true)
    assert.equal(
      h.requests[2]?.body.expectedTimeModified,
      succeeds ? next.timeModified : first.timeModified,
    )
    assert.equal(h.requests[2]?.body.item.description, "latest local")
  }
})

test("a session flush includes an undo made while its own request is pending", async () => {
  const h = setup()
  let acknowledge!: (response: Response) => void
  const b = revision("B", 2)
  h.edit("B")
  h.replies.push(
    new Promise((resolve) => {
      acknowledge = resolve
    }),
    saved(revision("original", 3)),
  )
  const flushing = h.engine.flushAllPendingSaves()
  h.edit("original")
  acknowledge(saved(b))
  assert.equal(await flushing, true)
  assert.equal(h.requests[1]?.body.expectedTimeModified, b.timeModified)
  assert.equal(h.cached()?.description, "original")
})
