import type { TaxonomyLevelRecord, TaxonomyRecord } from "@lib/db-notes"
import {
  DEFAULT_TAXONOMY_LEVEL_LABELS,
  DEFAULT_TAXONOMY_NODE_LABELS,
  TAXONOMY_LEVEL_CATEGORY,
  TAXONOMY_LEVEL_EPIC,
  TAXONOMY_LEVEL_GROUP,
} from "@lib/db-notes/contracts/notes-app"
import { normalizeLabel } from "@/lib/strings"

export { DEFAULT_TAXONOMY_NODE_LABELS }

export const defaultNodeLabel = (level: number): string =>
  DEFAULT_TAXONOMY_NODE_LABELS[level] ?? DEFAULT_TAXONOMY_NODE_LABELS[TAXONOMY_LEVEL_CATEGORY] ?? "uncategorized"

export const isDefaultNodeLabel = (level: number, label: string): boolean =>
  normalizeLabel(label) === normalizeLabel(defaultNodeLabel(level))

/** A note's full location, resolved from the tree. */
export interface TaxonomyPath {
  epic: TaxonomyRecord
  category: TaxonomyRecord
  group: TaxonomyRecord
}

export interface TaxonomyIndex {
  rows: TaxonomyRecord[]
  byId: Map<number, TaxonomyRecord>
  /** Children keyed by parent id; `null` holds the epics. */
  childrenOf: Map<number | null, TaxonomyRecord[]>
  /**
   * Precomputed, so `.get(id)` returns the same object on every render until
   * the tree itself changes. That is what lets a list of open notes render a
   * breadcrumb per row without allocating or walking parents each time.
   */
  pathByGroupId: Map<number, TaxonomyPath>
  /** The user's word for each tier, falling back to the shipped defaults. */
  levelLabels: Map<number, string>
}

const byLabel = (left: TaxonomyRecord, right: TaxonomyRecord) => {
  const compared = left.label.localeCompare(right.label, undefined, { sensitivity: "base" })
  return compared !== 0 ? compared : left.id - right.id
}

export const buildTaxonomyIndex = (
  rows: TaxonomyRecord[],
  levels: TaxonomyLevelRecord[] = [],
): TaxonomyIndex => {
  const byId = new Map<number, TaxonomyRecord>()
  const childrenOf = new Map<number | null, TaxonomyRecord[]>()

  for (const row of rows) {
    byId.set(row.id, row)
  }

  for (const row of rows) {
    const key = row.parentId
    const siblings = childrenOf.get(key)
    if (siblings) {
      siblings.push(row)
    } else {
      childrenOf.set(key, [row])
    }
  }

  for (const siblings of childrenOf.values()) {
    siblings.sort(byLabel)
  }

  const pathByGroupId = new Map<number, TaxonomyPath>()
  for (const row of rows) {
    if (row.level !== TAXONOMY_LEVEL_GROUP) continue
    const category = row.parentId === null ? undefined : byId.get(row.parentId)
    if (!category || category.level !== TAXONOMY_LEVEL_CATEGORY) continue
    const epic = category.parentId === null ? undefined : byId.get(category.parentId)
    if (!epic || epic.level !== TAXONOMY_LEVEL_EPIC) continue
    pathByGroupId.set(row.id, { epic, category, group: row })
  }

  const levelLabels = new Map<number, string>()
  for (const [level, label] of Object.entries(DEFAULT_TAXONOMY_LEVEL_LABELS)) {
    levelLabels.set(Number(level), label)
  }
  for (const level of levels) {
    levelLabels.set(level.level, level.label)
  }

  return { rows, byId, childrenOf, pathByGroupId, levelLabels }
}

export const EMPTY_TAXONOMY_INDEX: TaxonomyIndex = buildTaxonomyIndex([], [])

export const childrenOfLevel = (
  index: TaxonomyIndex,
  parentId: number | null,
): TaxonomyRecord[] => index.childrenOf.get(parentId) ?? []

export const epicsOf = (index: TaxonomyIndex) => childrenOfLevel(index, null)

/**
 * A note can reference a group the tree has not caught up with — created on
 * another device since the last taxonomy fetch. Callers render no path rather
 * than a partial chain.
 */
export const pathForGroup = (
  index: TaxonomyIndex,
  groupId: number | null,
): TaxonomyPath | null => (groupId === null ? null : (index.pathByGroupId.get(groupId) ?? null))

export const formatTaxonomyPath = (path: TaxonomyPath | null): string =>
  path === null ? "" : `${path.epic.label} → ${path.category.label} → ${path.group.label}`

/** Lowest id, matching the server's fallback. */
export const defaultGroupId = (index: TaxonomyIndex): number | null => {
  let fallback: number | null = null
  for (const row of index.rows) {
    if (row.level !== TAXONOMY_LEVEL_GROUP) continue
    if (fallback === null || row.id < fallback) fallback = row.id
  }
  return fallback
}

export const levelLabel = (index: TaxonomyIndex, level: number): string =>
  index.levelLabels.get(level) ?? DEFAULT_TAXONOMY_LEVEL_LABELS[level] ?? ""
