import assert from "node:assert/strict"
import test from "node:test"
import type { ItemRecord } from "@lib/db-items"
import { useItemsAppStore } from "../src/stores/itemsAppStore"
import type { OpenItemEntry } from "../src/stores/openItems"
import { canSaveEntry } from "../src/views/registry"

const item = (id: number): ItemRecord => ({
  id,
  uid: `00000000-0000-4000-8000-${String(id).padStart(12, "0")}`,
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

test("the engine is asked about pending edits before another view takes an entry", () => {
  reset()
  const offered: Array<Pick<OpenItemEntry, "key" | "view">> = []
  store().setBeforeViewClaim((entry) => {
    offered.push({ key: entry.key, view: entry.view })
    return {}
  })

  store().openExistingItem(item(1))
  assert.deepEqual(offered, [], "nothing to ask when the view does not change")

  store().setActiveView("task", false)
  assert.deepEqual(offered, [], "a view that leaves the active entry alone takes nothing")

  store().activateEntry("note:1")
  assert.deepEqual(offered, [{ key: "note:1", view: "note" }], "asked with its outgoing view")

  store().activateEntry("note:1")
  assert.equal(offered.length, 1, "an entry already in this view is not asked about again")

  store().resetDefaultState()
  assert.equal(store().activeViewKind, "task", "a session reset keeps the view on screen")
  assert.notEqual(store().beforeViewClaim, null, "and the engine's hook")
  reset()
})

const tick = async () => {
  await Promise.resolve()
  await Promise.resolve()
}

test("an entry changes view only after its pending save succeeds", async () => {
  reset()
  store().openExistingItem(item(1))
  store().setActiveView("task", false)

  let settle: (saved: boolean) => void = () => undefined
  const waiting = () => ({ wait: new Promise<boolean>((resolve) => (settle = resolve)) })
  store().setBeforeViewClaim(waiting)
  store().activateEntry("note:1")
  assert.equal(viewOf(1), "note", "the outgoing rule still applies while the save runs")
  assert.deepEqual(store().pendingViewClaim, { key: "note:1", view: "task" })
  settle(false)
  await tick()
  assert.equal(viewOf(1), "note", "a failed save keeps the entry under the rule it was made by")
  assert.notEqual(store().pendingViewClaim, null, "and the hand-over keeps waiting")

  store().finishViewClaim("note:2")
  assert.equal(viewOf(1), "note", "another entry's save completes nothing")
  store().finishViewClaim("note:1")
  assert.equal(viewOf(1), "task", "a later successful save completes the hand-over")
  assert.equal(store().pendingViewClaim, null)

  // The user moved on before the save landed: the hand-over is no longer wanted.
  store().setBeforeViewClaim(() => ({}))
  store().setActiveView("note", true)
  assert.equal(viewOf(1), "note")
  store().setActiveView("task", false)
  store().setBeforeViewClaim(waiting)
  store().activateEntry("note:1")
  store().setBeforeViewClaim(() => ({}))
  store().setActiveView("note", true)
  settle(true)
  await tick()
  assert.equal(
    viewOf(1),
    "note",
    "a late save does not hand the entry to a view no longer on screen",
  )
  assert.equal(store().pendingViewClaim, null)
  reset()
})

test("edits the outgoing view refused are dropped as the entry changes view", () => {
  reset()
  store().openExistingItem(item(1))
  store().patchEntryForm("note:1", (form) => ({ ...form, description: "" }))
  store().setActiveView("task", false)
  store().setBeforeViewClaim((entry) => ({
    restore: { form: { ...entry.form, description: "note 1" }, savedSignature: "stored" },
  }))
  store().activateEntry("note:1")
  const entry = store().openItems.find((open) => open.itemId === 1)!
  assert.equal(entry.view, "task")
  assert.equal(entry.form.description, "note 1", "the stored text is back")
  assert.equal(entry.savedSignature, "stored")
  reset()
})

test("every open or activation is an open request, even for the active entry", () => {
  reset()
  const before = store().openRequestCount
  store().openExistingItem(item(1))
  store().activateEntry("note:1")
  store().openExistingItem(item(1))
  store().openNewDraft()
  assert.equal(store().openRequestCount, before + 4)
  store().closeEntry("note:1")
  assert.equal(store().openRequestCount, before + 4, "closing an entry is not opening one")
  reset()
})

test("an entry is saved by the rule of its own view", () => {
  reset()
  store().openNewDraft()
  const draft = store().openItems[0]!
  assert.equal(
    canSaveEntry({ view: "note", itemId: null, form: { ...draft.form, description: "x" } }),
    true,
  )
  assert.equal(
    canSaveEntry({ view: "note", itemId: 3, form: { ...draft.form, selectedStatusId: 4 } }),
    false,
    "Notes does not save an entry without text",
  )
})
