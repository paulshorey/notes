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
import { ITEM_VIEWS, viewForPath } from "../src/views/registry"

const item = (overrides: Partial<ItemRecord> = {}): ItemRecord => ({
  id: 12,
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

test("the Notes view saves a draft only once it has text", () => {
  const notes = viewForPath("/")
  assert.equal(notes.kind, "note")
  const empty = createEmptyItemDraft()
  assert.equal(notes.canSave({ ...empty, description: "x" }), true)
  assert.equal(notes.canSave({ ...empty, description: "  " }), false)
  assert.equal(
    notes.canSave({ ...empty, selectedStatusId: 4, selectedTagIds: [5], dueExpanded: true }),
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
