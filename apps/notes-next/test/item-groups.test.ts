import assert from "node:assert/strict"
import test from "node:test"
import type { CategoryRecord, ItemRecord } from "@lib/db-items"
import { buildCategoryItemGroups, type CategoryItemGroup } from "../src/lib/itemGroups"

const category = (
  id: number,
  label: string,
  subcategories: Array<[number, string]> = [],
): CategoryRecord => ({
  id,
  label,
  workspaceId: 1,
  itemCount: 0,
  lastUsedAt: null,
  subcategories: subcategories.map(([subcategoryId, subcategoryLabel]) => ({
    id: subcategoryId,
    categoryId: id,
    label: subcategoryLabel,
    itemCount: 0,
    lastUsedAt: null,
  })),
})
const categories = [
  category(1, "work", [
    [11, "ideas"],
    [12, "archive"],
    [13, "empty"],
  ]),
  category(2, "personal"),
  category(3, "projects"),
]
const item = (
  id: number,
  day: number,
  categoryId: number | null = null,
  subcategoryId: number | null = null,
): ItemRecord => {
  const filedIn = categories.find((c) => c.id === categoryId)
  const nestedIn = filedIn?.subcategories.find((c) => c.id === subcategoryId)
  return {
    id,
    uid: `00000000-0000-4000-8000-${String(id).padStart(12, "0")}`,
    workspaceId: 1,
    category: filedIn ? { id: filedIn.id, label: filedIn.label } : null,
    subcategory: nestedIn ? { id: nestedIn.id, label: nestedIn.label } : null,
    ...itemFields(id, day),
  }
}
const itemFields = (id: number, day: number) => ({
  status: null,
  tags: [],
  description: `note ${id}`,
  timeDue: null,
  timeRemind: null,
  timeCreated: "2020-01-01T00:00:00Z",
  timeModified: new Date(Date.UTC(2026, 0, day)).toISOString(),
})
const displayItems = (items: ItemRecord[]) => items.map((item) => ({ item }))
const labels = (groups: CategoryItemGroup[]) =>
  groups.map((group) => (group.kind === "category" ? group.category.label : "uncategorized"))

for (const [position, day, expected] of [
  ["first", 35, ["uncategorized", "work", "personal", "projects"]],
  ["middle", 15, ["work", "personal", "uncategorized", "projects"]],
  ["last", 5, ["work", "personal", "projects", "uncategorized"]],
] as const) {
  test(`uncategorized sorts ${position} according to its newest note`, () => {
    const groups = buildCategoryItemGroups(
      categories,
      displayItems([item(1, 30, 1), item(2, 20, 2), item(3, 10, 3), item(4, day), item(5, 1)]),
    )
    assert.deepEqual(labels(groups), expected)
    const uncategorized = groups.find((group) => group.kind === "uncategorized")!
    assert.deepEqual(
      uncategorized.items.map(({ item }) => item.id),
      [4, 5],
    )
    assert.equal("category" in uncategorized, false)
  })
}

test("saved edits promote uncategorized and real groups without changing memberships", () => {
  const original = [item(1, 30, 1), item(2, 20, 2), item(3, 10, 3), item(4, 15), item(5, 1)]
  const before = structuredClone(original)
  const uncategorizedEdited = original.map((n) =>
    n.id === 5 ? { ...n, timeModified: item(5, 40).timeModified } : n,
  )
  const updated = buildCategoryItemGroups(categories, displayItems(uncategorizedEdited))
  assert.deepEqual(labels(updated), ["uncategorized", "work", "personal", "projects"])
  assert.deepEqual(
    updated[0]!.items.map(({ item }) => item.id),
    [5, 4],
  )
  const categoryEdited = uncategorizedEdited.map((n) =>
    n.id === 3 ? { ...n, timeModified: item(3, 50).timeModified } : n,
  )
  assert.deepEqual(labels(buildCategoryItemGroups(categories, displayItems(categoryEdited))), [
    "projects",
    "uncategorized",
    "work",
    "personal",
  ])
  assert.deepEqual(original, before)
  assert.deepEqual(
    categoryEdited.map((n) => n.category),
    original.map((n) => n.category),
  )
})

test("filtered groups use their visible notes, ignoring newer hidden notes and category metadata", () => {
  const visibleIds = new Set([2, 3, 5])
  const allItems = [item(1, 50, 1), item(2, 10, 1), item(3, 30, 2), item(4, 60), item(5, 20)]
  const groups = buildCategoryItemGroups(
    categories.map((c) => ({ ...c, lastUsedAt: item(0, 100 + c.id).timeModified })),
    displayItems(allItems.filter((n) => visibleIds.has(n.id))),
  )
  assert.deepEqual(labels(groups), ["personal", "uncategorized", "work", "projects"])
  assert.deepEqual(
    groups.flatMap((g) => g.items.map(({ item }) => item.id)),
    [3, 5, 2],
  )
})

test("the computed group works with no real categories, hides when empty, and leaves empty categories last", () => {
  assert.deepEqual(labels(buildCategoryItemGroups([], displayItems([item(1, 10)]))), [
    "uncategorized",
  ])
  assert.deepEqual(buildCategoryItemGroups([], []), [])
  assert.deepEqual(labels(buildCategoryItemGroups(categories, displayItems([item(1, 10, 1)]))), [
    "work",
    "personal",
    "projects",
  ])
  const invalidDate = { ...item(1, 10), timeModified: "invalid" }
  assert.deepEqual(labels(buildCategoryItemGroups(categories, displayItems([invalidDate]))), [
    "uncategorized",
    "personal",
    "projects",
    "work",
  ])
  const reassigned = { ...item(1, 10), category: { id: 1, label: "work" } }
  assert.equal(
    buildCategoryItemGroups(categories, displayItems([reassigned])).some(
      (g) => g.kind === "uncategorized",
    ),
    false,
  )
})

test("ties are deterministic whatever order the categories and notes arrive in", () => {
  const items = [item(4, 20, 1), item(2, 20, 2), item(3, 20)]
  const expected = ["personal", "uncategorized", "work", "projects"]
  const first = buildCategoryItemGroups(categories, displayItems(items))
  assert.deepEqual(labels(first), expected)
  assert.deepEqual(
    labels(buildCategoryItemGroups([...categories].reverse(), displayItems([...items].reverse()))),
    expected,
  )
})

test("a note appears once: in its subcategory, or directly in its category", () => {
  const groups = buildCategoryItemGroups(
    categories,
    displayItems([
      item(1, 10, 1),
      item(2, 40, 1, 11),
      item(3, 20, 1, 12),
      item(4, 30, 1, 12),
      item(5, 5, 2),
    ]),
  )
  const work = groups.find((group) => group.kind === "category" && group.category.id === 1)!
  assert.ok(work.kind === "category")
  // Notes with no subcategory stay on the category itself.
  assert.deepEqual(
    work.items.map(({ item }) => item.id),
    [1],
  )
  // Subcategories with notes come first, newest first; each lists its own notes.
  assert.deepEqual(
    work.subgroups.map((subgroup) => [
      subgroup.subcategory.label,
      subgroup.items.map(({ item }) => item.id),
    ]),
    [
      ["ideas", [2]],
      ["archive", [4, 3]],
      ["empty", []],
    ],
  )
  // The category counts and sorts by every note filed in it.
  assert.equal(work.itemCount, 4)
  assert.equal(work.sortTime, Date.parse(item(2, 40).timeModified))
  assert.deepEqual(labels(groups), ["work", "personal", "projects"])
  const personal = groups.find((group) => group.kind === "category" && group.category.id === 2)!
  assert.equal(personal.itemCount, 1)
  assert.deepEqual(personal.kind === "category" && personal.subgroups, [])
})

test("a category whose only notes are in a subcategory is not treated as empty", () => {
  const groups = buildCategoryItemGroups(
    categories,
    displayItems([item(1, 10, 1, 11), item(2, 5, 2)]),
  )
  assert.deepEqual(labels(groups), ["work", "personal", "projects"])
  assert.deepEqual(groups[0]!.items, [])
  assert.equal(groups[0]!.itemCount, 1)
})
