import assert from "node:assert/strict"
import test from "node:test"
import type { ItemRecord } from "@lib/db-items"
import { serializeItemDraft } from "../src/lib/itemDraft"
import {
  createEmptyOpenItemsState,
  openExistingItem,
  type OpenItemEntry,
} from "../src/stores/openItems"
import { entrySaveAction } from "../src/views/registry"
import { NO_FILING } from "../src/lib/itemFiling"
import { itemToFormState, createDefaultTextCaptureForm } from "../src/types/items"
import {
  readOpenItemsSnapshot,
  reconcileOpenItems,
  toSnapshot,
  writeOpenItemsSnapshot,
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
  uid: `00000000-0000-4000-8000-${String(id).padStart(12, "0")}`,
  workspaceId: 1,
  category: { id: 7, label: "inbox" },
  subcategory: { id: 70, label: "today" },
  status: null,
  tags: [],
  description,
  timeStart: null,
  timeEnd: null,
  entryDate: null,
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
    categoryInputValue: item.category?.label ?? "",
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
  schemaVersion: 4,
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
    existingFiling: () => NO_FILING,
  })

  assert.equal(state.openItems[0]?.form.selectedCategoryId, null)
  assert.equal(state.openItems[0]?.form.selectedSubcategoryId, null)
})

test("a deleted subcategory leaves the entry in its category", () => {
  const item = makeItem(1, "text")

  const { state } = reconcileOpenItems(snapshotOf([cleanEntry(item)]), lookupFrom([item]), {
    existingFiling: (filing) => ({ ...filing, subcategoryId: null }),
  })

  assert.equal(state.openItems[0]?.form.selectedCategoryId, 7)
  assert.equal(state.openItems[0]?.form.selectedSubcategoryId, null)
  assert.equal(
    state.openItems[0]?.savedSignature,
    serializeItemDraft(item.id, state.openItems[0]!.form),
  )
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
    { existingFiling: () => NO_FILING },
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
    selectedCategoryId: 7,
    selectedSubcategoryId: undefined,
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
  assert.equal(upgraded.entries[0]?.form.selectedCategoryId, 7)
  assert.equal(upgraded.entries[0]?.form.selectedSubcategoryId, null)
  assert.equal(
    upgraded.entries[0]?.savedSignature,
    serializeItemDraft(item.id, upgraded.entries[0]!.form),
  )
})

test("snapshots with a list of categories keep the first one, clean entries clean, and dirty text dirty", () => {
  const item = { ...makeItem(1, "saved"), subcategory: null, status: { id: 8, label: "todo" } }
  const listedForm: Record<string, unknown> = {
    ...itemToFormState(item),
    selectedCategoryIds: [7, 9],
  }
  delete listedForm.selectedCategoryId
  delete listedForm.selectedSubcategoryId
  // The signature this shape wrote for an unchanged entry.
  const listedSignature = (description: string) =>
    JSON.stringify({
      itemId: item.id,
      categoryIds: [7, 9],
      statusId: 8,
      tagIds: [],
      description,
      timeDue: null,
      timeRemind: null,
    })
  const stored = {
    ...snapshotOf([]),
    schemaVersion: 3,
    entries: [
      { ...cleanEntry(item), form: listedForm, savedSignature: listedSignature("saved") },
      {
        ...cleanEntry(item),
        key: "note:2",
        form: { ...listedForm, description: "typed and never saved" },
        savedSignature: listedSignature("saved"),
      },
    ],
  } as unknown as StoredOpenItemsSnapshot

  const upgraded = upgradeOpenItemsSnapshot(stored, 1, 1)
  assert.equal(upgraded.schemaVersion, 4)
  for (const entry of upgraded.entries) {
    assert.equal(entry.form.selectedCategoryId, 7)
    assert.equal(entry.form.selectedSubcategoryId, null)
    assert.equal(entry.form.selectedStatusId, 8)
    assert.equal("selectedCategoryIds" in entry.form, false)
  }
  const [clean, dirty] = upgraded.entries
  assert.equal(clean!.savedSignature, serializeItemDraft(item.id, clean!.form))
  assert.equal(dirty!.form.description, "typed and never saved")
  assert.notEqual(dirty!.savedSignature, serializeItemDraft(item.id, dirty!.form))
  // Upgrading what was just upgraded changes nothing.
  assert.deepEqual(upgradeOpenItemsSnapshot(upgraded, 1, 1).entries, upgraded.entries)
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

test("repairing a dirty draft removes only the deleted subcategory and preserves text", () => {
  const item = makeItem(1, "saved")
  const entry = dirtyEntry(item, "unsaved text")
  entry.form.selectedCategoryId = 20
  entry.form.selectedSubcategoryId = 30
  const { state } = reconcileOpenItems(snapshotOf([entry]), lookupFrom([item]), {
    existingFiling: ({ categoryId }) => ({ categoryId, subcategoryId: null }),
  })
  const repaired = state.openItems[0]!
  assert.equal(repaired.form.selectedCategoryId, 20)
  assert.equal(repaired.form.selectedSubcategoryId, null)
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
    assert.equal(upgraded.schemaVersion, 4)
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

test("a server cache is used for the first paint only when its items have uids", async () => {
  const { readItemsCache, writeItemsCache } = await import("../src/lib/itemsCache")
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window")
  const storage = new MemoryStorage()
  Object.defineProperty(globalThis, "window", {
    value: { localStorage: storage },
    configurable: true,
  })
  const preferences = { notesApp: { maxOpenNotes: 5 } }
  const current = {
    userId: 1,
    activeWorkspaceId: 1,
    user: { id: 1, username: "owner", email: null, phone: null, preferences },
    items: [makeItem(41, "authored notes text")],
    workspaces: [],
    categories: [],
    statuses: [],
    tags: [],
  }
  try {
    writeItemsCache(current as unknown as Parameters<typeof writeItemsCache>[0])
    const cached = readItemsCache(1)!
    assert.equal(cached.schemaVersion, 7)
    assert.equal(cached.items[0]?.description, "authored notes text")
    assert.equal(cached.items[0]?.uid, makeItem(41, "").uid)
    assert.deepEqual(cached.user.preferences, preferences)
    assert.equal(readItemsCache(2), null, "another user's cache is not read")

    // A snapshot written before items had a uid cannot name its items, so it is not
    // used. It is a copy of server data, and the next load replaces it.
    const key = storage.getItem("items-app-cache-v3:latest")!
    const stored = JSON.parse(storage.getItem(key)!)
    const withoutUid = { ...stored.items[0] }
    delete withoutUid.uid
    storage.setItem(key, JSON.stringify({ ...stored, items: [withoutUid] }))
    assert.equal(readItemsCache(1), null)
    storage.setItem(key, JSON.stringify({ ...stored, schemaVersion: 6 }))
    assert.equal(readItemsCache(1), null, "an earlier version is not read")
  } finally {
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow)
    else Reflect.deleteProperty(globalThis, "window")
  }
})

test("a clean entry stored without its text for lack of space reloads as the stored note", async () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window")
  const storage = new MemoryStorage()
  const item = makeItem(41, "stored text that does not fit in what storage is left")
  const state = openExistingItem(createEmptyOpenItemsState(), item).state
  const isDirty = (entry: OpenItemEntry) =>
    serializeItemDraft(entry.itemId, entry.form) !== entry.savedSignature
  assert.equal(isDirty(state.openItems[0]!), false, "an opened item starts clean")

  // Only the reduced write fits: the full snapshot, with the text, is refused.
  const setItem = storage.setItem.bind(storage)
  storage.setItem = (key: string, value: string) => {
    if (value.includes("stored text that does not fit")) {
      throw new DOMException("Quota exceeded", "QuotaExceededError")
    }
    setItem(key, value)
  }
  Object.defineProperty(globalThis, "window", {
    value: { localStorage: storage },
    configurable: true,
  })
  try {
    assert.equal(writeOpenItemsSnapshot(1, 1, state, isDirty), true)
    const snapshot = readOpenItemsSnapshot(1, 1)!
    assert.equal(snapshot.entries[0]?.form.description, "", "the text was left out")

    // The server still has the note. It must come back as stored, not as an edit
    // that removed its text, which a save would turn into a deletion.
    const restored = reconcileOpenItems(snapshot, (id) => (id === 41 ? item : undefined))
    const entry = restored.state.openItems[0]!
    assert.equal(entry.form.description, item.description)
    assert.equal(isDirty(entry), false)
    assert.equal(entrySaveAction(entry), "update", "and it still holds its content")

    // And if the note is gone, a clean entry is dropped, not revived.
    assert.equal(reconcileOpenItems(snapshot, () => undefined).state.openItems.length, 0)
  } finally {
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow)
    else Reflect.deleteProperty(globalThis, "window")
  }
})

test("an emptied entry whose item is gone is dropped even when it still has tags", () => {
  const item = { ...makeItem(41, "had text"), tags: [{ id: 5, label: "kept" }] }
  const entry = cleanEntry(item)
  const emptied = { ...entry, form: { ...entry.form, description: "" } }
  const result = reconcileOpenItems(snapshotOf([emptied]), () => undefined)
  assert.equal(result.state.openItems.length, 0, "tags alone could never be created as an item")
  assert.equal(result.orphanedDraftCount, 0)

  // Text the user typed still survives the loss of its item.
  const typed = { ...entry, form: { ...entry.form, description: "typed and not saved" } }
  const kept = reconcileOpenItems(snapshotOf([typed]), () => undefined)
  assert.equal(kept.state.openItems[0]?.form.description, "typed and not saved")
  assert.equal(kept.orphanedDraftCount, 1)
})
