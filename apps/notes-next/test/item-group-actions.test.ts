import assert from "node:assert/strict"
import { test } from "node:test"
import { createItemGroupRouteHandlers } from "../app/api/_lib/items-app-route-handlers"
import {
  createFakeItemsAppService,
  sampleApiToken,
} from "@lib/db-items/testing/items-api-adapter-suite"
import { getItemsAppErrorStatus } from "@lib/db-items/services/items-app"
import { ItemGroupConflictError, ItemGroupNotFoundError } from "@lib/db-items/sql/item-group-errors"
import { applyItemGroupResult, describeItemGroupContents } from "../src/lib/itemGroupActions"
import { useItemsAppStore } from "../src/stores/itemsAppStore"
import type { ItemGroupActionResponse } from "@lib/db-items/contracts/item-group-actions"

const selection = { workspaceId: 3, target: { kind: "uncategorized" } }
const request = (method: "POST" | "PATCH", body: unknown, authorized = true) =>
  new Request("https://test/api/item-groups", {
    method,
    headers: {
      "content-type": "application/json",
      ...(authorized ? { authorization: `Bearer ${sampleApiToken}` } : {}),
    },
    body: JSON.stringify(body),
  })

test("bulk routes authenticate both phases and replace supplied identity before parsing", async () => {
  const received: unknown[] = []
  const base = createFakeItemsAppService()
  const handlers = createItemGroupRouteHandlers(
    createFakeItemsAppService({
      previewItemGroupForItemsApp: async (input) => {
        received.push(input)
        return base.previewItemGroupForItemsApp(input)
      },
      executeItemGroupActionForItemsApp: async (input) => {
        received.push(input)
        return base.executeItemGroupActionForItemsApp(input)
      },
    }),
  )
  for (const handler of [handlers.POST, handlers.PATCH])
    assert.equal((await handler(request("POST", { selection }, false))).status, 401)
  const preview = await handlers.POST(request("POST", { userId: 999, selection, itemIds: [999] }))
  assert.equal(preview.headers.get("cache-control"), "no-store")
  assert.equal(preview.status, 200)
  const snapshot = (await preview.json()).snapshot
  const result = await handlers.PATCH(
    request("PATCH", {
      userId: 999,
      selection,
      snapshot,
      action: { kind: "delete", deleteItems: true },
      itemIds: [999],
    }),
  )
  assert.equal(result.status, 200)
  assert.deepEqual(received, [
    { userId: 7, selection },
    { userId: 7, selection, snapshot, action: { kind: "delete", deleteItems: true } },
  ])
})

test("bulk routes reject invalid actions before service writes and return actionable conflict/not-found errors", async () => {
  let calls = 0
  const handlers = createItemGroupRouteHandlers(
    createFakeItemsAppService({
      getItemsAppErrorStatus,
      executeItemGroupActionForItemsApp: async () => {
        calls++
        throw new ItemGroupConflictError()
      },
      previewItemGroupForItemsApp: async () => {
        throw new ItemGroupNotFoundError()
      },
    }),
  )
  for (const action of [
    { kind: "delete" },
    { kind: "delete", deleteItems: false },
    { kind: "rename", label: " UNCATEGORIZED " },
  ])
    assert.equal(
      (await handlers.PATCH(request("PATCH", { selection, snapshot: "a".repeat(64), action })))
        .status,
      400,
    )
  assert.equal(calls, 0)
  assert.equal((await handlers.POST(request("POST", { selection }))).status, 404)
  assert.equal(
    (
      await handlers.PATCH(
        request("PATCH", {
          selection,
          snapshot: "a".repeat(64),
          action: { kind: "delete", deleteItems: true },
        }),
      )
    ).status,
    409,
  )
  assert.equal(calls, 1)
})

test("group responses replace changed items and remove deleted items without changing unrelated content", async () => {
  const base = createFakeItemsAppService()
  const item = (await base.listItemsForItemsApp({ userId: 7, workspaceId: 3 })).items[0]!
  const other = { ...item, id: 42, description: "keep this text" }
  const updated = { ...item, categories: [{ id: 9, label: "receipts" }] }
  const result: ItemGroupActionResponse = {
    items: [updated],
    deletedItemIds: [],
    category: null,
    removedCategoryId: null,
  }
  assert.deepEqual(applyItemGroupResult([item, other], result), [updated, other])
  assert.deepEqual(
    applyItemGroupResult([item, other], { ...result, items: [], deletedItemIds: [item.id] }),
    [other],
  )
  assert.equal(
    describeItemGroupContents({
      snapshot: "",
      label: "",
      itemIds: [],
      itemCount: 4,
      textItemCount: 2,
      sharedItemCount: 1,
    }),
    "2 notes and 2 other items",
  )
})

test("group dialog state resets with the session", () => {
  const store = useItemsAppStore.getState()
  store.setItemGroupDialog({
    target: { kind: "uncategorized" },
    intent: "delete",
    label: "uncategorized",
  })
  assert.equal(useItemsAppStore.getState().itemGroupDialog?.intent, "delete")
  store.resetDefaultState()
  assert.equal(useItemsAppStore.getState().itemGroupDialog, null)
})
