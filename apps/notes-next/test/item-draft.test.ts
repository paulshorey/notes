import assert from "node:assert/strict"
import test from "node:test"
import type { ItemRecord } from "@lib/db-items"
import {
  createEmptyItemDraft,
  isBlankItemDraft,
  itemDraftFromItem,
  itemDraftRequest,
  itemListLabel,
} from "../src/capabilities/draftParts"
import { toDateTimeLocalValue } from "../src/lib/dates"
import { itemRequestBody, serializeItemDraft } from "../src/lib/itemDraft"
import {
  getNotesViewHiddenKindsPreference,
  withNotesViewKindVisibility,
} from "../src/lib/userPreferences"
import { ITEM_VIEWS, viewForKind, viewForPath } from "../src/views/registry"

const item = (overrides: Partial<ItemRecord> = {}): ItemRecord => ({
  id: 12,
  uid: `00000000-0000-4000-8000-${String(12).padStart(12, "0")}`,
  workspaceId: 3,
  category: { id: 7, label: "work" },
  subcategory: { id: 9, label: "plans" },
  status: { id: 4, label: "doing" },
  tags: [
    { id: 31, label: "later" },
    { id: 5, label: "idea" },
  ],
  description: "Ship the shell\nand the views",
  timeDue: "2026-03-04T15:30:00.000Z",
  timeRemind: null,
  timeCreated: "2026-01-01T00:00:00.000Z",
  timeModified: "2026-01-02T00:00:00.000Z",
  ...overrides,
})

test("an empty draft holds every part and nothing to save", () => {
  assert.deepEqual(createEmptyItemDraft(), {
    selectedCategoryId: null,
    selectedSubcategoryId: null,
    selectedStatusId: null,
    selectedTagIds: [],
    description: "",
    timeDue: null,
    timeRemind: null,
    dueExpanded: false,
    remindExpanded: false,
  })
})

test("a stored item fills every part of the draft", () => {
  assert.deepEqual(itemDraftFromItem(item()), {
    selectedCategoryId: 7,
    selectedSubcategoryId: 9,
    selectedStatusId: 4,
    selectedTagIds: [31, 5],
    description: "Ship the shell\nand the views",
    timeDue: toDateTimeLocalValue("2026-03-04T15:30:00.000Z"),
    timeRemind: null,
    dueExpanded: true,
    remindExpanded: false,
  })
  assert.equal(itemDraftFromItem(item({ description: null })).description, "")
})

// Browsers keep entry signatures across reloads, so the serialized form is a stored
// format: a different key order or value would mark every open entry as edited.
test("the signature and the request keep their stored field order", () => {
  const draft = {
    ...createEmptyItemDraft(),
    selectedCategoryId: 7,
    selectedSubcategoryId: 9,
    selectedStatusId: 4,
    selectedTagIds: [31, 5],
    description: "text",
    timeDue: "2026-03-04T10:30",
    timeRemind: "2026-03-04T09:00",
    dueExpanded: true,
    remindExpanded: false,
  }
  assert.equal(
    serializeItemDraft(12, draft),
    '{"itemId":12,"categoryId":7,"subcategoryId":9,"statusId":4,"tagIds":[5,31],' +
      '"description":"text","timeDue":"2026-03-04T10:30","timeRemind":null}',
  )
  assert.equal(
    JSON.stringify(itemRequestBody(draft, 3)),
    '{"workspaceId":3,"categoryId":7,"subcategoryId":9,"statusId":4,"tagIds":[5,31],' +
      '"description":"text","timeDue":"2026-03-04T10:30","timeRemind":null}',
  )
  assert.deepEqual(draft.selectedTagIds, [31, 5])
})

test("form state that is not saved does not make a draft dirty", () => {
  const saved = itemDraftFromItem(item({ timeDue: null }))
  const expandedThenCollapsed = { ...saved, timeDue: "2026-03-04T10:30", dueExpanded: false }
  assert.deepEqual(itemDraftRequest(expandedThenCollapsed), itemDraftRequest(saved))
})

test("a list names an item by its text, then by what else it holds", () => {
  assert.equal(itemListLabel(item()), "Ship the shell")
  assert.equal(itemListLabel(item({ description: null })), "doing")
  assert.match(itemListLabel(item({ description: "  ", status: null })), /^Due \S+/)
  assert.match(
    itemListLabel(
      item({
        description: null,
        status: null,
        timeDue: null,
        timeRemind: "2026-03-04T15:30:00.000Z",
      }),
    ),
    /^Reminder \S+/,
  )
  assert.equal(itemListLabel(item({ description: null, status: null, timeDue: null })), "Untitled")
})

test("a draft is blank until the user puts something in; presets do not count", () => {
  const empty = createEmptyItemDraft()
  assert.equal(isBlankItemDraft(empty), true)
  assert.equal(
    isBlankItemDraft({ ...empty, selectedCategoryId: 7, selectedSubcategoryId: 9 }),
    true,
  )
  assert.equal(isBlankItemDraft({ ...empty, selectedStatusId: 4 }), true)
  assert.equal(isBlankItemDraft({ ...empty, description: " \n " }), true)

  assert.equal(isBlankItemDraft({ ...empty, description: "x" }), false)
  assert.equal(isBlankItemDraft({ ...empty, selectedTagIds: [5] }), false)
  assert.equal(isBlankItemDraft({ ...empty, dueExpanded: true }), false)
  assert.equal(isBlankItemDraft({ ...empty, timeRemind: "2026-03-04T09:00" }), false)
})

test("the note view starts a note only once it has text", () => {
  const notes = viewForPath("/")
  assert.equal(notes.kind, "note")
  const empty = createEmptyItemDraft()
  assert.equal(notes.canCreate({ ...empty, description: "x" }), true)
  assert.equal(notes.canCreate({ ...empty, description: "  " }), false)
  assert.equal(
    notes.canCreate({ ...empty, selectedStatusId: 4, selectedTagIds: [5], dueExpanded: true }),
    false,
  )
})

test("a path belongs to the view with the longest matching route", () => {
  assert.equal(viewForPath("/").route, "/")
  assert.equal(viewForPath("/somewhere/else").route, "/")
  for (const view of ITEM_VIEWS) {
    assert.equal(viewForPath(view.route), view)
    if (view.route !== "/") assert.equal(viewForPath(`${view.route}/12`), view)
  }
})

test("the notes view lists everything with text except the kinds left out of it", () => {
  const record = (values: Partial<ItemRecord>): ItemRecord => ({
    id: 1,
    uid: "00000000-0000-4000-8000-000000000001",
    workspaceId: 1,
    category: null,
    subcategory: null,
    status: null,
    tags: [],
    description: "text",
    timeDue: null,
    timeRemind: null,
    timeCreated: "2026-01-01T00:00:00.000Z",
    timeModified: "2026-01-01T00:00:00.000Z",
    ...values,
  })
  const note = record({})
  const task = record({ status: { id: 4, label: "doing" } })
  const notes = viewForKind("note")
  const tasks = viewForKind("task")
  const all = { notesViewHiddenKinds: [] }
  const withoutTasks = { notesViewHiddenKinds: ["task" as const] }

  assert.deepEqual(notes.optionalKinds, ["task"])
  assert.equal(notes.selects(note, all), true)
  assert.equal(notes.selects(task, all), true, "a task has text, so notes lists it")
  assert.equal(notes.selects(note, withoutTasks), true)
  assert.equal(notes.selects(task, withoutTasks), false)
  // The choice belongs to the notes view; the task view lists every task regardless.
  assert.equal(tasks.selects(task, withoutTasks), true)
  assert.equal(tasks.selects(note, all), false)
})

test("the kinds left out of the notes view are a preference, and unknown names are ignored", () => {
  assert.deepEqual(getNotesViewHiddenKindsPreference({}), [])
  const hidden = withNotesViewKindVisibility({ notesApp: { maxOpenNotes: 5 } }, "task", false)
  assert.deepEqual(hidden.notesApp, { maxOpenNotes: 5, notesViewHiddenKinds: ["task"] })
  assert.deepEqual(getNotesViewHiddenKindsPreference(hidden), ["task"])
  assert.deepEqual(withNotesViewKindVisibility(hidden, "task", false), hidden)
  assert.deepEqual(
    getNotesViewHiddenKindsPreference(withNotesViewKindVisibility(hidden, "task", true)),
    [],
  )
  assert.deepEqual(
    getNotesViewHiddenKindsPreference({ notesApp: { notesViewHiddenKinds: ["journal", "task"] } }),
    ["task"],
  )
})
