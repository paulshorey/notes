import assert from "node:assert/strict"
import test from "node:test"
import type { TaxonomyRecord } from "@lib/db-notes"
import {
  TAXONOMY_LEVEL_CATEGORY,
  TAXONOMY_LEVEL_EPIC,
  TAXONOMY_LEVEL_GROUP,
} from "@lib/db-notes/contracts/notes-app"
import {
  buildTaxonomyIndex,
  isDefaultNodeLabel,
  pathForGroup,
} from "../src/lib/taxonomyIndex"

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

test("pathForGroup returns undefined for a group the tree does not know", () => {
  const index = buildTaxonomyIndex([
    node(1, TAXONOMY_LEVEL_EPIC, null, "all"),
    node(2, TAXONOMY_LEVEL_CATEGORY, 1, "inbox"),
    node(3, TAXONOMY_LEVEL_GROUP, 2, "later"),
  ])

  assert.equal(pathForGroup(index, 99), null)
  assert.equal(pathForGroup(index, null), null)
})

test("pathForGroup returns the same object until the tree changes", () => {
  const index = buildTaxonomyIndex([
    node(1, TAXONOMY_LEVEL_EPIC, null, "all"),
    node(2, TAXONOMY_LEVEL_CATEGORY, 1, "inbox"),
    node(3, TAXONOMY_LEVEL_GROUP, 2, "later"),
  ])

  const first = pathForGroup(index, 3)
  const second = pathForGroup(index, 3)
  assert.ok(first)
  assert.equal(first, second)
  assert.equal(first.epic.label, "all")
  assert.equal(first.category.label, "inbox")
  assert.equal(first.group.label, "later")
})

test("a partial chain does not yield a path", () => {
  const index = buildTaxonomyIndex([
    node(1, TAXONOMY_LEVEL_EPIC, null, "all"),
    node(3, TAXONOMY_LEVEL_GROUP, 1, "orphan"),
  ])

  assert.equal(pathForGroup(index, 3), null)
})

test("isDefaultNodeLabel matches the seeded label for that level", () => {
  assert.equal(isDefaultNodeLabel(TAXONOMY_LEVEL_GROUP, "uncategorized"), true)
  assert.equal(isDefaultNodeLabel(TAXONOMY_LEVEL_GROUP, "Uncategorized"), true)
  assert.equal(isDefaultNodeLabel(TAXONOMY_LEVEL_GROUP, "planning"), false)
})
