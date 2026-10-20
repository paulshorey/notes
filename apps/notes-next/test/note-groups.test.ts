import assert from "node:assert/strict"
import test from "node:test"
import type { CategoryRecord, NoteRecord } from "@lib/db-notes"
import { buildCategoryNoteGroups, type CategoryNoteGroup } from "../src/lib/noteGroups"

const category = (id: number, label: string): CategoryRecord => ({
  id,
  label,
  workspaceId: 1,
  noteCount: 0,
  lastUsedAt: null,
})
const categories = [category(1, "work"), category(2, "personal"), category(3, "projects")]
const note = (id: number, day: number, categoryIds: number[] = []): NoteRecord => ({
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
const items = (notes: NoteRecord[]) => notes.map((note) => ({ note }))
const labels = (groups: CategoryNoteGroup[]) =>
  groups.map((group) => (group.kind === "category" ? group.category.label : "uncategorized"))

for (const [position, day, expected] of [
  ["first", 35, ["uncategorized", "work", "personal", "projects"]],
  ["middle", 15, ["work", "personal", "uncategorized", "projects"]],
  ["last", 5, ["work", "personal", "projects", "uncategorized"]],
] as const) {
  test(`uncategorized sorts ${position} according to its newest note`, () => {
    const groups = buildCategoryNoteGroups(
      categories,
      items([note(1, 30, [1]), note(2, 20, [2]), note(3, 10, [3]), note(4, day), note(5, 1)]),
    )
    assert.deepEqual(labels(groups), expected)
    const uncategorized = groups.find((group) => group.kind === "uncategorized")!
    assert.deepEqual(
      uncategorized.items.map(({ note }) => note.id),
      [4, 5],
    )
    assert.equal("category" in uncategorized, false)
  })
}

test("saved edits promote uncategorized and real groups without changing memberships", () => {
  const original = [note(1, 30, [1]), note(2, 20, [2]), note(3, 10, [3]), note(4, 15), note(5, 1)]
  const before = structuredClone(original)
  const uncategorizedEdited = original.map((n) =>
    n.id === 5 ? { ...n, timeModified: note(5, 40).timeModified } : n,
  )
  const updated = buildCategoryNoteGroups(categories, items(uncategorizedEdited))
  assert.deepEqual(labels(updated), ["uncategorized", "work", "personal", "projects"])
  assert.deepEqual(
    updated[0]!.items.map(({ note }) => note.id),
    [5, 4],
  )
  const categoryEdited = uncategorizedEdited.map((n) =>
    n.id === 3 ? { ...n, timeModified: note(3, 50).timeModified } : n,
  )
  assert.deepEqual(labels(buildCategoryNoteGroups(categories, items(categoryEdited))), [
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
  const allNotes = [note(1, 50, [1]), note(2, 10, [1]), note(3, 30, [2]), note(4, 60), note(5, 20)]
  const groups = buildCategoryNoteGroups(
    categories.map((c) => ({ ...c, lastUsedAt: note(0, 100 + c.id).timeModified })),
    items(allNotes.filter((n) => visibleIds.has(n.id))),
  )
  assert.deepEqual(labels(groups), ["personal", "uncategorized", "work", "projects"])
  assert.deepEqual(
    groups.flatMap((g) => g.items.map(({ note }) => note.id)),
    [3, 5, 2],
  )
})

test("the computed group works with no real categories, hides when empty, and leaves empty categories last", () => {
  assert.deepEqual(labels(buildCategoryNoteGroups([], items([note(1, 10)]))), ["uncategorized"])
  assert.deepEqual(buildCategoryNoteGroups([], []), [])
  assert.deepEqual(labels(buildCategoryNoteGroups(categories, items([note(1, 10, [1])]))), [
    "work",
    "personal",
    "projects",
  ])
  const invalidDate = { ...note(1, 10), timeModified: "invalid" }
  assert.deepEqual(labels(buildCategoryNoteGroups(categories, items([invalidDate]))), [
    "uncategorized",
    "personal",
    "projects",
    "work",
  ])
  const reassigned = { ...note(1, 10), categories: [{ id: 1, label: "work" }] }
  assert.equal(
    buildCategoryNoteGroups(categories, items([reassigned])).some(
      (g) => g.kind === "uncategorized",
    ),
    false,
  )
})

test("ties are deterministic and a note can promote every category it belongs to", () => {
  const notes = [note(4, 20, [1, 2]), note(2, 20, [1, 2]), note(3, 20)]
  const expected = ["personal", "uncategorized", "work", "projects"]
  const first = buildCategoryNoteGroups(categories, items(notes))
  assert.deepEqual(labels(first), expected)
  assert.deepEqual(
    labels(buildCategoryNoteGroups([...categories].reverse(), items([...notes].reverse()))),
    expected,
  )
  assert.deepEqual(
    first
      .filter((g) => g.kind === "category" && g.items.length > 0)
      .map((g) => g.items.map(({ note }) => note.id)),
    [
      [2, 4],
      [2, 4],
    ],
  )
})
