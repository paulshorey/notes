import assert from "node:assert/strict"
import test from "node:test"
import type { ItemRecord } from "@lib/db-items"
import { isPublicUid } from "@lib/db-items/contracts/public-uid"
import { createEmptyItemDraft } from "../src/capabilities/draftParts"
import { itemRequestBody, newItemRequestBody } from "../src/lib/itemDraft"
import { reconcileOpenItems, toSnapshot } from "../src/lib/openItemsStorage"
import { newPublicUid } from "../src/lib/publicUid"
import {
  createEmptyOpenItemsState,
  openExistingItem,
  openNewDraft,
  patchEntryForm,
} from "../src/stores/openItems"

const item = (id: number, uid: string): ItemRecord => ({
  id,
  uid,
  workspaceId: 1,
  category: null,
  subcategory: null,
  status: null,
  tags: [],
  description: `note ${id}`,
  timeStart: null,
  timeEnd: null,
  timeDue: null,
  timeRemind: null,
  timeCreated: "2026-01-01T00:00:00.000Z",
  timeModified: "2026-01-01T00:00:00.000Z",
})

test("a new uid is a lowercase UUID, also where randomUUID is unavailable", () => {
  const first = newPublicUid()
  assert.ok(isPublicUid(first))
  assert.notEqual(newPublicUid(), first)

  // Plain HTTP origins have getRandomValues but no randomUUID.
  const original = crypto.randomUUID
  Object.defineProperty(crypto, "randomUUID", { value: undefined, configurable: true })
  try {
    const fallback = newPublicUid()
    assert.ok(isPublicUid(fallback))
    assert.equal(fallback[14], "4", "version 4")
    assert.match(fallback[19]!, /[89ab]/, "RFC 4122 variant")
    assert.notEqual(newPublicUid(), fallback)
  } finally {
    Object.defineProperty(crypto, "randomUUID", { value: original, configurable: true })
  }
})

test("an entry carries its item's uid, and a draft chooses the one its create sends", () => {
  const stored = item(7, "0b6f1c1e-8f0a-4c56-9d3e-2a7b5c9e4f10")
  let state = openExistingItem(createEmptyOpenItemsState(), stored).state
  assert.equal(state.openItems[0]!.uid, stored.uid)

  state = openNewDraft(state).state
  const draft = state.openItems[0]!
  assert.equal(draft.itemId, null)
  assert.ok(isPublicUid(draft.uid))
  assert.notEqual(draft.uid, stored.uid)

  // Editing the draft, and taking a second draft, never changes or shares its uid.
  state = patchEntryForm(state, draft.key, (form) => ({ ...form, description: "typed" }))
  assert.equal(state.openItems.find((entry) => entry.key === draft.key)!.uid, draft.uid)
  const second = openNewDraft(state).state.openItems[0]!
  assert.notEqual(second.key, draft.key)
  assert.notEqual(second.uid, draft.uid)
})

test("only a create names a uid", () => {
  const form = { ...createEmptyItemDraft(), description: "text" }
  const uid = "0b6f1c1e-8f0a-4c56-9d3e-2a7b5c9e4f10"
  assert.deepEqual(newItemRequestBody(form, 3, uid), { uid, ...itemRequestBody(form, 3) })
  assert.equal("uid" in itemRequestBody(form, 3), false)
})

test("a draft keeps its uid across a reload, so a create sent before it is found again", () => {
  let state = openNewDraft(createEmptyOpenItemsState()).state
  const draft = state.openItems[0]!
  state = patchEntryForm(state, draft.key, (form) => ({ ...form, description: "unsaved" }))

  const snapshot = JSON.parse(JSON.stringify(toSnapshot(1, 1, state)))
  const restored = reconcileOpenItems(snapshot, () => undefined).state
  assert.equal(restored.openItems[0]!.uid, draft.uid)

  // A snapshot written before entries had a uid gets one for each draft.
  delete snapshot.entries[0].uid
  const upgraded = reconcileOpenItems(snapshot, () => undefined).state
  assert.ok(isPublicUid(upgraded.openItems[0]!.uid))
})

test("a restored entry takes the uid of its stored item, and an orphan gets a new one", () => {
  const stored = item(7, "0b6f1c1e-8f0a-4c56-9d3e-2a7b5c9e4f10")
  let state = openExistingItem(createEmptyOpenItemsState(), stored).state
  state = patchEntryForm(state, state.openItems[0]!.key, (form) => ({
    ...form,
    description: "edited and not saved",
  }))
  const snapshot = JSON.parse(JSON.stringify(toSnapshot(1, 1, state)))
  snapshot.entries[0].uid = "ffffffff-ffff-4fff-8fff-ffffffffffff"

  const found = reconcileOpenItems(snapshot, (id) => (id === 7 ? stored : undefined)).state
  assert.equal(found.openItems[0]!.uid, stored.uid, "the stored item's uid wins")

  // An entry that was emptied, whose item is gone, leaves nothing behind.
  const emptied = structuredClone(snapshot)
  emptied.entries[0].form.description = ""
  const dropped = reconcileOpenItems(emptied, () => undefined)
  assert.equal(dropped.state.openItems.length, 0)
  assert.equal(dropped.orphanedDraftCount, 0)

  // The item was deleted elsewhere: the text survives as a new draft, a new item.
  const orphaned = reconcileOpenItems(snapshot, () => undefined).state
  assert.equal(orphaned.openItems[0]!.itemId, null)
  assert.ok(isPublicUid(orphaned.openItems[0]!.uid))
  assert.notEqual(orphaned.openItems[0]!.uid, "ffffffff-ffff-4fff-8fff-ffffffffffff")
})
