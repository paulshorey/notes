import type { CategoryRecord, NoteRecord } from "@lib/db-notes"
import { UNCATEGORIZED_LABEL } from "@lib/db-notes/contracts/category-name"

export interface DisplayNoteItem {
  note: NoteRecord
  relevance?: number | null
}

export type CategoryNoteGroup = {
  items: DisplayNoteItem[]
  sortTime: number
} & ({ kind: "category"; category: CategoryRecord } | { kind: "uncategorized" })

export const getNoteSortTime = (note: NoteRecord) => {
  const time = Date.parse(note.timeModified)
  return Number.isFinite(time) ? time : 0
}

export const getGroupSortTime = (items: DisplayNoteItem[]) =>
  items.reduce((latest, { note }) => Math.max(latest, getNoteSortTime(note)), 0)

/** Build one display list; uncategorized has no persisted category identity. */
export const buildCategoryNoteGroups = (
  categories: readonly CategoryRecord[],
  noteItems: readonly DisplayNoteItem[],
): CategoryNoteGroup[] => {
  const groups = categories.map<CategoryNoteGroup & { kind: "category" }>((category) => ({
    kind: "category",
    category,
    items: [],
    sortTime: 0,
  }))
  const byCategoryId = new Map(groups.map((group) => [group.category.id, group]))
  const uncategorized: CategoryNoteGroup = { kind: "uncategorized", items: [], sortTime: 0 }

  const sortedItems = [...noteItems].sort(
    (left, right) =>
      getNoteSortTime(right.note) - getNoteSortTime(left.note) || left.note.id - right.note.id,
  )
  for (const item of sortedItems) {
    if (item.note.categories.length === 0) {
      uncategorized.items.push(item)
    } else {
      for (const category of item.note.categories) byCategoryId.get(category.id)?.items.push(item)
    }
  }

  const visibleGroups: CategoryNoteGroup[] = [...groups]
  if (uncategorized.items.length > 0) visibleGroups.push(uncategorized)
  for (const group of visibleGroups) group.sortTime = getGroupSortTime(group.items)

  return visibleGroups.sort((left, right) => {
    const leftLabel = left.kind === "category" ? left.category.label : UNCATEGORIZED_LABEL
    const rightLabel = right.kind === "category" ? right.category.label : UNCATEGORIZED_LABEL
    const tieBreak =
      left.kind === "category" && right.kind === "category"
        ? left.category.id - right.category.id
        : left.kind.localeCompare(right.kind)
    return (
      Number(right.items.length > 0) - Number(left.items.length > 0) ||
      right.sortTime - left.sortTime ||
      leftLabel.localeCompare(rightLabel, undefined, { sensitivity: "base" }) ||
      tieBreak
    )
  })
}
