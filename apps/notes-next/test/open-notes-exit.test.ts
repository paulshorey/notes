import assert from "node:assert/strict"
import test from "node:test"
import {
  collectExitFlushItems,
  collectSessionFlushEntries,
  selectKeepaliveExitItems,
  stateWithDetachedSaves,
  type DetachedSaveSnapshot,
} from "../src/lib/openNotesExit"
import { createDefaultNoteForm, type NoteFormState } from "../src/types/notes"
import {
  createEmptyOpenNotesState,
  type OpenNoteEntry,
  type OpenNoteKey,
} from "../src/stores/openNotes"

const formWith = (description: string, groupId: number | null = 7): NoteFormState => ({
  ...createDefaultNoteForm(),
  description,
  selectedGroupId: groupId,
})

const entry = (
  key: OpenNoteKey,
  noteId: number | null,
  description: string,
  savedDescription: string | null = description,
): OpenNoteEntry => {
  const form = formWith(description)
  const savedForm = savedDescription === null ? null : formWith(savedDescription)
  return {
    key,
    noteId,
    baseTimeModified: null,
    form,
    savedSignature: savedForm === null ? null : JSON.stringify({ d: savedDescription }),
    saveStatus: "idle",
    editorSessionId: 0,
    groupInputValue: "",
    pendingTagLabels: [],
    revealText: null,
    autofocus: false,
    openedAt: 1,
    lastActivatedAt: 1,
  }
}

const isDirty = (item: OpenNoteEntry) =>
  JSON.stringify({ d: item.form.description }) !== item.savedSignature

const isSaveable = (form: NoteFormState) =>
  form.description.trim() !== "" && form.selectedGroupId !== null

test("session flush ignores an untouched default-group draft but keeps real work", () => {
  const untouchedDefaultDraft = entry("draft:0", null, "", null)
  const dirtySavedNote = entry("note:1", 1, "edited", "original")
  const blockedDraft = {
    ...entry("draft:2", null, "started", null),
    form: formWith("started", null),
  }
  const cleanSavedNote = entry("note:3", 3, "unchanged")

  assert.equal(isDirty(untouchedDefaultDraft), true, "a null saved signature reads as dirty")
  assert.deepEqual(
    collectSessionFlushEntries(
      [untouchedDefaultDraft, dirtySavedNote, blockedDraft, cleanSavedNote],
      isDirty,
    ).map((item) => item.key),
    ["note:1", "draft:2"],
    "started drafts stay guarded even when their missing group prevents a save",
  )
})

test("stateWithDetachedSaves appends evicted drafts the ring no longer holds", () => {
  const state = {
    ...createEmptyOpenNotesState(),
    openNotes: [entry("note:1", 1, "still open")],
    activeKey: "note:1",
  }
  const detached = new Map<OpenNoteKey, DetachedSaveSnapshot>([
    [
      "note:2",
      {
        noteId: 2,
        form: formWith("evicted unsaved text"),
        savedSignature: JSON.stringify({ d: "older" }),
      },
    ],
  ])

  const merged = stateWithDetachedSaves(state, detached, 99)

  assert.deepEqual(
    merged.openNotes.map((item) => item.key),
    ["note:1", "note:2"],
  )
  assert.equal(merged.openNotes[1]?.form.description, "evicted unsaved text")
  assert.equal(merged.openNotes[1]?.savedSignature, JSON.stringify({ d: "older" }))
})

test("stateWithDetachedSaves does not duplicate a key still in the ring", () => {
  const live = entry("note:1", 1, "live draft", "older")
  const state = {
    ...createEmptyOpenNotesState(),
    openNotes: [live],
    activeKey: "note:1",
  }
  const detached = new Map<OpenNoteKey, DetachedSaveSnapshot>([
    [
      "note:1",
      {
        noteId: 1,
        form: formWith("stale detached copy"),
        savedSignature: live.savedSignature,
      },
    ],
  ])

  const merged = stateWithDetachedSaves(state, detached)

  assert.equal(merged.openNotes.length, 1)
  assert.equal(merged.openNotes[0]?.form.description, "live draft")
})

test("selectKeepaliveExitItems skips never-saved drafts and already-sent keys", () => {
  const items = collectExitFlushItems(
    [
      entry("note:1", 1, "edited", "original"),
      entry("draft:1", null, "brand new", null),
      entry("note:3", 3, "unchanged"),
    ],
    new Map([
      [
        "note:2",
        {
          noteId: 2,
          form: formWith("evicted"),
          savedSignature: JSON.stringify({ d: "older" }),
        },
      ],
    ]),
    isDirty,
    isSaveable,
  )

  assert.deepEqual(
    items.map((item) => item.key),
    ["note:1", "draft:1", "note:2"],
  )

  const firstHide = selectKeepaliveExitItems(items, new Set())
  assert.deepEqual(
    firstHide.map((item) => item.key),
    ["note:1", "note:2"],
    "a null noteId must not be keepalive-POSTed — reload would POST again",
  )

  const secondHide = selectKeepaliveExitItems(items, new Set(["note:1", "note:2"]))
  assert.deepEqual(secondHide, [], "visibilitychange then pagehide must not fire twice")
})
