import assert from "node:assert/strict"
import test from "node:test"
import type { NoteRecord } from "@lib/db-notes"
import { serializeNoteDraft } from "../src/lib/noteDraft"
import { noteToFormState, createDefaultNoteForm } from "../src/types/notes"
import {
  reconcileOpenNotes,
  type OpenNotesSnapshot,
} from "../src/lib/openNotesStorage"

const makeNote = (id: number, description: string, timeModified = "2026-03-01T00:00:00.000Z"): NoteRecord => ({
  id,
  userId: 1,
  groupId: 7,
  tags: [],
  description,
  timeDue: null,
  timeRemind: null,
  timeCreated: "2026-01-01T00:00:00.000Z",
  timeModified,
})

const cleanEntry = (note: NoteRecord) => {
  const form = noteToFormState(note)
  return {
    key: `note:${note.id}`,
    noteId: note.id,
    baseTimeModified: note.timeModified,
    form,
    savedSignature: serializeNoteDraft(note.id, form),
    groupInputValue: "inbox",
    pendingTagLabels: [],
    openedAt: Date.now(),
    lastActivatedAt: Date.now(),
  }
}

const dirtyEntry = (note: NoteRecord, typed: string) => {
  const entry = cleanEntry(note)
  return { ...entry, form: { ...entry.form, description: typed } }
}

const snapshotOf = (entries: OpenNotesSnapshot["entries"]): OpenNotesSnapshot => ({
  schemaVersion: 2,
  userId: 1,
  activeKey: entries[0]?.key ?? null,
  backStack: [],
  nextDraftSequence: 0,
  entries,
  savedAt: Date.now(),
})

const lookupFrom = (notes: NoteRecord[]) => (id: number) => notes.find((note) => note.id === id)

test("a clean entry adopts a newer server record", () => {
  const stored = makeNote(1, "original")
  const server = makeNote(1, "edited on another device", "2026-04-01T00:00:00.000Z")

  const { state } = reconcileOpenNotes(snapshotOf([cleanEntry(stored)]), lookupFrom([server]))

  assert.equal(state.openNotes[0]?.form.description, "edited on another device")
  assert.equal(state.openNotes[0]?.baseTimeModified, server.timeModified)
})

test("a dirty entry keeps the local draft even when the server is newer", () => {
  const stored = makeNote(1, "original")
  const server = makeNote(1, "edited elsewhere", "2026-04-01T00:00:00.000Z")

  const { state } = reconcileOpenNotes(
    snapshotOf([dirtyEntry(stored, "my unsaved words")]),
    lookupFrom([server]),
  )

  assert.equal(state.openNotes[0]?.form.description, "my unsaved words")
})

test("a clean entry whose note was deleted is dropped silently", () => {
  const { state, orphanedDraftCount } = reconcileOpenNotes(
    snapshotOf([cleanEntry(makeNote(1, "gone"))]),
    lookupFrom([]),
  )

  assert.equal(state.openNotes.length, 0)
  assert.equal(orphanedDraftCount, 0)
})

test("a dirty entry whose note was deleted survives as a draft and is reported", () => {
  const { state, orphanedDraftCount } = reconcileOpenNotes(
    snapshotOf([dirtyEntry(makeNote(1, "gone"), "words I never saw saved")]),
    lookupFrom([]),
  )

  assert.equal(orphanedDraftCount, 1)
  assert.equal(state.openNotes.length, 1)
  assert.equal(state.openNotes[0]?.noteId, null)
  assert.ok(state.openNotes[0]?.key.startsWith("draft:"))
  assert.equal(state.openNotes[0]?.form.description, "words I never saw saved")
})

test("an empty never-saved draft is dropped and a non-empty one is kept", () => {
  const base = {
    noteId: null,
    baseTimeModified: null,
    savedSignature: null,
    groupInputValue: "",
    pendingTagLabels: [],
    openedAt: Date.now(),
    lastActivatedAt: Date.now(),
  }

  const { state } = reconcileOpenNotes(
    snapshotOf([
      { ...base, key: "draft:0", form: createDefaultNoteForm() },
      { ...base, key: "draft:1", form: { ...createDefaultNoteForm(), description: "kept" } },
    ]),
    lookupFrom([]),
  )

  assert.deepEqual(
    state.openNotes.map((entry) => entry.key),
    ["draft:1"],
  )
})

test("a form referencing a deleted category is remapped to the fallback", () => {
  const note = makeNote(1, "text")

  const { state } = reconcileOpenNotes(snapshotOf([cleanEntry(note)]), lookupFrom([note]), {
    groupExists: () => false,
    fallbackGroupId: 99,
  })

  assert.equal(state.openNotes[0]?.form.selectedGroupId, 99)
})

test("a clean entry untouched for 90 days is dropped", () => {
  const note = makeNote(1, "stale")
  const entry = { ...cleanEntry(note), lastActivatedAt: Date.now() - 91 * 24 * 60 * 60 * 1000 }

  const { state } = reconcileOpenNotes(snapshotOf([entry]), lookupFrom([note]))

  assert.equal(state.openNotes.length, 0)
})

test("a stale but dirty entry is never dropped", () => {
  const note = makeNote(1, "stale")
  const entry = {
    ...dirtyEntry(note, "unsaved"),
    lastActivatedAt: Date.now() - 400 * 24 * 60 * 60 * 1000,
  }

  const { state } = reconcileOpenNotes(snapshotOf([entry]), lookupFrom([note]))

  assert.equal(state.openNotes.length, 1)
})

// The blanket guard against the signature bug: if the user did not type it,
// reconciliation must not leave it looking like they did. Asserted across every
// case at once so it keeps holding as new rules are added.
test("no reconciliation outcome leaves an unedited entry dirty", () => {
  const stored = makeNote(1, "original")
  const server = makeNote(1, "server moved on", "2026-04-01T00:00:00.000Z")
  const untouched = makeNote(2, "untouched")

  const { state } = reconcileOpenNotes(
    snapshotOf([cleanEntry(stored), cleanEntry(untouched)]),
    lookupFrom([server, untouched]),
    { groupExists: () => false, fallbackGroupId: 99 },
  )

  for (const entry of state.openNotes) {
    assert.equal(
      serializeNoteDraft(entry.noteId, entry.form),
      entry.savedSignature,
      `entry ${entry.key} loaded dirty and would autosave immediately`,
    )
  }
})

test("reconciling twice matches reconciling once", () => {
  const stored = makeNote(1, "original")
  const server = makeNote(1, "server moved on", "2026-04-01T00:00:00.000Z")
  const snapshot = snapshotOf([cleanEntry(stored), dirtyEntry(makeNote(2, "b"), "typed")])
  const lookup = lookupFrom([server, makeNote(2, "b")])

  const once = reconcileOpenNotes(snapshot, lookup, { now: 1_000 })
  const twice = reconcileOpenNotes(
    {
      ...snapshot,
      entries: once.state.openNotes.map((entry) => ({
        key: entry.key,
        noteId: entry.noteId,
        baseTimeModified: entry.baseTimeModified,
        form: entry.form,
        savedSignature: entry.savedSignature,
        groupInputValue: entry.groupInputValue,
        pendingTagLabels: entry.pendingTagLabels,
        openedAt: entry.openedAt,
        lastActivatedAt: entry.lastActivatedAt,
      })),
    },
    lookup,
    { now: 1_000 },
  )

  assert.deepEqual(
    twice.state.openNotes.map((entry) => [entry.key, entry.form.description]),
    once.state.openNotes.map((entry) => [entry.key, entry.form.description]),
  )
})

test("a wrong-user, wrong-version, or malformed snapshot never reaches reconcile", async () => {
  const { readOpenNotesSnapshot } = await import("../src/lib/openNotesStorage")
  // No window in the node test runner, so the reader must degrade to null
  // rather than throwing.
  assert.equal(readOpenNotesSnapshot(1), null)
})

/**
 * Upgrading a v1 snapshot, not rejecting it.
 *
 * `isSnapshot` used to reject any unknown schemaVersion, and the caller reads
 * null as "nothing to restore" — so a bare version bump would have discarded
 * every unsaved draft in every browser on the first load after deploy, with no
 * error anywhere. These pin the migration instead.
 */
const legacySnapshot = (
  entries: Array<{
    key: string
    noteId: number | null
    categoryId: number | null
    description: string
    savedSignature: string | null
  }>,
): OpenNotesSnapshot =>
  ({
    schemaVersion: 1,
    userId: 1,
    activeKey: entries[0]?.key ?? null,
    backStack: [],
    nextDraftSequence: 0,
    savedAt: Date.now(),
    entries: entries.map((entry) => ({
      key: entry.key,
      noteId: entry.noteId,
      baseTimeModified: null,
      form: {
        ...createDefaultNoteForm(),
        selectedCategoryId: entry.categoryId,
        description: entry.description,
      },
      savedSignature: entry.savedSignature,
      groupInputValue: "",
      pendingTagLabels: [],
      openedAt: Date.now(),
      lastActivatedAt: Date.now(),
    })),
  }) as unknown as OpenNotesSnapshot

/** The v1 signature format, which is what a clean v1 entry stored. */
const legacySignature = (noteId: number | null, categoryId: number | null, description: string) =>
  JSON.stringify({
    noteId,
    categoryId,
    tagIds: [],
    description,
    timeDue: null,
    timeRemind: null,
  })

test("a v1 snapshot maps each category to its group instead of being discarded", () => {
  const note = makeNote(1, "saved text")
  const snapshot = legacySnapshot([
    {
      key: "note:1",
      noteId: 1,
      categoryId: 40,
      description: "saved text",
      savedSignature: legacySignature(1, 40, "saved text"),
    },
  ])

  const { state } = reconcileOpenNotes(snapshot, () => note, {
    // The fallback is deliberately a *different* group, so landing on 7 can
    // only happen by actually mapping the old category rather than by the
    // repair branch rescuing an undefined id.
    groupExists: (groupId) => groupId === 7 || groupId === 99,
    fallbackGroupId: 99,
    // The migration creates one group under every category, so this is total.
    defaultGroupForCategory: (categoryId) => (categoryId === 40 ? 7 : undefined),
  })

  assert.equal(state.openNotes.length, 1)
  assert.equal(state.openNotes[0]!.form.selectedGroupId, 7)
})

test("a clean v1 entry does not load dirty after the upgrade", () => {
  const note = makeNote(1, "saved text")
  const snapshot = legacySnapshot([
    {
      key: "note:1",
      noteId: 1,
      categoryId: 40,
      description: "saved text",
      savedSignature: legacySignature(1, 40, "saved text"),
    },
  ])

  const { state } = reconcileOpenNotes(snapshot, () => note, {
    groupExists: (groupId) => groupId === 7,
    fallbackGroupId: 7,
    defaultGroupForCategory: () => 7,
  })

  const entry = state.openNotes[0]!
  // A v1 signature can never match a v2 one, so an upgrade that forgot to
  // recompute this would mark every restored note dirty and fire a save storm
  // on the first load after deploy.
  assert.equal(serializeNoteDraft(entry.noteId, entry.form), entry.savedSignature)
})

test("a dirty v1 entry keeps its unsaved text and stays dirty", () => {
  const note = makeNote(1, "saved text")
  const snapshot = legacySnapshot([
    {
      key: "note:1",
      noteId: 1,
      categoryId: 40,
      description: "typed but not saved",
      savedSignature: legacySignature(1, 40, "saved text"),
    },
  ])

  const { state } = reconcileOpenNotes(snapshot, () => note, {
    groupExists: (groupId) => groupId === 7 || groupId === 99,
    fallbackGroupId: 99,
    defaultGroupForCategory: (categoryId) => (categoryId === 40 ? 7 : undefined),
  })

  const entry = state.openNotes[0]!
  assert.equal(entry.form.description, "typed but not saved")
  // Placement survives too: a dirty entry must not be quietly relocated.
  assert.equal(entry.form.selectedGroupId, 7)
  assert.notEqual(serializeNoteDraft(entry.noteId, entry.form), entry.savedSignature)
})

test("a v1 entry whose category is gone lands on the fallback group", () => {
  const note = makeNote(1, "saved text")
  const snapshot = legacySnapshot([
    {
      key: "note:1",
      noteId: 1,
      categoryId: 999,
      description: "saved text",
      savedSignature: legacySignature(1, 999, "saved text"),
    },
  ])

  const { state } = reconcileOpenNotes(snapshot, () => note, {
    groupExists: (groupId) => groupId === 7,
    fallbackGroupId: 7,
    defaultGroupForCategory: () => undefined,
  })

  const entry = state.openNotes[0]!
  assert.equal(entry.form.selectedGroupId, 7)
  // Still not a user edit, so it must not read as dirty.
  assert.equal(serializeNoteDraft(entry.noteId, entry.form), entry.savedSignature)
})
