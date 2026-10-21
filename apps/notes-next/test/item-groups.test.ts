import assert from "node:assert/strict"
import test from "node:test"
import type { CategoryRecord, ItemRecord } from "@lib/db-items"
import { buildCategoryItemGroups, type CategoryItemGroup } from "../src/lib/itemGroups"

const category = (id: number, label: string): CategoryRecord => ({
  id,
  label,
  workspaceId: 1,
  itemCount: 0,
  lastUsedAt: null,
})
const categories = [category(1, "work"), category(2, "personal"), category(3, "projects")]
const item = (id: number, day: number, categoryIds: number[] = []): ItemRecord => ({
  id,
  workspaceId: 1,
  categories: categoryIds.map((id) => ({ id, label: categories.find((c) => c.id === id)!.label })),
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
      displayItems([
        item(1, 30, [1]),
        item(2, 20, [2]),
        item(3, 10, [3]),
        item(4, day),
        item(5, 1),
      ]),
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
  const original = [item(1, 30, [1]), item(2, 20, [2]), item(3, 10, [3]), item(4, 15), item(5, 1)]
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
    categoryEdited.map((n) => n.categories),
    original.map((n) => n.categories),
  )
})

test("filtered groups use their visible notes, ignoring newer hidden notes and category metadata", () => {
  const visibleIds = new Set([2, 3, 5])
  const allItems = [item(1, 50, [1]), item(2, 10, [1]), item(3, 30, [2]), item(4, 60), item(5, 20)]
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
  assert.deepEqual(labels(buildCategoryItemGroups(categories, displayItems([item(1, 10, [1])]))), [
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
  const reassigned = { ...item(1, 10), categories: [{ id: 1, label: "work" }] }
  assert.equal(
    buildCategoryItemGroups(categories, displayItems([reassigned])).some(
      (g) => g.kind === "uncategorized",
    ),
    false,
  )
})

test("ties are deterministic and a note can promote every category it belongs to", () => {
  const items = [item(4, 20, [1, 2]), item(2, 20, [1, 2]), item(3, 20)]
  const expected = ["personal", "uncategorized", "work", "projects"]
  const first = buildCategoryItemGroups(categories, displayItems(items))
  assert.deepEqual(labels(first), expected)
  assert.deepEqual(
    labels(buildCategoryItemGroups([...categories].reverse(), displayItems([...items].reverse()))),
    expected,
  )
  assert.deepEqual(
    first
      .filter((g) => g.kind === "category" && g.items.length > 0)
      .map((g) => g.items.map(({ item }) => item.id)),
    [
      [2, 4],
      [2, 4],
    ],
  )
})
