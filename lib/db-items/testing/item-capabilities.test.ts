import assert from "node:assert/strict"
import test from "node:test"
import {
  hasItemCapability,
  hasItemContent,
  ITEM_CAPABILITIES,
  ITEM_CONTENT_REQUIRED_ERROR,
  itemCapabilities,
  type ItemCapabilitySource,
} from "../contracts/item-capabilities"
import type { ItemInput, ItemRecord } from "../contracts/items-app"
import {
  createItemForItemsApp,
  getItemsAppErrorStatus,
  updateItemForItemsApp,
} from "../services/items-app"

const input = (values: Partial<ItemInput> = {}): ItemInput => ({
  workspaceId: 1,
  categoryId: null,
  subcategoryId: null,
  statusId: null,
  tagIds: [],
  description: null,
  timeDue: null,
  timeRemind: null,
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

test("capability keys are unique", () => {
  const keys = ITEM_CAPABILITIES.map((capability) => capability.key)
  assert.equal(new Set(keys).size, keys.length)
})

test("an item reports each capability it holds, from a record or a write request", () => {
  assert.deepEqual(itemCapabilities(record()), [])
  assert.deepEqual(itemCapabilities(record({ description: "Buy milk" })), ["text"])
  assert.deepEqual(
    itemCapabilities(
      record({
        description: "Ship release",
        timeDue: "2027-01-02T03:04:05.000Z",
        status: { id: 4, label: "in progress" },
      }),
    ),
    ["text", "schedule", "status"],
  )
  assert.deepEqual(itemCapabilities(input({ timeRemind: "2027-01-02T03:04:05.000Z" })), [
    "schedule",
  ])
  assert.deepEqual(itemCapabilities(input({ description: "Call", statusId: 4 })), [
    "text",
    "status",
  ])
  assert.equal(hasItemCapability(input({ statusId: 4 }), "status"), true)
  assert.equal(hasItemCapability(input({ statusId: 4 }), "text"), false)
})

test("any single capability makes an item, and text is never required", () => {
  const savable: ItemCapabilitySource[] = [
    input({ description: " x " }),
    input({ timeDue: "2027-01-02T03:04:05.000Z" }),
    input({ timeRemind: "2027-01-02T03:04:05.000Z" }),
    input({ statusId: 4 }),
    record({ status: { id: 4, label: "done" } }),
  ]
  for (const item of savable) assert.equal(hasItemContent(item), true)
})

test("taxonomy alone does not make an item", () => {
  const empty: ItemCapabilitySource[] = [
    input(),
    input({ categoryId: 1, subcategoryId: 3, tagIds: [2] }),
    input({ description: "  \n\t " }),
    record({
      category: { id: 1, label: "work" },
      subcategory: { id: 3, label: "ideas" },
      tags: [{ id: 2, label: "urgent" }],
    }),
  ]
  for (const item of empty) assert.equal(hasItemContent(item), false)
})

test("the item service refuses to save an item that holds nothing", async () => {
  // Both calls must fail before any database or embedding-provider access.
  await assert.rejects(
    createItemForItemsApp({
      userId: 1,
      item: input({ categoryId: 1, subcategoryId: 3, tagIds: [2] }),
    }),
    (error: unknown) => {
      assert.ok(error instanceof Error)
      assert.equal(error.message, ITEM_CONTENT_REQUIRED_ERROR)
      assert.equal(getItemsAppErrorStatus(error), 400)
      return true
    },
  )
  await assert.rejects(
    updateItemForItemsApp({ userId: 1, itemId: 1, item: input({ description: "   " }) }),
    { message: ITEM_CONTENT_REQUIRED_ERROR },
  )
})
