import assert from "node:assert/strict"
import { test } from "node:test"
import type { CategoryRecord } from "@lib/db-items"
import type { ItemGroupActionResponse } from "@lib/db-items/contracts/item-group-actions"
import { createItemGroupRouteHandlers } from "../app/api/_lib/items-app-route-handlers"
import {
  createFakeItemsAppService,
  sampleApiToken,
} from "@lib/db-items/testing/items-api-adapter-suite"
import {
  applyItemGroupResultToCategories,
  planGroupMove,
  refileAfterGroupResult,
} from "../src/lib/itemGroupActions"

const category = (
  id: number,
  label: string,
  itemCount: number,
  subcategories: Array<[number, string, number]> = [],
): CategoryRecord => ({
  id,
  workspaceId: 1,
  label,
  itemCount,
  lastUsedAt: null,
  subcategories: subcategories.map(([subcategoryId, subcategoryLabel, count]) => ({
    id: subcategoryId,
    categoryId: id,
    label: subcategoryLabel,
    itemCount: count,
    lastUsedAt: null,
  })),
})

// work: 5 items, 3 of them in "ideas" and 1 in "archive". home: 2 items, 1 in "ideas".
const before = [
  category(1, "work", 5, [
    [11, "ideas", 3],
    [12, "archive", 1],
  ]),
  category(2, "home", 2, [[21, "ideas", 1]]),
  category(3, "trips", 4),
]
const result = (values: Partial<ItemGroupActionResponse>): ItemGroupActionResponse => ({
  items: [],
  deletedItemIds: [],
  category: null,
  removedCategoryId: null,
  removedSubcategoryId: null,
  ...values,
})
const summary = (categories: CategoryRecord[]) =>
  categories
    .map(
      (entry) =>
        `${entry.label}=${entry.itemCount}[${entry.subcategories.map((sub) => `${sub.id}:${sub.label}`).join(",")}]`,
    )
    .sort()

test("a moved subcategory leaves its old category in the list, with its items", () => {
  // "archive" (12) moved from work to home.
  const moved = result({
    category: category(2, "home", 3, [
      [12, "archive", 1],
      [21, "ideas", 1],
    ]),
  })
  assert.deepEqual(summary(applyItemGroupResultToCategories(before, moved)), [
    "home=3[12:archive,21:ideas]",
    "trips=4[]",
    "work=4[11:ideas]",
  ])
  // A draft being filed in the moved subcategory follows it; other filings stay put.
  assert.deepEqual(refileAfterGroupResult(before, moved, { categoryId: 1, subcategoryId: 12 }), {
    categoryId: 2,
    subcategoryId: 12,
  })
  for (const filing of [
    { categoryId: 1, subcategoryId: 11 },
    { categoryId: 1, subcategoryId: null },
    { categoryId: 2, subcategoryId: 21 },
    { categoryId: null, subcategoryId: null },
  ])
    assert.deepEqual(refileAfterGroupResult(before, moved, filing), filing)
})

test("a subcategory that became a category is removed from its old one", () => {
  const promoted = result({ category: category(9, "archive", 1), removedSubcategoryId: 12 })
  assert.deepEqual(summary(applyItemGroupResultToCategories(before, promoted)), [
    "archive=1[]",
    "home=2[21:ideas]",
    "trips=4[]",
    "work=4[11:ideas]",
  ])
  assert.deepEqual(refileAfterGroupResult(before, promoted, { categoryId: 1, subcategoryId: 12 }), {
    categoryId: 9,
    subcategoryId: null,
  })
  assert.deepEqual(refileAfterGroupResult(before, promoted, { categoryId: 1, subcategoryId: 11 }), {
    categoryId: 1,
    subcategoryId: 11,
  })
})

test("a category that moved into another is replaced by that category's new subcategory", () => {
  // "trips" (3) moved into home and is now subcategory 22.
  const nested = result({
    category: category(2, "home", 6, [
      [21, "ideas", 1],
      [22, "trips", 4],
    ]),
    removedCategoryId: 3,
  })
  assert.deepEqual(summary(applyItemGroupResultToCategories(before, nested)), [
    "home=6[21:ideas,22:trips]",
    "work=5[11:ideas,12:archive]",
  ])
  assert.deepEqual(refileAfterGroupResult(before, nested, { categoryId: 3, subcategoryId: null }), {
    categoryId: 2,
    subcategoryId: 22,
  })
  assert.deepEqual(refileAfterGroupResult(before, nested, { categoryId: 2, subcategoryId: 21 }), {
    categoryId: 2,
    subcategoryId: 21,
  })
})

test("a draft follows a move even when this client's category list is out of date", () => {
  // Another tab added "packing" (23) to home after this client loaded its list, so the
  // response holds two subcategories this client has never seen.
  const nested = result({
    category: category(2, "home", 6, [
      [21, "ideas", 1],
      [23, "packing", 0],
      [22, "trips", 4],
    ]),
    removedCategoryId: 3,
  })
  assert.deepEqual(refileAfterGroupResult(before, nested, { categoryId: 3, subcategoryId: null }), {
    categoryId: 2,
    subcategoryId: 22,
  })
  // The destination itself is unknown to this client.
  const intoUnknown = result({
    category: category(8, "elsewhere", 4, [
      [81, "older", 0],
      [82, "trips", 4],
    ]),
    removedCategoryId: 3,
  })
  assert.deepEqual(
    refileAfterGroupResult(before, intoUnknown, { categoryId: 3, subcategoryId: null }),
    { categoryId: 8, subcategoryId: 82 },
  )
  // The moved category is unknown to this client: there is no label to match, so the
  // draft is left for the caller to repair instead of being filed by guesswork.
  const unknownSource = result({ category: nested.category, removedCategoryId: 7 })
  assert.deepEqual(
    refileAfterGroupResult(before, unknownSource, { categoryId: 7, subcategoryId: null }),
    { categoryId: 7, subcategoryId: null },
  )
  // A subcategory became a category whose id this client already holds in its list.
  const promoted = result({ category: category(3, "trips", 5), removedSubcategoryId: 12 })
  assert.deepEqual(refileAfterGroupResult(before, promoted, { categoryId: 1, subcategoryId: 12 }), {
    categoryId: 3,
    subcategoryId: null,
  })
})

test("deleting and renaming keep their existing effect on the list and move no draft", () => {
  const deletedSubcategory = result({
    category: category(1, "work", 5, [[11, "ideas", 3]]),
    removedSubcategoryId: 12,
  })
  assert.deepEqual(summary(applyItemGroupResultToCategories(before, deletedSubcategory)), [
    "home=2[21:ideas]",
    "trips=4[]",
    "work=5[11:ideas]",
  ])
  // The subcategory is gone, not moved: the draft keeps its filing for the caller to repair.
  assert.deepEqual(
    refileAfterGroupResult(before, deletedSubcategory, { categoryId: 1, subcategoryId: 12 }),
    { categoryId: 1, subcategoryId: 12 },
  )
  const deletedCategory = result({ removedCategoryId: 3 })
  assert.deepEqual(summary(applyItemGroupResultToCategories(before, deletedCategory)), [
    "home=2[21:ideas]",
    "work=5[11:ideas,12:archive]",
  ])
  assert.deepEqual(
    refileAfterGroupResult(before, deletedCategory, { categoryId: 3, subcategoryId: null }),
    { categoryId: 3, subcategoryId: null },
  )
  const renamed = result({ category: { ...before[2]!, label: "travel" } })
  assert.deepEqual(summary(applyItemGroupResultToCategories(before, renamed)), [
    "home=2[21:ideas]",
    "travel=4[]",
    "work=5[11:ideas,12:archive]",
  ])
})

test("a subcategory can go to the top level or to any other category", () => {
  const plan = planGroupMove(before, { kind: "subcategory", subcategoryId: 12 })
  assert.equal(plan.blocked, null)
  assert.deepEqual(
    plan.options.map((option) => [option.categoryId, option.label, option.conflict !== null]),
    [
      [null, "Top level (make it a category)", false],
      [2, "home", false],
      [3, "trips", false],
    ],
  )
  // "ideas" exists under home, so moving work's "ideas" there is flagged before sending.
  const clash = planGroupMove(before, { kind: "subcategory", subcategoryId: 11 })
  assert.match(clash.options.find((option) => option.categoryId === 2)!.conflict!, /already has/)
  assert.equal(clash.options.find((option) => option.categoryId === 3)!.conflict, null)
  // A category named like the subcategory blocks promoting it.
  const taken = planGroupMove([...before, category(4, "archive", 0)], {
    kind: "subcategory",
    subcategoryId: 12,
  })
  assert.match(taken.options[0]!.conflict!, /already exists/)
})

test("a category can move into another only while it has no subcategories", () => {
  const plan = planGroupMove(before, { kind: "category", categoryId: 3 })
  assert.equal(plan.blocked, null)
  assert.deepEqual(
    plan.options.map((option) => [option.categoryId, option.label]),
    [
      [2, "home"],
      [1, "work"],
    ],
  )
  assert.match(planGroupMove(before, { kind: "category", categoryId: 1 }).blocked!, /subcategories/)
  assert.match(
    planGroupMove([before[2]!], { kind: "category", categoryId: 3 }).blocked!,
    /no other category/,
  )
  // A category named like one of the destination's subcategories is flagged.
  const clash = planGroupMove([...before, category(4, "ideas", 1)], {
    kind: "category",
    categoryId: 4,
  })
  assert.match(clash.options.find((option) => option.categoryId === 1)!.conflict!, /already has/)
  assert.equal(clash.options.find((option) => option.categoryId === 3)!.conflict, null)
  assert.notEqual(planGroupMove(before, { kind: "uncategorized" }).blocked, null)
  assert.notEqual(planGroupMove(before, { kind: "category", categoryId: 99 }).blocked, null)
})

test("the group route passes a move through with the server's identity and rejects a misfit", async () => {
  const received: unknown[] = []
  const handlers = createItemGroupRouteHandlers(
    createFakeItemsAppService({
      executeItemGroupActionForItemsApp: async (input) => {
        received.push(input)
        return result({})
      },
    }),
  )
  const patch = (target: unknown, action: unknown) =>
    handlers.PATCH(
      new Request("https://test/api/item-groups", {
        method: "PATCH",
        headers: { "content-type": "application/json", authorization: `Bearer ${sampleApiToken}` },
        body: JSON.stringify({
          userId: 999,
          selection: { workspaceId: 3, target },
          snapshot: "a".repeat(64),
          action,
        }),
      }),
    )
  const moved = await patch(
    { kind: "subcategory", subcategoryId: 12 },
    { kind: "move", categoryId: null },
  )
  assert.equal(moved.status, 200)
  assert.deepEqual(received, [
    {
      userId: 7,
      selection: { workspaceId: 3, target: { kind: "subcategory", subcategoryId: 12 } },
      snapshot: "a".repeat(64),
      action: { kind: "move", categoryId: null },
    },
  ])
  const misfit = await patch({ kind: "uncategorized" }, { kind: "move", categoryId: 2 })
  assert.equal(misfit.status, 400)
  assert.equal(received.length, 1)
})
