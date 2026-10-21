import assert from "node:assert/strict"
import test from "node:test"
import type { ItemRecord } from "@lib/db-items"
import { serializeItemDraft } from "../src/lib/itemDraft"
import { itemToFormState, createDefaultTextCaptureForm } from "../src/types/items"
import {
  readOpenItemsSnapshot,
  reconcileOpenItems,
  toSnapshot,
  upgradeOpenItemsSnapshot,
  type OpenItemsSnapshot,
  type StoredOpenItemsSnapshot,
} from "../src/lib/openItemsStorage"

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>()

  get length() {
    return this.values.size
  }

  clear() {
    this.values.clear()
  }

  getItem(key: string) {
    return this.values.get(key) ?? null
  }

  key(index: number) {
    return [...this.values.keys()][index] ?? null
  }

  removeItem(key: string) {
    this.values.delete(key)
  }

  setItem(key: string, value: string) {
    this.values.set(key, value)
  }
}

const makeItem = (
  id: number,
  description: string,
  timeModified = "2026-03-01T00:00:00.000Z",
): ItemRecord => ({
  id,
  workspaceId: 1,
  categories: [{ id: 7, label: "inbox" }],
  status: null,
  tags: [],
  description,
  timeDue: null,
  timeRemind: null,
  timeCreated: "2026-01-01T00:00:00.000Z",
  timeModified,
})

const cleanEntry = (item: ItemRecord) => {
  const form = itemToFormState(item)
  return {
    key: `note:${item.id}`,
    itemId: item.id,
    baseTimeModified: item.timeModified,
    form,
    savedSignature: serializeItemDraft(item.id, form),
    categoryInputValue: item.categories[0]?.label ?? "",
    pendingTagLabels: [],
    openedAt: Date.now(),
    lastActivatedAt: Date.now(),
  }
}

const dirtyEntry = (item: ItemRecord, typed: string) => {
  const entry = cleanEntry(item)
  return { ...entry, form: { ...entry.form, description: typed } }
}

const snapshotOf = (entries: OpenItemsSnapshot["entries"]): OpenItemsSnapshot => ({
  schemaVersion: 3,
  userId: 1,
  workspaceId: 1,
  activeKey: entries[0]?.key ?? null,
  backStack: [],
  nextDraftSequence: 0,
  entries,
  savedAt: Date.now(),
})

const lookupFrom = (items: ItemRecord[]) => (id: number) => items.find((item) => item.id === id)

test("a clean entry adopts a newer server record", () => {
  const stored = makeItem(1, "original")
  const server = makeItem(1, "edited on another device", "2026-04-01T00:00:00.000Z")

  const { state } = reconcileOpenItems(snapshotOf([cleanEntry(stored)]), lookupFrom([server]))

  assert.equal(state.openItems[0]?.form.description, "edited on another device")
  assert.equal(state.openItems[0]?.baseTimeModified, server.timeModified)
})

test("a dirty entry keeps the local draft even when the server is newer", () => {
  const stored = makeItem(1, "original")
  const server = makeItem(1, "edited elsewhere", "2026-04-01T00:00:00.000Z")

  const { state } = reconcileOpenItems(
    snapshotOf([dirtyEntry(stored, "my unsaved words")]),
    lookupFrom([server]),
  )

  assert.equal(state.openItems[0]?.form.description, "my unsaved words")
})

test("a clean entry whose note was deleted is dropped silently", () => {
  const { state, orphanedDraftCount } = reconcileOpenItems(
    snapshotOf([cleanEntry(makeItem(1, "gone"))]),
    lookupFrom([]),
  )

  assert.equal(state.openItems.length, 0)
  assert.equal(orphanedDraftCount, 0)
})

test("a dirty entry whose note was deleted survives as a draft and is reported", () => {
  const { state, orphanedDraftCount } = reconcileOpenItems(
    snapshotOf([dirtyEntry(makeItem(1, "gone"), "words I never saw saved")]),
    lookupFrom([]),
  )

  assert.equal(orphanedDraftCount, 1)
  assert.equal(state.openItems.length, 1)
  assert.equal(state.openItems[0]?.itemId, null)
  assert.ok(state.openItems[0]?.key.startsWith("draft:"))
  assert.equal(state.openItems[0]?.form.description, "words I never saw saved")
})

test("an empty never-saved draft is dropped and a non-empty one is kept", () => {
  const base = {
    itemId: null,
    baseTimeModified: null,
    savedSignature: null,
    categoryInputValue: "",
    pendingTagLabels: [],
    openedAt: Date.now(),
    lastActivatedAt: Date.now(),
  }

  const { state } = reconcileOpenItems(
    snapshotOf([
      { ...base, key: "draft:0", form: createDefaultTextCaptureForm() },
      { ...base, key: "draft:1", form: { ...createDefaultTextCaptureForm(), description: "kept" } },
    ]),
    lookupFrom([]),
  )

  assert.deepEqual(
    state.openItems.map((entry) => entry.key),
    ["draft:1"],
  )
})

test("a deleted category is removed without assigning a replacement", () => {
  const item = makeItem(1, "text")

  const { state } = reconcileOpenItems(snapshotOf([cleanEntry(item)]), lookupFrom([item]), {
    categoryExists: () => false,
  })

  assert.deepEqual(state.openItems[0]?.form.selectedCategoryIds, [])
})

test("a form referencing a deleted status is reset to no status", () => {
  const item = { ...makeItem(1, "text"), status: { id: 8, label: "todo" } }
  const { state } = reconcileOpenItems(snapshotOf([cleanEntry(item)]), lookupFrom([item]), {
    statusExists: () => false,
  })

  assert.equal(state.openItems[0]?.form.selectedStatusId, null)
  assert.equal(
    state.openItems[0]?.savedSignature,
    serializeItemDraft(item.id, state.openItems[0]!.form),
  )
})

test("a clean entry untouched for 90 days is dropped", () => {
  const item = makeItem(1, "stale")
  const entry = { ...cleanEntry(item), lastActivatedAt: Date.now() - 91 * 24 * 60 * 60 * 1000 }

  const { state } = reconcileOpenItems(snapshotOf([entry]), lookupFrom([item]))

  assert.equal(state.openItems.length, 0)
})

test("a stale but dirty entry is never dropped", () => {
  const item = makeItem(1, "stale")
  const entry = {
    ...dirtyEntry(item, "unsaved"),
    lastActivatedAt: Date.now() - 400 * 24 * 60 * 60 * 1000,
  }

  const { state } = reconcileOpenItems(snapshotOf([entry]), lookupFrom([item]))

  assert.equal(state.openItems.length, 1)
})

// The blanket guard against the signature bug: if the user did not type it,
// reconciliation must not leave it looking like they did. Asserted across every
// case at once so it keeps holding as new rules are added.
test("no reconciliation outcome leaves an unedited entry dirty", () => {
  const stored = makeItem(1, "original")
  const server = makeItem(1, "server moved on", "2026-04-01T00:00:00.000Z")
  const untouched = makeItem(2, "untouched")

  const { state } = reconcileOpenItems(
    snapshotOf([cleanEntry(stored), cleanEntry(untouched)]),
    lookupFrom([server, untouched]),
    { categoryExists: () => false },
  )

  for (const entry of state.openItems) {
    assert.equal(
      serializeItemDraft(entry.itemId, entry.form),
      entry.savedSignature,
      `entry ${entry.key} loaded dirty and would autosave immediately`,
    )
  }
})

test("reconciling twice matches reconciling once", () => {
  const stored = makeItem(1, "original")
  const server = makeItem(1, "server moved on", "2026-04-01T00:00:00.000Z")
  const snapshot = snapshotOf([cleanEntry(stored), dirtyEntry(makeItem(2, "b"), "typed")])
  const lookup = lookupFrom([server, makeItem(2, "b")])

  const once = reconcileOpenItems(snapshot, lookup, { now: 1_000 })
  const twice = reconcileOpenItems(
    {
      ...snapshot,
      entries: once.state.openItems.map((entry) => ({
        key: entry.key,
        itemId: entry.itemId,
        baseTimeModified: entry.baseTimeModified,
        form: entry.form,
        savedSignature: entry.savedSignature,
        categoryInputValue: entry.categoryInputValue,
        pendingTagLabels: entry.pendingTagLabels,
        openedAt: entry.openedAt,
        lastActivatedAt: entry.lastActivatedAt,
      })),
    },
    lookup,
    { now: 1_000 },
  )

  assert.deepEqual(
    twice.state.openItems.map((entry) => [entry.key, entry.form.description]),
    once.state.openItems.map((entry) => [entry.key, entry.form.description]),
  )
})

test("legacy single-category snapshots upgrade without making clean entries dirty", () => {
  const item = makeItem(1, "legacy")
  const form = itemToFormState(item)
  const legacyForm = {
    ...form,
    selectedCategoryId: form.selectedCategoryIds[0],
    selectedCategoryIds: undefined,
    selectedStatusId: undefined,
  }
  const legacy = {
    ...snapshotOf([]),
    schemaVersion: 1,
    workspaceId: undefined,
    entries: [
      {
        ...cleanEntry(item),
        form: legacyForm,
        savedSignature: JSON.stringify({
          itemId: item.id,
          categoryId: 7,
          tagIds: [],
          description: "legacy",
          timeDue: null,
          timeRemind: null,
        }),
      },
    ],
  } as unknown as StoredOpenItemsSnapshot

  const upgraded = upgradeOpenItemsSnapshot(legacy, 1, 9)
  assert.equal(upgraded.workspaceId, 9)
  assert.deepEqual(upgraded.entries[0]?.form.selectedCategoryIds, [7])
  assert.equal(
    upgraded.entries[0]?.savedSignature,
    serializeItemDraft(item.id, upgraded.entries[0]!.form),
  )
})

test("workspace snapshots carry separate workspace identities", () => {
  const emptyState = {
    openItems: [],
    activeKey: null,
    backStack: [],
    nextDraftSequence: 0,
  }
  assert.equal(toSnapshot(1, 10, emptyState).workspaceId, 10)
  assert.equal(toSnapshot(1, 20, emptyState).workspaceId, 20)
})

test("a legacy browser snapshot migrates to only the first workspace that reads it", () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window")
  const localStorage = new MemoryStorage()
  Object.defineProperty(globalThis, "window", {
    value: { localStorage },
    configurable: true,
  })

  try {
    const legacy = {
      ...snapshotOf([]),
      schemaVersion: 1,
      workspaceId: undefined,
    }
    localStorage.setItem("notes-open-notes-v1", JSON.stringify(legacy))

    assert.equal(readOpenItemsSnapshot(1, 10)?.workspaceId, 10)
    assert.equal(localStorage.getItem("notes-open-notes-v1"), null)
    assert.notEqual(localStorage.getItem("items-open-items-v3:1:10"), null)
    assert.equal(readOpenItemsSnapshot(1, 20), null)
  } finally {
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow)
    else Reflect.deleteProperty(globalThis, "window")
  }
})

test("a wrong-user or malformed browser snapshot never reaches reconcile", async () => {
  // No window in the node test runner, so the reader must degrade to null
  // rather than throwing.
  assert.equal(readOpenItemsSnapshot(1, 1), null)
})

test("repairing a dirty draft removes only deleted categories and preserves text", () => {
  const item = makeItem(1, "saved")
  const entry = dirtyEntry(item, "unsaved text")
  entry.form.selectedCategoryIds = [10, 20]
  const { state } = reconcileOpenItems(snapshotOf([entry]), lookupFrom([item]), {
    categoryExists: (id) => id === 20,
  })
  const repaired = state.openItems[0]!
  assert.deepEqual(repaired.form.selectedCategoryIds, [20])
  assert.equal(repaired.form.description, "unsaved text")
  assert.notEqual(serializeItemDraft(repaired.itemId, repaired.form), repaired.savedSignature)
})

test("real version-two note snapshots retain clean signatures, dirty text, navigation, and identity", () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window")
  const storage = new MemoryStorage()
  Object.defineProperty(globalThis, "window", {
    value: { localStorage: storage },
    configurable: true,
  })
  const item = makeItem(41, "saved noteId text")
  const clean = cleanEntry(item)
  const dirty = dirtyEntry({ ...item, id: 42 }, "unsaved noteId and notes must stay verbatim")
  const legacy = {
    ...snapshotOf([clean, dirty]),
    schemaVersion: 2,
    activeKey: dirty.key,
    backStack: [clean.key],
    entries: [clean, dirty].map(({ itemId, ...entry }) => ({
      ...entry,
      noteId: itemId,
      savedSignature: JSON.stringify(
        Object.fromEntries(
          Object.entries(JSON.parse(entry.savedSignature)).map(([key, value]) => [
            key === "itemId" ? "noteId" : key,
            value,
          ]),
        ),
      ),
    })),
  }
  const raw = JSON.stringify(legacy)
  storage.setItem("notes-open-notes-v2:1:1", raw)
  try {
    const upgraded = readOpenItemsSnapshot(1, 1)!
    assert.equal(upgraded.schemaVersion, 3)
    assert.equal(upgraded.activeKey, dirty.key)
    assert.deepEqual(upgraded.backStack, [clean.key])
    assert.equal(upgraded.entries[0]!.itemId, 41)
    assert.equal(upgraded.entries[0]!.savedSignature, serializeItemDraft(41, clean.form))
    assert.equal(upgraded.entries[1]!.form.description, dirty.form.description)
    assert.notEqual(upgraded.entries[1]!.savedSignature, serializeItemDraft(42, dirty.form))
    assert.equal(storage.getItem("notes-open-notes-v2:1:1"), raw)
    assert.ok(storage.getItem("items-open-items-v3:1:1"))
  } finally {
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow)
    else Reflect.deleteProperty(globalThis, "window")
  }
})

test("a failed legacy draft upgrade preserves its only durable copy", () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window")
  const storage = new MemoryStorage()
  const entry = dirtyEntry(makeItem(41, "saved"), "unsaved words must survive quota failure")
  const { itemId, ...rest } = entry
  const raw = JSON.stringify({
    ...snapshotOf([entry]),
    schemaVersion: 2,
    entries: [{ ...rest, noteId: itemId }],
  })
  storage.setItem("notes-open-notes-v2:1:1", raw)
  storage.setItem = () => {
    throw new DOMException("Quota exceeded", "QuotaExceededError")
  }
  Object.defineProperty(globalThis, "window", {
    value: { localStorage: storage },
    configurable: true,
  })
  try {
    assert.equal(readOpenItemsSnapshot(1, 1)?.entries[0]?.form.description, entry.form.description)
    assert.equal(storage.getItem("notes-open-notes-v2:1:1"), raw)
    assert.equal(storage.getItem("items-open-items-v3:1:1"), null)
  } finally {
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow)
    else Reflect.deleteProperty(globalThis, "window")
  }
})

test("an existing server cache upgrades item lists and relationship counts without altering preferences", async () => {
  const { readItemsCache } = await import("../src/lib/itemsCache")
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window")
  const storage = new MemoryStorage()
  const preferences = { notesApp: { maxOpenNotes: 5 } }
  storage.setItem("notes-app-cache-v2:latest", "notes-app-cache-v2:1:1")
  storage.setItem(
    "notes-app-cache-v2:1:1",
    JSON.stringify({
      schemaVersion: 2,
      userId: 1,
      activeWorkspaceId: 1,
      savedAt: Date.now(),
      user: { id: 1, username: "owner", email: null, phone: null, preferences },
      notes: [makeItem(41, "authored notes text")],
      workspaces: [{ id: 1, userId: 1, label: "personal", noteCount: 1 }],
      categories: [{ id: 7, workspaceId: 1, label: "inbox", noteCount: 1, lastUsedAt: null }],
      statuses: [],
      tags: [],
    }),
  )
  Object.defineProperty(globalThis, "window", {
    value: { localStorage: storage },
    configurable: true,
  })
  try {
    const cached = readItemsCache(1)!
    assert.equal(cached.schemaVersion, 3)
    assert.equal(cached.items[0]?.description, "authored notes text")
    assert.equal(cached.categories[0]?.itemCount, 1)
    assert.equal(cached.workspaces[0]?.itemCount, 1)
    assert.deepEqual(cached.user.preferences, preferences)
    assert.equal(readItemsCache(2), null)
  } finally {
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow)
    else Reflect.deleteProperty(globalThis, "window")
  }
})
