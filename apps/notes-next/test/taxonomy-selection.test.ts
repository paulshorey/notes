import assert from "node:assert/strict"
import test from "node:test"
import type { TaxonomyRecord } from "@lib/db-notes"
import {
  TAXONOMY_LEVEL_CATEGORY,
  TAXONOMY_LEVEL_EPIC,
  TAXONOMY_LEVEL_GROUP,
} from "@lib/db-notes/contracts/notes-app"
import { buildTaxonomyIndex } from "../src/lib/taxonomyIndex"
import {
  pickChildByLabel,
  pickEpicForNavigation,
  pickPreferredChild,
  resolveGroupUnderCategory,
  resolveGroupUnderEpic,
} from "../src/lib/taxonomySelection"

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

const tree = buildTaxonomyIndex([
  node(1, TAXONOMY_LEVEL_EPIC, null, "work"),
  node(2, TAXONOMY_LEVEL_CATEGORY, 1, "projects"),
  node(3, TAXONOMY_LEVEL_GROUP, 2, "active"),
  node(4, TAXONOMY_LEVEL_CATEGORY, 1, "uncategorized"),
  node(5, TAXONOMY_LEVEL_GROUP, 4, "uncategorized"),
  node(10, TAXONOMY_LEVEL_EPIC, null, "home"),
  node(11, TAXONOMY_LEVEL_CATEGORY, 10, "chores"),
  node(12, TAXONOMY_LEVEL_GROUP, 11, "weekend"),
  node(13, TAXONOMY_LEVEL_GROUP, 11, "uncategorized"),
])

test("pickChildByLabel is case-insensitive and ignores blanks", () => {
  const groups = [node(3, TAXONOMY_LEVEL_GROUP, 2, "active")]
  assert.equal(pickChildByLabel(groups, "Active")?.id, 3)
  assert.equal(pickChildByLabel(groups, "  "), undefined)
  assert.equal(pickChildByLabel(groups, null), undefined)
})

test("pickPreferredChild falls back to the seeded default, then the first child", () => {
  const withDefault = [
    node(3, TAXONOMY_LEVEL_GROUP, 2, "active"),
    node(5, TAXONOMY_LEVEL_GROUP, 2, "uncategorized"),
  ]
  assert.equal(pickPreferredChild(withDefault, "missing", TAXONOMY_LEVEL_GROUP)?.id, 5)
  assert.equal(pickPreferredChild(withDefault, "active", TAXONOMY_LEVEL_GROUP)?.id, 3)

  const withoutDefault = [node(3, TAXONOMY_LEVEL_GROUP, 2, "active")]
  assert.equal(pickPreferredChild(withoutDefault, "missing", TAXONOMY_LEVEL_GROUP)?.id, 3)
  assert.equal(pickPreferredChild([], "active", TAXONOMY_LEVEL_GROUP), null)
})

test("resolveGroupUnderEpic keeps a matching category/group when they exist", () => {
  const group = resolveGroupUnderEpic(tree, 1, "projects", "active")
  assert.equal(group?.id, 3)
})

test("resolveGroupUnderEpic falls back to uncategorized under the new epic", () => {
  const group = resolveGroupUnderEpic(tree, 1, "does-not-exist", "active")
  assert.equal(group?.id, 5)
})

test("resolveGroupUnderCategory prefers a matching group, else uncategorized", () => {
  assert.equal(resolveGroupUnderCategory(tree, 11, "weekend")?.id, 12)
  assert.equal(resolveGroupUnderCategory(tree, 11, "missing")?.id, 13)
})

test("pickEpicForNavigation keeps a still-valid current epic", () => {
  assert.equal(
    pickEpicForNavigation(
      tree,
      [{ groupId: 3, timeModified: "2026-01-02T00:00:00.000Z" }],
      10,
      3,
    ),
    10,
  )
})

test("pickEpicForNavigation follows the preferred group, then the latest note", () => {
  assert.equal(
    pickEpicForNavigation(
      tree,
      [{ groupId: 12, timeModified: "2026-01-02T00:00:00.000Z" }],
      null,
      3,
    ),
    1,
  )
  assert.equal(
    pickEpicForNavigation(
      tree,
      [
        { groupId: 3, timeModified: "2026-01-01T00:00:00.000Z" },
        { groupId: 12, timeModified: "2026-01-03T00:00:00.000Z" },
      ],
      null,
      null,
    ),
    10,
  )
})
