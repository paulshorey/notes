import assert from "node:assert/strict"
import test from "node:test"
import type { NoteRecord } from "@lib/db-notes"
import {
  activate,
  closeEntriesForNote,
  closeEntry,
  createEmptyOpenNotesState,
  evictToCap,
  findEntry,
  findEntryByNoteId,
  getActiveEntry,
  getBackTarget,
  goBack,
  isEmptyDraft,
  noteEntryKey,
  openExistingNote,
  openNewDraft,
  patchEntry,
  type OpenNotesState,
} from "../src/stores/openNotes"

const makeNote = (id: number, description = `note ${id}`): NoteRecord => ({
  id,
  userId: 1,
  category: { id: 7, label: "inbox" },
  tags: [],
  description,
  timeDue: null,
  timeRemind: null,
  timeCreated: "2026-01-01T00:00:00.000Z",
  timeModified: `2026-01-0${(id % 9) + 1}T00:00:00.000Z`,
})

const openNotes = (ids: number[], cap = 10): OpenNotesState =>
  ids.reduce(
    (state, id) => openExistingNote(state, makeNote(id), cap).state,
    createEmptyOpenNotesState(),
  )

const keys = (state: OpenNotesState) => state.openNotes.map((entry) => entry.key)

test("openExistingNote activates the note and puts it at the head", () => {
  const state = openNotes([1, 2])

  assert.equal(state.activeKey, noteEntryKey(2))
  assert.deepEqual(keys(state), [noteEntryKey(2), noteEntryKey(1)])
})

test("reopening an already-open note preserves its draft and promotes it", () => {
  let state = openNotes([1, 2])
  state = patchEntry(state, noteEntryKey(1), (entry) => ({
    form: { ...entry.form, description: "unsaved edits" },
  }))

  const { state: reopened } = openExistingNote(state, makeNote(1, "server copy"))

  assert.equal(reopened.activeKey, noteEntryKey(1))
  assert.deepEqual(keys(reopened), [noteEntryKey(1), noteEntryKey(2)])
  assert.equal(getActiveEntry(reopened)?.form.description, "unsaved edits")
})

test("openExistingNote records the record's timeModified as the base revision", () => {
  const note = makeNote(3)
  const { state } = openExistingNote(createEmptyOpenNotesState(), note)

  assert.equal(findEntryByNoteId(state, 3)?.baseTimeModified, note.timeModified)
})

test("exceeding the cap evicts the least recently used entry and reports it", () => {
  let state = openNotes([1, 2, 3], 3)
  const { state: next, removed } = openExistingNote(state, makeNote(4), 3)
  state = next

  assert.equal(state.openNotes.length, 3)
  assert.deepEqual(
    removed.map((entry) => entry.key),
    [noteEntryKey(1)],
  )
  assert.equal(findEntryByNoteId(state, 1), null)
})

test("eviction never drops the active entry", () => {
  const state = openNotes([1, 2, 3], 3)
  const { state: next } = evictToCap(state, 1)

  assert.deepEqual(keys(next), [noteEntryKey(3)])
  assert.equal(next.activeKey, noteEntryKey(3))
})

// The ordering regression: with insert -> evict -> activate, the outgoing entry
// is still active and therefore protected, so nothing can be dropped and the
// cap is silently violated. Every cap above 1 hides this.
test("cap of 1 holds when opening a second note", () => {
  const state = openNotes([1, 2], 1)

  assert.equal(state.openNotes.length, 1)
  assert.deepEqual(keys(state), [noteEntryKey(2)])
  assert.equal(state.activeKey, noteEntryKey(2))
})

test("cap holds even when the least recently used entry is the back target", () => {
  const state = openNotes([1, 2], 2)
  assert.equal(getBackTarget(state)?.key, noteEntryKey(1))

  const { state: next } = openExistingNote(state, makeNote(3), 2)

  assert.equal(next.openNotes.length, 2)
  assert.equal(findEntryByNoteId(next, 1), null)
})

test("goBack walks the visit history rather than toggling", () => {
  let state = openNotes([1, 2, 3])
  assert.equal(state.activeKey, noteEntryKey(3))

  state = goBack(state)
  assert.equal(state.activeKey, noteEntryKey(2))

  state = goBack(state)
  assert.equal(state.activeKey, noteEntryKey(1))
})

test("goBack skips entries that were evicted or closed", () => {
  let state = openNotes([1, 2, 3])
  state = closeEntry(state, noteEntryKey(2)).state
  state = activate(state, noteEntryKey(3))

  state = goBack(state)

  assert.equal(state.activeKey, noteEntryKey(1))
})

test("goBack is a no-op when the stack has no survivors", () => {
  const state = openNotes([1])
  assert.equal(getBackTarget(state), null)
  assert.equal(goBack(state).activeKey, noteEntryKey(1))
})

test("closing the active entry falls back to the back target", () => {
  const state = openNotes([1, 2])
  const { state: next, removed } = closeEntry(state, noteEntryKey(2))

  assert.equal(next.activeKey, noteEntryKey(1))
  assert.deepEqual(
    removed.map((entry) => entry.key),
    [noteEntryKey(2)],
  )
})

test("closing the last entry opens a fresh empty draft", () => {
  const state = openNotes([1])
  const { state: next } = closeEntry(state, noteEntryKey(1))

  assert.equal(next.openNotes.length, 1)
  assert.ok(next.activeKey?.startsWith("draft:"))
  assert.ok(isEmptyDraft(getActiveEntry(next)!))
})

test("closing a background entry leaves the active one alone", () => {
  const state = openNotes([1, 2])
  const { state: next } = closeEntry(state, noteEntryKey(1))

  assert.equal(next.activeKey, noteEntryKey(2))
  assert.deepEqual(keys(next), [noteEntryKey(2)])
})

test("closing purges the key from the back stack", () => {
  let state = openNotes([1, 2, 3])
  state = closeEntry(state, noteEntryKey(1)).state

  assert.ok(!state.backStack.includes(noteEntryKey(1)))
})

test("deleting a note closes its entry wherever it sits", () => {
  const state = openNotes([1, 2, 3])
  const { state: next, removed } = closeEntriesForNote(state, 1)

  assert.equal(findEntryByNoteId(next, 1), null)
  assert.equal(removed.length, 1)
  assert.equal(next.activeKey, noteEntryKey(3))
})

test("a draft keeps its key across the transition to a real note id", () => {
  const { state: opened } = openNewDraft(createEmptyOpenNotesState(), { categoryId: 7 })
  const draftKey = opened.activeKey!
  assert.ok(draftKey.startsWith("draft:"))

  const state = patchEntry(opened, draftKey, {
    noteId: 42,
    baseTimeModified: "2026-02-02T00:00:00.000Z",
    savedSignature: "sig-with-id-42",
  })

  assert.equal(state.activeKey, draftKey)
  assert.equal(findEntry(state, draftKey)?.noteId, 42)
})

test("openNewDraft reuses an untouched draft instead of minting another", () => {
  const { state: first } = openNewDraft(createEmptyOpenNotesState(), { categoryId: 7 })
  const { state: second } = openNewDraft(first, { categoryId: 9 })

  assert.equal(second.openNotes.length, 1)
  assert.equal(second.nextDraftSequence, first.nextDraftSequence)
  assert.equal(getActiveEntry(second)?.form.selectedCategoryId, 9)
})

test("openNewDraft mints a new entry once the active draft has content", () => {
  const { state: first } = openNewDraft(createEmptyOpenNotesState(), { categoryId: 7 })
  const withText = patchEntry(first, first.activeKey!, (entry) => ({
    form: { ...entry.form, description: "started writing" },
  }))

  const { state: second } = openNewDraft(withText, {})

  assert.equal(second.openNotes.length, 2)
  assert.equal(second.nextDraftSequence, first.nextDraftSequence + 1)
})

test("walking away from an untouched draft discards it", () => {
  const { state: withDraft } = openNewDraft(openNotes([1]), {})
  assert.equal(withDraft.openNotes.length, 2)

  const next = activate(withDraft, noteEntryKey(1))

  assert.deepEqual(keys(next), [noteEntryKey(1)])
  assert.equal(next.backStack.length, 0)
})

test("walking away from a draft with content keeps it", () => {
  const { state: withDraft } = openNewDraft(openNotes([1]), {})
  const typed = patchEntry(withDraft, withDraft.activeKey!, (entry) => ({
    form: { ...entry.form, description: "worth keeping" },
  }))

  const next = activate(typed, noteEntryKey(1))

  assert.equal(next.openNotes.length, 2)
})

test("lowering the cap evicts down to it and returns every dropped entry", () => {
  const state = openNotes([1, 2, 3, 4, 5])
  const { state: next, removed } = evictToCap(state, 2)

  assert.equal(next.openNotes.length, 2)
  assert.equal(removed.length, 3)
  assert.equal(next.activeKey, noteEntryKey(5))
})

test("patchEntry is a no-op for a key that is gone", () => {
  const state = openNotes([1])
  const next = patchEntry(state, "note:999", { saveStatus: "error" })

  assert.equal(next, state)
})

test("the back stack stays bounded across a long session", () => {
  let state = createEmptyOpenNotesState()
  for (let round = 0; round < 20; round += 1) {
    for (const id of [1, 2, 3]) {
      state = openExistingNote(state, makeNote(id), 3).state
    }
  }

  assert.ok(state.backStack.length <= 6, `back stack grew to ${state.backStack.length}`)
})
