import type { TaxonomyRecord } from "@lib/db-notes"
import { TAXONOMY_LEVEL_CATEGORY, TAXONOMY_LEVEL_EPIC, TAXONOMY_LEVEL_GROUP } from "@lib/db-notes/contracts/notes-app"
import { normalizeLabel } from "@/lib/strings"
import {
  childrenOfLevel,
  defaultNodeLabel,
  epicsOf,
  pathForGroup,
  type TaxonomyIndex,
} from "@/lib/taxonomyIndex"

const childrenAtLevel = (
  index: TaxonomyIndex,
  parentId: number | null,
  level: number,
): TaxonomyRecord[] => childrenOfLevel(index, parentId).filter((row) => row.level === level)

export const pickChildByLabel = (
  children: TaxonomyRecord[],
  label: string | null | undefined,
): TaxonomyRecord | undefined => {
  if (label == null) return undefined
  const normalized = normalizeLabel(label)
  if (normalized === "") return undefined
  return children.find((row) => normalizeLabel(row.label) === normalized)
}

/**
 * Prefer the caller's label, then the seeded default at that level, then the
 * first sibling. Creating a missing child is the caller's job — this only
 * reads the tree.
 */
export const pickPreferredChild = (
  children: TaxonomyRecord[],
  preferredLabel: string | null | undefined,
  level: number,
): TaxonomyRecord | null =>
  pickChildByLabel(children, preferredLabel) ??
  pickChildByLabel(children, defaultNodeLabel(level)) ??
  children[0] ??
  null

export const resolveGroupUnderCategory = (
  index: TaxonomyIndex,
  categoryId: number,
  preferredGroupLabel: string | null | undefined,
): TaxonomyRecord | null =>
  pickPreferredChild(
    childrenAtLevel(index, categoryId, TAXONOMY_LEVEL_GROUP),
    preferredGroupLabel,
    TAXONOMY_LEVEL_GROUP,
  )

export const resolveGroupUnderEpic = (
  index: TaxonomyIndex,
  epicId: number,
  preferredCategoryLabel: string | null | undefined,
  preferredGroupLabel: string | null | undefined,
): TaxonomyRecord | null => {
  const category = pickPreferredChild(
    childrenAtLevel(index, epicId, TAXONOMY_LEVEL_CATEGORY),
    preferredCategoryLabel,
    TAXONOMY_LEVEL_CATEGORY,
  )
  if (category === null) return null
  return resolveGroupUnderCategory(index, category.id, preferredGroupLabel)
}

export const defaultGroupInCategory = (
  index: TaxonomyIndex,
  categoryId: number,
): TaxonomyRecord | null => resolveGroupUnderCategory(index, categoryId, null)

/**
 * Navigation epic is independent of the open note. Keep the current choice
 * while it still exists; otherwise follow the preferred note, then the epic
 * with the latest note, then the first epic.
 */
export const pickEpicForNavigation = (
  index: TaxonomyIndex,
  notes: Array<{ groupId: number; timeModified: string | null }>,
  currentEpicId: number | null,
  preferredGroupId: number | null,
): number | null => {
  const epics = epicsOf(index)
  if (epics.length === 0) return null
  if (currentEpicId !== null && index.byId.get(currentEpicId)?.level === TAXONOMY_LEVEL_EPIC) {
    return currentEpicId
  }

  const fromPreferred = pathForGroup(index, preferredGroupId)?.epic.id
  if (fromPreferred !== undefined) return fromPreferred

  let bestEpicId: number | null = null
  let bestTime = Number.NEGATIVE_INFINITY
  for (const note of notes) {
    const path = pathForGroup(index, note.groupId)
    if (path === null) continue
    const time = note.timeModified ? Date.parse(note.timeModified) : 0
    const sortTime = Number.isFinite(time) ? time : 0
    if (sortTime > bestTime) {
      bestTime = sortTime
      bestEpicId = path.epic.id
    }
  }
  return bestEpicId ?? epics[0]?.id ?? null
}
