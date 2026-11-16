import assert from "node:assert/strict"
import test from "node:test"
import type { ItemRecord } from "@lib/db-items"
import { useItemsAppStore } from "../src/stores/itemsAppStore"
import type { OpenItemEntry } from "../src/stores/openItems"
import { canSaveEntry } from "../src/views/registry"

const item = (id: number): ItemRecord => ({
  id,
  workspaceId: 1,
  category: null,
  subcategory: null,
  status: null,
  tags: [],
  description: `note ${id}`,
  timeDue: null,
  timeRemind: null,
  timeCreated: "2026-01-01T00:00:00.000Z",
  timeModified: "2026-01-01T00:00:00.000Z",
})

const store = () => useItemsAppStore.getState()
const viewOf = (itemId: number) => store().openItems.find((entry) => entry.itemId === itemId)?.view

const reset = () => {
  store().setBeforeViewClaim(null)
  store().setActiveView("note", true)
  store().resetDefaultState()
}

test("an entry belongs to the view it is opened in", () => {
  reset()
  store().openExistingItem(item(1))
  assert.equal(viewOf(1), "note")

  store().setActiveView("task", false)
  assert.equal(viewOf(1), "note", "a view that opens its editor on demand leaves the active entry")

  store().openExistingItem(item(2))
  assert.equal(viewOf(2), "task", "opening an item hands it to the view on screen")
  assert.equal(viewOf(1), "note")

  store().activateEntry("note:1")
  assert.equal(viewOf(1), "task", "activating an entry is opening it here")
})

test("an entry that becomes active by itself is taken only by a view that shows it", () => {
  reset()
  store().openExistingItem(item(1))
  store().setActiveView("task", false)
  store().openExistingItem(item(2))
  store().closeEntry("note:2")
  assert.equal(store().activeKey, "note:1")
  assert.equal(viewOf(1), "note", "closing a neighbor does not hand the entry to Tasks")

  store().openExistingItem(item(3))
  assert.equal(viewOf(3), "task")
  store().setActiveView("note", true)
  assert.equal(viewOf(3), "note", "Notes shows the active entry, so it takes it over")
})

test("pending edits are offered for saving before another view takes an entry", () => {
  reset()
  const offered: Array<Pick<OpenItemEntry, "key" | "view">> = []
  store().setBeforeViewClaim((entry) => offered.push({ key: entry.key, view: entry.view }))

  store().openExistingItem(item(1))
  assert.deepEqual(offered, [], "nothing to offer when the view does not change")

  store().setActiveView("task", false)
  assert.deepEqual(offered, [], "a view that leaves the active entry alone takes nothing")

  store().activateEntry("note:1")
  assert.deepEqual(offered, [{ key: "note:1", view: "note" }], "offered with its outgoing view")

  store().activateEntry("note:1")
  assert.equal(offered.length, 1, "an entry already in this view is not offered again")

  store().resetDefaultState()
  assert.equal(store().activeViewKind, "task", "a session reset keeps the view on screen")
  assert.notEqual(store().beforeViewClaim, null, "and the engine's hook")
  reset()
})

test("an entry is saved by the rule of its own view", () => {
  reset()
  store().openNewDraft()
  const draft = store().openItems[0]!
  assert.equal(canSaveEntry({ view: "note", form: { ...draft.form, description: "x" } }), true)
  assert.equal(
    canSaveEntry({ view: "note", form: { ...draft.form, selectedStatusId: 4 } }),
    false,
    "Notes does not save an entry without text",
  )
})
