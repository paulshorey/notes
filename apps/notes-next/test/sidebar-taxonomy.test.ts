import assert from "node:assert/strict"
import test from "node:test"
import type { NoteRecord, TaxonomyRecord } from "@lib/db-notes"
import {
  TAXONOMY_LEVEL_CATEGORY,
  TAXONOMY_LEVEL_EPIC,
  TAXONOMY_LEVEL_GROUP,
} from "@lib/db-notes/contracts/notes-app"
import { buildEpicNoteGroups, epicGroupById } from "../src/lib/sidebarTaxonomy"
import { buildTaxonomyIndex } from "../src/lib/taxonomyIndex"

const node = (
  id: number,
  level: number,
  parentId: number | null,
  label: string,
): TaxonomyRecord => ({
  id,
  userId: 1,
  level,
  parentId,
  label,
  noteCount: 0,
  directNoteCount: 0,
  lastUsedAt: null,
})

const note = (id: number, groupId: number, timeModified: string, description = `note ${id}`): NoteRecord => ({
  id,
  userId: 1,
  groupId,
  tags: [],
  description,
  timeDue: null,
  timeRemind: null,
  timeCreated: timeModified,
  timeModified,
})

const index = buildTaxonomyIndex([
  node(1, TAXONOMY_LEVEL_EPIC, null, "work"),
  node(2, TAXONOMY_LEVEL_CATEGORY, 1, "older-cat"),
  node(3, TAXONOMY_LEVEL_GROUP, 2, "alpha"),
  node(4, TAXONOMY_LEVEL_GROUP, 2, "uncategorized"),
  node(5, TAXONOMY_LEVEL_CATEGORY, 1, "newer-cat"),
  node(6, TAXONOMY_LEVEL_GROUP, 5, "beta"),
  node(7, TAXONOMY_LEVEL_GROUP, 5, "uncategorized"),
  node(10, TAXONOMY_LEVEL_EPIC, null, "home"),
  node(11, TAXONOMY_LEVEL_CATEGORY, 10, "chores"),
  node(12, TAXONOMY_LEVEL_GROUP, 11, "weekend"),
])

test("notes sit under their category, ignoring group for grouping and sort", () => {
  const tree = buildEpicNoteGroups(index, [
    note(1, 3, "2026-01-01T00:00:00.000Z", "older in alpha"),
    note(2, 4, "2026-01-03T00:00:00.000Z", "newer uncategorized"),
    note(3, 6, "2026-01-04T00:00:00.000Z", "latest in beta"),
    note(4, 7, "2026-01-02T00:00:00.000Z", "mid uncategorized"),
  ])

  const work = epicGroupById(tree, 1)
  assert.ok(work)
  assert.deepEqual(
    work.categories.map((entry) => entry.category.label),
    ["newer-cat", "older-cat"],
  )

  const newer = work.categories[0]!
  assert.deepEqual(
    newer.items.map((item) => item.note.id),
    [3, 4],
  )
  assert.equal(newer.items[0]?.groupLabel, "beta")
  assert.equal(newer.items[1]?.groupLabel, null)

  const older = work.categories[1]!
  assert.deepEqual(
    older.items.map((item) => item.note.id),
    [2, 1],
  )
  assert.equal(older.items[0]?.groupLabel, null)
  assert.equal(older.items[1]?.groupLabel, "alpha")
})

test("empty categories still appear, sorted after categories that have notes", () => {
  const tree = buildEpicNoteGroups(index, [note(1, 12, "2026-01-01T00:00:00.000Z")])
  const home = epicGroupById(tree, 10)
  assert.ok(home)
  assert.equal(home.categories.length, 1)
  assert.equal(home.categories[0]?.items.length, 1)
  assert.equal(home.categories[0]?.items[0]?.groupLabel, "weekend")

  const work = epicGroupById(tree, 1)
  assert.ok(work)
  assert.equal(work.categories.length, 2)
  assert.ok(work.categories.every((entry) => entry.items.length === 0))
})

test("epics sort by latest note, and epicGroupById falls back to the first epic", () => {
  const tree = buildEpicNoteGroups(index, [
    note(1, 3, "2026-01-01T00:00:00.000Z"),
    note(2, 12, "2026-01-05T00:00:00.000Z"),
  ])
  assert.equal(tree[0]?.epic.label, "home")
  assert.equal(epicGroupById(tree, 99)?.epic.label, "home")
  assert.equal(epicGroupById(tree, null)?.epic.label, "home")
})
