import assert from "node:assert/strict"
import test from "node:test"
import type { ItemRecord } from "@lib/db-items"
import {
  activate,
  closeEntriesForItem,
  closeEntry,
  createEmptyOpenItemsState,
  evictToCap,
  findEntry,
  findEntryByItemId,
  getActiveEntry,
  getBackTarget,
  goBack,
  isEmptyDraft,
  itemEntryKey,
  openExistingItem,
  openNewDraft,
  patchEntry,
  type OpenItemsState,
} from "../src/stores/openItems"

const makeItem = (id: number, description = `note ${id}`): ItemRecord => ({
  id,
  workspaceId: 1,
  categories: [{ id: 7, label: "inbox" }],
  status: null,
  tags: [],
  description,
  timeDue: null,
  timeRemind: null,
  timeCreated: "2026-01-01T00:00:00.000Z",
  timeModified: `2026-01-0${(id % 9) + 1}T00:00:00.000Z`,
})

const openItems = (ids: number[], cap = 10): OpenItemsState =>
  ids.reduce(
    (state, id) => openExistingItem(state, makeItem(id), cap).state,
    createEmptyOpenItemsState(),
  )

const keys = (state: OpenItemsState) => state.openItems.map((entry) => entry.key)

test("openExistingNote activates the note and puts it at the head", () => {
  const state = openItems([1, 2])

  assert.equal(state.activeKey, itemEntryKey(2))
  assert.deepEqual(keys(state), [itemEntryKey(2), itemEntryKey(1)])
})

test("reopening an already-open note preserves its draft and promotes it", () => {
  let state = openItems([1, 2])
  state = patchEntry(state, itemEntryKey(1), (entry) => ({
    form: { ...entry.form, description: "unsaved edits" },
  }))

  const { state: reopened } = openExistingItem(state, makeItem(1, "server copy"))

  assert.equal(reopened.activeKey, itemEntryKey(1))
  assert.deepEqual(keys(reopened), [itemEntryKey(1), itemEntryKey(2)])
  assert.equal(getActiveEntry(reopened)?.form.description, "unsaved edits")
})

test("openExistingNote records the record's timeModified as the base revision", () => {
  const item = makeItem(3)
  const { state } = openExistingItem(createEmptyOpenItemsState(), item)

  assert.equal(findEntryByItemId(state, 3)?.baseTimeModified, item.timeModified)
})

test("exceeding the cap evicts the least recently used entry and reports it", () => {
  let state = openItems([1, 2, 3], 3)
  const { state: next, removed } = openExistingItem(state, makeItem(4), 3)
  state = next

  assert.equal(state.openItems.length, 3)
  assert.deepEqual(
    removed.map((entry) => entry.key),
    [itemEntryKey(1)],
  )
  assert.equal(findEntryByItemId(state, 1), null)
})

test("eviction never drops the active entry", () => {
  const state = openItems([1, 2, 3], 3)
  const { state: next } = evictToCap(state, 1)

  assert.deepEqual(keys(next), [itemEntryKey(3)])
  assert.equal(next.activeKey, itemEntryKey(3))
})

// The ordering regression: with insert -> evict -> activate, the outgoing entry
// is still active and therefore protected, so nothing can be dropped and the
// cap is silently violated. Every cap above 1 hides this.
test("cap of 1 holds when opening a second note", () => {
  const state = openItems([1, 2], 1)

  assert.equal(state.openItems.length, 1)
  assert.deepEqual(keys(state), [itemEntryKey(2)])
  assert.equal(state.activeKey, itemEntryKey(2))
})

test("cap holds even when the least recently used entry is the back target", () => {
  const state = openItems([1, 2], 2)
  assert.equal(getBackTarget(state)?.key, itemEntryKey(1))

  const { state: next } = openExistingItem(state, makeItem(3), 2)

  assert.equal(next.openItems.length, 2)
  assert.equal(findEntryByItemId(next, 1), null)
})

test("goBack walks the visit history rather than toggling", () => {
  let state = openItems([1, 2, 3])
  assert.equal(state.activeKey, itemEntryKey(3))

  state = goBack(state)
  assert.equal(state.activeKey, itemEntryKey(2))

  state = goBack(state)
  assert.equal(state.activeKey, itemEntryKey(1))
})

test("goBack skips entries that were evicted or closed", () => {
  let state = openItems([1, 2, 3])
  state = closeEntry(state, itemEntryKey(2)).state
  state = activate(state, itemEntryKey(3))

  state = goBack(state)

  assert.equal(state.activeKey, itemEntryKey(1))
})

test("goBack is a no-op when the stack has no survivors", () => {
  const state = openItems([1])
  assert.equal(getBackTarget(state), null)
  assert.equal(goBack(state).activeKey, itemEntryKey(1))
})

test("closing the active entry falls back to the back target", () => {
  const state = openItems([1, 2])
  const { state: next, removed } = closeEntry(state, itemEntryKey(2))

  assert.equal(next.activeKey, itemEntryKey(1))
  assert.deepEqual(
    removed.map((entry) => entry.key),
    [itemEntryKey(2)],
  )
})

test("closing the last entry opens a fresh empty draft", () => {
  const state = openItems([1])
  const { state: next } = closeEntry(state, itemEntryKey(1))

  assert.equal(next.openItems.length, 1)
  assert.ok(next.activeKey?.startsWith("draft:"))
  assert.ok(isEmptyDraft(getActiveEntry(next)!))
})

test("closing a background entry leaves the active one alone", () => {
  const state = openItems([1, 2])
  const { state: next } = closeEntry(state, itemEntryKey(1))

  assert.equal(next.activeKey, itemEntryKey(2))
  assert.deepEqual(keys(next), [itemEntryKey(2)])
})

test("closing purges the key from the back stack", () => {
  let state = openItems([1, 2, 3])
  state = closeEntry(state, itemEntryKey(1)).state

  assert.ok(!state.backStack.includes(itemEntryKey(1)))
})

test("deleting a note closes its entry wherever it sits", () => {
  const state = openItems([1, 2, 3])
  const { state: next, removed } = closeEntriesForItem(state, 1)

  assert.equal(findEntryByItemId(next, 1), null)
  assert.equal(removed.length, 1)
  assert.equal(next.activeKey, itemEntryKey(3))
})

test("a draft keeps its key across the transition to a real note id", () => {
  const { state: opened } = openNewDraft(createEmptyOpenItemsState(), { categoryIds: [7] })
  const draftKey = opened.activeKey!
  assert.ok(draftKey.startsWith("draft:"))

  const state = patchEntry(opened, draftKey, {
    itemId: 42,
    baseTimeModified: "2026-02-02T00:00:00.000Z",
    savedSignature: "sig-with-id-42",
  })

  assert.equal(state.activeKey, draftKey)
  assert.equal(findEntry(state, draftKey)?.itemId, 42)
})

test("openNewDraft reuses an untouched draft instead of minting another", () => {
  const { state: first } = openNewDraft(createEmptyOpenItemsState(), { categoryIds: [7] })
  const { state: second } = openNewDraft(first, { categoryIds: [9] })

  assert.equal(second.openItems.length, 1)
  assert.equal(second.nextDraftSequence, first.nextDraftSequence)
  assert.deepEqual(getActiveEntry(second)?.form.selectedCategoryIds, [9])
})

test("openNewDraft mints a new entry once the active draft has content", () => {
  const { state: first } = openNewDraft(createEmptyOpenItemsState(), { categoryIds: [7] })
  const withText = patchEntry(first, first.activeKey!, (entry) => ({
    form: { ...entry.form, description: "started writing" },
  }))

  const { state: second } = openNewDraft(withText, {})

  assert.equal(second.openItems.length, 2)
  assert.equal(second.nextDraftSequence, first.nextDraftSequence + 1)
})

test("walking away from an untouched draft discards it", () => {
  const { state: withDraft } = openNewDraft(openItems([1]), {})
  assert.equal(withDraft.openItems.length, 2)

  const next = activate(withDraft, itemEntryKey(1))

  assert.deepEqual(keys(next), [itemEntryKey(1)])
  assert.equal(next.backStack.length, 0)
})

test("walking away from a draft with content keeps it", () => {
  const { state: withDraft } = openNewDraft(openItems([1]), {})
  const typed = patchEntry(withDraft, withDraft.activeKey!, (entry) => ({
    form: { ...entry.form, description: "worth keeping" },
  }))

  const next = activate(typed, itemEntryKey(1))

  assert.equal(next.openItems.length, 2)
})

test("lowering the cap evicts down to it and returns every dropped entry", () => {
  const state = openItems([1, 2, 3, 4, 5])
  const { state: next, removed } = evictToCap(state, 2)

  assert.equal(next.openItems.length, 2)
  assert.equal(removed.length, 3)
  assert.equal(next.activeKey, itemEntryKey(5))
})

test("patchEntry is a no-op for a key that is gone", () => {
  const state = openItems([1])
  const next = patchEntry(state, "note:999", { saveStatus: "error" })

  assert.equal(next, state)
})

test("the back stack stays bounded across a long session", () => {
  let state = createEmptyOpenItemsState()
  for (let round = 0; round < 20; round += 1) {
    for (const id of [1, 2, 3]) {
      state = openExistingItem(state, makeItem(id), 3).state
    }
  }

  assert.ok(state.backStack.length <= 6, `back stack grew to ${state.backStack.length}`)
})

test("a general new-note action clears category context when reusing an empty draft", () => {
  const initial = openNewDraft(createEmptyOpenItemsState(), {
    categoryIds: [7],
    categoryLabel: "work",
  }).state
  const reused = openNewDraft(initial).state
  assert.equal(reused.openItems.length, 1)
  assert.deepEqual(getActiveEntry(reused)?.form.selectedCategoryIds, [])
  assert.equal(getActiveEntry(reused)?.categoryInputValue, "")
})
