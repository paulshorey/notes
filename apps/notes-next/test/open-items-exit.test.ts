import assert from "node:assert/strict"
import test from "node:test"
import {
  collectExitFlushItems,
  collectSessionFlushEntries,
  selectKeepaliveExitItems,
  stateWithDetachedSaves,
  type DetachedSaveSnapshot,
} from "../src/lib/openItemsExit"
import { createDefaultTextCaptureForm, type TextCaptureFormState } from "../src/types/items"
import {
  createEmptyOpenItemsState,
  type OpenItemEntry,
  type OpenItemKey,
} from "../src/stores/openItems"

const formWith = (description: string, categoryId: number | null = 7): TextCaptureFormState => ({
  ...createDefaultTextCaptureForm(),
  description,
  selectedCategoryId: categoryId,
})

const entry = (
  key: OpenItemKey,
  itemId: number | null,
  description: string,
  savedDescription: string | null = description,
): OpenItemEntry => {
  const form = formWith(description)
  const savedForm = savedDescription === null ? null : formWith(savedDescription)
  return {
    key,
    itemId,
    view: "note",
    baseTimeModified: null,
    form,
    savedSignature: savedForm === null ? null : JSON.stringify({ d: savedDescription }),
    saveStatus: "idle",
    editorSessionId: 0,
    categoryInputValue: "",
    pendingTagLabels: [],
    revealText: null,
    autofocus: false,
    openedAt: 1,
    lastActivatedAt: 1,
  }
}

const isDirty = (item: OpenItemEntry) =>
  JSON.stringify({ d: item.form.description }) !== item.savedSignature

const isSaveable = ({ form }: { form: TextCaptureFormState }) => form.description.trim() !== ""

test("session flush ignores an untouched draft but keeps real work", () => {
  const untouchedDraft = entry("draft:0", null, "", null)
  const dirtySavedItem = entry("note:1", 1, "edited", "original")
  const blockedDraft = {
    ...entry("draft:2", null, "started", null),
    form: formWith("started", null),
  }
  const cleanSavedItem = entry("note:3", 3, "unchanged")

  assert.equal(isDirty(untouchedDraft), true, "a null saved signature reads as dirty")
  assert.deepEqual(
    collectSessionFlushEntries(
      [untouchedDraft, dirtySavedItem, blockedDraft, cleanSavedItem],
      isDirty,
      isSaveable,
    ).map((item) => item.key),
    ["note:1", "draft:2"],
    "started drafts stay guarded even when their missing workspace prevents a save",
  )
})

test("session flush never waits for an entry its view does not save", () => {
  const withForm = (base: OpenItemEntry, form: Partial<TextCaptureFormState>): OpenItemEntry => ({
    ...base,
    form: { ...base.form, ...form },
  })
  const tagOnlyDraft = withForm(entry("draft:0", null, "", null), { selectedTagIds: [5] })
  const pendingTagDraft = { ...entry("draft:1", null, "", null), pendingTagLabels: ["later"] }
  const dateOnlyDraft = withForm(entry("draft:2", null, "", null), {
    dueExpanded: true,
    timeDue: "2026-03-04T10:30",
  })
  const statusOnlyDraft = withForm(entry("draft:3", null, "", null), { selectedStatusId: 4 })
  const clearedStoredItem = entry("note:4", 4, "", "had text")
  const writtenDraft = withForm(entry("draft:5", null, "written", null), { selectedTagIds: [5] })

  const entries = [
    tagOnlyDraft,
    pendingTagDraft,
    dateOnlyDraft,
    statusOnlyDraft,
    clearedStoredItem,
    writtenDraft,
  ]
  for (const item of entries) assert.equal(isDirty(item), true, `${item.key} reads as dirty`)

  assert.deepEqual(
    collectSessionFlushEntries(entries, isDirty, isSaveable).map((item) => item.key),
    ["draft:5"],
    "only the entry the view would save is flushed",
  )
  assert.deepEqual(
    collectSessionFlushEntries(entries, isDirty, () => true).map((item) => item.key),
    ["draft:0", "draft:1", "draft:2", "note:4", "draft:5"],
    "a view that saves any content waits for every started entry",
  )
})

test("stateWithDetachedSaves appends evicted drafts the ring no longer holds", () => {
  const state = {
    ...createEmptyOpenItemsState(),
    openItems: [entry("note:1", 1, "still open")],
    activeKey: "note:1",
  }
  const detached = new Map<OpenItemKey, DetachedSaveSnapshot>([
    [
      "note:2",
      {
        itemId: 2,
        form: formWith("evicted unsaved text"),
        savedSignature: JSON.stringify({ d: "older" }),
        view: "note",
      },
    ],
  ])

  const merged = stateWithDetachedSaves(state, detached, 99)

  assert.deepEqual(
    merged.openItems.map((item) => item.key),
    ["note:1", "note:2"],
  )
  assert.equal(merged.openItems[1]?.form.description, "evicted unsaved text")
  assert.equal(merged.openItems[1]?.savedSignature, JSON.stringify({ d: "older" }))
})

test("stateWithDetachedSaves does not duplicate a key still in the ring", () => {
  const live = entry("note:1", 1, "live draft", "older")
  const state = {
    ...createEmptyOpenItemsState(),
    openItems: [live],
    activeKey: "note:1",
  }
  const detached = new Map<OpenItemKey, DetachedSaveSnapshot>([
    [
      "note:1",
      {
        itemId: 1,
        form: formWith("stale detached copy"),
        savedSignature: live.savedSignature,
        view: "note",
      },
    ],
  ])

  const merged = stateWithDetachedSaves(state, detached)

  assert.equal(merged.openItems.length, 1)
  assert.equal(merged.openItems[0]?.form.description, "live draft")
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
          itemId: 2,
          form: formWith("evicted"),
          savedSignature: JSON.stringify({ d: "older" }),
          view: "note",
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
