import type { CategoryRecord, ItemRecord, SubcategoryRecord } from "@lib/db-items"
import { UNCATEGORIZED_LABEL } from "@lib/db-items/contracts/category-name"

export interface DisplayItemItem {
  item: ItemRecord
  relevance?: number | null
}

export interface SubcategoryItemGroup {
  subcategory: SubcategoryRecord
  items: DisplayItemItem[]
  sortTime: number
}

/**
 * `items` are the notes filed directly in the group. A category also lists its
 * subcategories, each with its own notes; `itemCount` and `sortTime` cover both.
 */
export type CategoryItemGroup = {
  items: DisplayItemItem[]
  itemCount: number
  sortTime: number
} & (
  | { kind: "category"; category: CategoryRecord; subgroups: SubcategoryItemGroup[] }
  | { kind: "uncategorized" }
)

export const getItemSortTime = (item: ItemRecord) => {
  const time = Date.parse(item.timeModified)
  return Number.isFinite(time) ? time : 0
}

export const getGroupSortTime = (items: DisplayItemItem[]) =>
  items.reduce((latest, { item }) => Math.max(latest, getItemSortTime(item)), 0)

/** Groups with notes first, then the most recently modified, then by label. */
const compareGroups = (
  left: { count: number; sortTime: number; label: string; tieBreak: number },
  right: { count: number; sortTime: number; label: string; tieBreak: number },
) =>
  Number(right.count > 0) - Number(left.count > 0) ||
  right.sortTime - left.sortTime ||
  left.label.localeCompare(right.label, undefined, { sensitivity: "base" }) ||
  left.tieBreak - right.tieBreak

/** Build one display list; uncategorized has no persisted category identity. */
export const buildCategoryItemGroups = (
  categories: readonly CategoryRecord[],
  itemItems: readonly DisplayItemItem[],
): CategoryItemGroup[] => {
  const groups = categories.map<CategoryItemGroup & { kind: "category" }>((category) => ({
    kind: "category",
    category,
    subgroups: category.subcategories.map((subcategory) => ({
      subcategory,
      items: [],
      sortTime: 0,
    })),
    items: [],
    itemCount: 0,
    sortTime: 0,
  }))
  const byCategoryId = new Map(groups.map((group) => [group.category.id, group]))
  const uncategorized: CategoryItemGroup = {
    kind: "uncategorized",
    items: [],
    itemCount: 0,
    sortTime: 0,
  }

  const sortedItems = [...itemItems].sort(
    (left, right) =>
      getItemSortTime(right.item) - getItemSortTime(left.item) || left.item.id - right.item.id,
  )
  for (const item of sortedItems) {
    const group = item.item.category ? byCategoryId.get(item.item.category.id) : uncategorized
    // An item whose category is not in the list yet is shown once that list refreshes.
    if (!group) continue
    const subgroup =
      group.kind === "category" && item.item.subcategory
        ? group.subgroups.find((entry) => entry.subcategory.id === item.item.subcategory!.id)
        : undefined
    ;(subgroup ?? group).items.push(item)
    group.itemCount += 1
  }

  const visibleGroups: CategoryItemGroup[] = [...groups]
  if (uncategorized.itemCount > 0) visibleGroups.push(uncategorized)
  for (const group of visibleGroups) {
    group.sortTime = getGroupSortTime(group.items)
    if (group.kind !== "category") continue
    for (const subgroup of group.subgroups) {
      subgroup.sortTime = getGroupSortTime(subgroup.items)
      group.sortTime = Math.max(group.sortTime, subgroup.sortTime)
    }
    group.subgroups.sort((left, right) =>
      compareGroups(
        {
          count: left.items.length,
          sortTime: left.sortTime,
          label: left.subcategory.label,
          tieBreak: left.subcategory.id,
        },
        {
          count: right.items.length,
          sortTime: right.sortTime,
          label: right.subcategory.label,
          tieBreak: right.subcategory.id,
        },
      ),
    )
  }

  const sortKey = (group: CategoryItemGroup) => ({
    count: group.itemCount,
    sortTime: group.sortTime,
    label: group.kind === "category" ? group.category.label : UNCATEGORIZED_LABEL,
    // Uncategorized has no id; it sorts after a category with the same label and time.
    tieBreak: group.kind === "category" ? group.category.id : Number.MAX_SAFE_INTEGER,
  })
  return visibleGroups.sort((left, right) => compareGroups(sortKey(left), sortKey(right)))
}
