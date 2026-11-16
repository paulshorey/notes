import assert from "node:assert/strict"
import test from "node:test"
import type { ItemRecord } from "@lib/db-items"
import { itemDraftFromItem } from "../src/capabilities/draftParts"
import { changesNothing, draftAfterListWrite } from "../src/lib/listWrites"

const item = (overrides: Partial<ItemRecord> = {}): ItemRecord => ({
  id: 1,
  workspaceId: 1,
  category: { id: 7, label: "work" },
  subcategory: { id: 9, label: "plans" },
  status: { id: 4, label: "todo" },
  tags: [
    { id: 31, label: "later" },
    { id: 5, label: "idea" },
  ],
  description: "stored text",
  timeDue: null,
  timeRemind: null,
  timeCreated: "2026-01-01T00:00:00.000Z",
  timeModified: "2026-01-01T00:00:00.000Z",
  ...overrides,
})

test("a change is compared with the item as stored, not as listed", () => {
  assert.equal(changesNothing(item(), { statusId: 4 }), true)
  assert.equal(changesNothing(item(), { statusId: 6 }), false)
  assert.equal(changesNothing(item(), { statusId: null }), false)
  assert.equal(changesNothing(item({ status: null }), { statusId: null }), true)
  assert.equal(changesNothing(item(), { tagIds: [5, 31] }), true, "tag order is not a change")
  assert.equal(changesNothing(item(), { tagIds: [5] }), false)
  assert.equal(changesNothing(item(), { categoryId: 7, subcategoryId: 9 }), true)
  assert.equal(changesNothing(item(), { categoryId: 7, subcategoryId: null }), false)

  // Dragged away and back while the first move was still on its way: once the first
  // move is stored, the drop back to the column the list still showed is a real change.
  const afterFirstMove = item({ status: { id: 6, label: "done" } })
  assert.equal(changesNothing(afterFirstMove, { statusId: 4 }), false)
})

test("edits typed while a list write was in flight survive it", () => {
  const typed = { ...itemDraftFromItem(item()), description: "typed during the move" }
  const stored = itemDraftFromItem(item({ status: { id: 6, label: "done" } }))

  const merged = draftAfterListWrite(typed, stored, { statusId: 6 })
  assert.equal(merged.description, "typed during the move")
  assert.equal(merged.selectedStatusId, 6, "the status the write stored is taken")
  assert.deepEqual(merged.selectedTagIds, [31, 5])

  const refiled = draftAfterListWrite(
    { ...typed, selectedStatusId: 8 },
    itemDraftFromItem(item({ category: { id: 2, label: "home" }, subcategory: null })),
    { categoryId: 2, subcategoryId: null },
  )
  assert.equal(refiled.selectedCategoryId, 2)
  assert.equal(refiled.selectedSubcategoryId, null)
  assert.equal(refiled.selectedStatusId, 8, "fields the write did not change keep the edit")
  assert.equal(refiled.description, "typed during the move")
})
