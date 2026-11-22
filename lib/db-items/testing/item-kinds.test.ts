import assert from "node:assert/strict"
import test from "node:test"
import type { ItemCapabilitySource } from "../contracts/item-capabilities"
import { isTextItem } from "../contracts/item-content"
import { isKind, ITEM_KINDS, itemKinds } from "../contracts/item-kinds"
import type { ItemRecord } from "../contracts/items-app"

const source = (values: Partial<ItemCapabilitySource> = {}): ItemCapabilitySource => ({
  description: null,
  timeDue: null,
  timeRemind: null,
  statusId: null,
  ...values,
})

const record = (values: Partial<ItemRecord> = {}): ItemRecord => ({
  id: 1,
  uid: "0b6f1c1e-8f0a-4c56-9d3e-2a7b5c9e4f10",
  workspaceId: 1,
  category: null,
  subcategory: null,
  status: null,
  tags: [],
  description: null,
  timeStart: null,
  timeEnd: null,
  timePlanned: false,
  timeDue: null,
  timeRemind: null,
  timeCreated: "2027-01-02T03:04:05.000Z",
  timeModified: "2027-01-02T03:04:05.000Z",
  ...values,
})

const due = "2027-01-02T03:04:05.000Z"

test("kind keys are unique and are also the lowercase display names", () => {
  const keys = ITEM_KINDS.map((kind) => kind.key)
  assert.equal(new Set(keys).size, keys.length)
  for (const kind of ITEM_KINDS) {
    assert.equal(kind.label, kind.key)
    assert.equal(kind.key, kind.key.toLowerCase())
  }
})

test("a kind follows what the item holds", () => {
  assert.deepEqual(itemKinds(source({ description: "Buy milk" })), ["note"])
  assert.deepEqual(itemKinds(source({ description: "Buy milk", statusId: 4 })), ["note", "task"])
  // A date describes an item and names no kind.
  assert.deepEqual(itemKinds(source({ description: "Buy milk", timeDue: due })), ["note"])
  assert.deepEqual(itemKinds(source({ description: "Buy milk", timeRemind: due })), ["note"])
})

test("state without text is no kind", () => {
  assert.deepEqual(itemKinds(source({ timeDue: due })), [])
  assert.deepEqual(itemKinds(source({ statusId: 4 })), [])
  assert.deepEqual(itemKinds(record({ status: { id: 4, label: "doing" } })), [])
})

test("an item can be several kinds at once", () => {
  const item = record({ description: "Ship release", status: { id: 4, label: "doing" } })
  assert.deepEqual(itemKinds(item), ["note", "task"])
  assert.equal(isKind(item, "note"), true)
  assert.equal(isKind(item, "task"), true)
})

test("removing a status leaves a note, and removing the text leaves no kind", () => {
  const both = record({ description: "Ship release", status: { id: 4, label: "doing" } })
  assert.deepEqual(itemKinds({ ...both, status: null }), ["note"])
  assert.deepEqual(itemKinds({ ...both, description: "   " }), [])
})

test("taxonomy gives an item no kind", () => {
  const filed = record({
    category: { id: 1, label: "work" },
    subcategory: { id: 3, label: "ideas" },
    tags: [{ id: 2, label: "urgent" }],
  })
  assert.deepEqual(itemKinds(filed), [])
})

test("the note view uses the note kind's selection rule", () => {
  const items = [
    record({ description: "A note" }),
    record({ description: "A task", status: { id: 4, label: "doing" } }),
    record({ status: { id: 4, label: "doing" } }),
    record({ description: "  " }),
  ]
  for (const item of items) assert.equal(isTextItem(item), isKind(item, "note"))
  assert.deepEqual(items.map(isTextItem), [true, true, false, false])
})
