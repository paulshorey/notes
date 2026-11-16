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
  timeDue: null,
  timeRemind: null,
  timeCreated: "2027-01-02T03:04:05.000Z",
  timeModified: "2027-01-02T03:04:05.000Z",
  ...values,
})

const due = "2027-01-02T03:04:05.000Z"

test("kind keys are unique and every kind has a label", () => {
  const keys = ITEM_KINDS.map((kind) => kind.key)
  assert.equal(new Set(keys).size, keys.length)
  for (const kind of ITEM_KINDS) assert.ok(kind.label.trim())
})

test("a kind follows what the item holds", () => {
  assert.deepEqual(itemKinds(source({ description: "Buy milk" })), ["note"])
  assert.deepEqual(itemKinds(source({ timeDue: due })), ["task"])
  assert.deepEqual(itemKinds(source({ timeRemind: due })), ["task"])
  assert.deepEqual(itemKinds(source({ statusId: 4 })), ["task"])
  assert.deepEqual(itemKinds(record({ status: { id: 4, label: "doing" } })), ["task"])
})

test("an item can be several kinds at once", () => {
  const item = record({ description: "Ship release", status: { id: 4, label: "doing" } })
  assert.deepEqual(itemKinds(item), ["note", "task"])
  assert.equal(isKind(item, "note"), true)
  assert.equal(isKind(item, "task"), true)
})

test("removing content removes the kind it made, and only that kind", () => {
  const both = record({ description: "Ship release", timeDue: due })
  assert.deepEqual(itemKinds({ ...both, timeDue: null }), ["note"])
  assert.deepEqual(itemKinds({ ...both, description: "   " }), ["task"])
})

test("taxonomy gives an item no kind", () => {
  const filed = record({
    category: { id: 1, label: "work" },
    subcategory: { id: 3, label: "ideas" },
    tags: [{ id: 2, label: "urgent" }],
  })
  assert.deepEqual(itemKinds(filed), [])
})

test("the Notes selection rule is the note kind", () => {
  const items = [
    record({ description: "A note" }),
    record({ description: "A task with text", timeDue: due }),
    record({ timeDue: due }),
    record({ description: "  " }),
  ]
  for (const item of items) assert.equal(isTextItem(item), isKind(item, "note"))
  assert.deepEqual(items.map(isTextItem), [true, true, false, false])
})
