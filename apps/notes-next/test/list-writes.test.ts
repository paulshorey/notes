import assert from "node:assert/strict"
import test from "node:test"
import type { ItemRecord } from "@lib/db-items"
import { itemDraftFromItem } from "../src/capabilities/draftParts"
import { changesNothing, draftAfterListWrite } from "../src/lib/listWrites"

const item = (overrides: Partial<ItemRecord> = {}): ItemRecord => ({
  id: 1,
  uid: `00000000-0000-4000-8000-${String(1).padStart(12, "0")}`,
  workspaceId: 1,
  category: { id: 7, label: "work" },
  subcategory: { id: 9, label: "plans" },
  status: { id: 4, label: "todo" },
  tags: [
    { id: 31, label: "later" },
    { id: 5, label: "idea" },
  ],
  description: "stored text",
  timeStart: null,
  timeEnd: null,
  entryDate: null,
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

test("a field the user changed after the write was sent keeps the later choice", () => {
  const sent = itemDraftFromItem(item())
  const stored = itemDraftFromItem(item({ status: { id: 6, label: "done" } }))

  // Dropped on "done", then another status picked in the editor before the drop landed.
  const pickedLater = { ...sent, selectedStatusId: 8 }
  assert.equal(draftAfterListWrite(pickedLater, stored, { statusId: 6 }, sent).selectedStatusId, 8)

  // Only text was typed meanwhile, so the status the write stored is taken.
  const typedOnly = { ...sent, description: "typed" }
  assert.equal(draftAfterListWrite(typedOnly, stored, { statusId: 6 }, sent).selectedStatusId, 6)

  const refiledLater = { ...sent, selectedCategoryId: 3, selectedSubcategoryId: null }
  const moved = itemDraftFromItem(item({ category: { id: 2, label: "home" }, subcategory: null }))
  const merged = draftAfterListWrite(
    refiledLater,
    moved,
    { categoryId: 2, subcategoryId: null },
    sent,
  )
  assert.equal(merged.selectedCategoryId, 3)

  const retaggedLater = { ...sent, selectedTagIds: [5] }
  const retagged = itemDraftFromItem(item({ tags: [{ id: 40, label: "new" }] }))
  assert.deepEqual(
    draftAfterListWrite(retaggedLater, retagged, { tagIds: [40] }, sent).selectedTagIds,
    [5],
  )
  assert.deepEqual(
    draftAfterListWrite({ ...sent, selectedTagIds: [5, 31] }, retagged, { tagIds: [40] }, sent)
      .selectedTagIds,
    [40],
    "the same tags in another order are not a later choice",
  )
})
