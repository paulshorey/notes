import type { CategoryRecord, ItemRecord } from "@lib/db-items"
import { UNCATEGORIZED_LABEL } from "@lib/db-items/contracts/category-name"

export interface DisplayItemItem {
  item: ItemRecord
  relevance?: number | null
}

export type CategoryItemGroup = {
  items: DisplayItemItem[]
  sortTime: number
} & ({ kind: "category"; category: CategoryRecord } | { kind: "uncategorized" })

export const getItemSortTime = (item: ItemRecord) => {
  const time = Date.parse(item.timeModified)
  return Number.isFinite(time) ? time : 0
}

export const getGroupSortTime = (items: DisplayItemItem[]) =>
  items.reduce((latest, { item }) => Math.max(latest, getItemSortTime(item)), 0)

/** Build one display list; uncategorized has no persisted category identity. */
export const buildCategoryItemGroups = (
  categories: readonly CategoryRecord[],
  itemItems: readonly DisplayItemItem[],
): CategoryItemGroup[] => {
  const groups = categories.map<CategoryItemGroup & { kind: "category" }>((category) => ({
    kind: "category",
    category,
    items: [],
    sortTime: 0,
  }))
  const byCategoryId = new Map(groups.map((group) => [group.category.id, group]))
  const uncategorized: CategoryItemGroup = { kind: "uncategorized", items: [], sortTime: 0 }

  const sortedItems = [...itemItems].sort(
    (left, right) =>
      getItemSortTime(right.item) - getItemSortTime(left.item) || left.item.id - right.item.id,
  )
  for (const item of sortedItems) {
    if (item.item.categories.length === 0) {
      uncategorized.items.push(item)
    } else {
      for (const category of item.item.categories) byCategoryId.get(category.id)?.items.push(item)
    }
  }

  const visibleGroups: CategoryItemGroup[] = [...groups]
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
