import type { CategoryRecord, ItemRecord } from "@lib/db-items"
import type {
  ItemGroupActionResponse,
  ItemGroupPreview,
  ItemGroupTarget,
} from "@lib/db-items/contracts/item-group-actions"

export const describeItemGroupContents = (preview: ItemGroupPreview) => {
  const notes = preview.textItemCount
  const other = preview.itemCount - notes
  const parts = [`${notes} ${notes === 1 ? "note" : "notes"}`]
  if (other) parts.push(`${other} other ${other === 1 ? "item" : "items"}`)
  return parts.join(" and ")
}

/** Apply a successful server response before any fallible background refresh. */
export const applyItemGroupResult = (items: ItemRecord[], result: ItemGroupActionResponse) => {
  const deleted = new Set(result.deletedItemIds)
  const updated = new Map(result.items.map((item) => [item.id, item]))
  return items.filter((item) => !deleted.has(item.id)).map((item) => updated.get(item.id) ?? item)
}

/**
 * The category list after a group action. The response carries one refreshed category:
 * the one acted on, or the one a group moved into. A subcategory belongs to one
 * category, so any other category still listing a subcategory that moved or was removed
 * gives it up, along with the items counted through it.
 */
export const applyItemGroupResultToCategories = (
  categories: readonly CategoryRecord[],
  result: ItemGroupActionResponse,
): CategoryRecord[] => {
  const gone = new Set(result.category?.subcategories.map((subcategory) => subcategory.id))
  if (result.removedSubcategoryId !== null) gone.add(result.removedSubcategoryId)
  const rest = categories
    .filter(
      (category) => category.id !== result.removedCategoryId && category.id !== result.category?.id,
    )
    .map((category) => {
      const leaving = category.subcategories.filter((subcategory) => gone.has(subcategory.id))
      if (leaving.length === 0) return category
      return {
        ...category,
        itemCount:
          category.itemCount - leaving.reduce((sum, subcategory) => sum + subcategory.itemCount, 0),
        subcategories: category.subcategories.filter((subcategory) => !gone.has(subcategory.id)),
      }
    })
  return result.category ? [...rest, result.category] : rest
}

export interface GroupMoveOption {
  /** The category to move into, or null to make a subcategory a category. */
  categoryId: number | null
  label: string
  /** Why this destination would be refused, so the dialog can say so before sending. */
  conflict: string | null
}

export interface GroupMovePlan {
  /** Why this group cannot be moved at all. */
  blocked: string | null
  options: GroupMoveOption[]
}

/**
 * Where a category or subcategory can go. The hierarchy is two levels, so a
 * subcategory can move to another category or become one, and a category can become a
 * subcategory only while it has none of its own.
 */
export const planGroupMove = (
  categories: readonly CategoryRecord[],
  target: ItemGroupTarget,
): GroupMovePlan => {
  if (target.kind === "uncategorized")
    return { blocked: "Uncategorized notes are filed by naming a category.", options: [] }

  const parent = categories.find((category) =>
    target.kind === "category"
      ? category.id === target.categoryId
      : category.subcategories.some((subcategory) => subcategory.id === target.subcategoryId),
  )
  if (!parent) return { blocked: "This group no longer exists.", options: [] }
  const label =
    target.kind === "category"
      ? parent.label
      : parent.subcategories.find((subcategory) => subcategory.id === target.subcategoryId)!.label

  const into = categories
    .filter((category) => category.id !== parent.id)
    .sort((left, right) =>
      left.label.localeCompare(right.label, undefined, { sensitivity: "base" }),
    )
    .map<GroupMoveOption>((category) => ({
      categoryId: category.id,
      label: category.label,
      conflict: category.subcategories.some((subcategory) => subcategory.label === label)
        ? `“${category.label}” already has a subcategory named “${label}”.`
        : null,
    }))

  if (target.kind === "category") {
    if (parent.subcategories.length > 0)
      return {
        blocked:
          "This category has subcategories. Move or delete them first: a subcategory cannot have subcategories of its own.",
        options: [],
      }
    return {
      blocked: into.length === 0 ? "There is no other category to move this one into." : null,
      options: into,
    }
  }

  return {
    blocked: null,
    options: [
      {
        categoryId: null,
        label: "Top level (make it a category)",
        conflict: categories.some((category) => category.label === label)
          ? `A category named “${label}” already exists.`
          : null,
      },
      ...into,
    ],
  }
}

/**
 * Where a not-yet-saved entry should be filed after a group moved. A saved item is
 * refiled by the server; a draft only holds ids, so it has to follow the group itself
 * or its next save would file it where the group used to be.
 */
export const refileAfterGroupResult = (
  previousCategories: readonly CategoryRecord[],
  result: ItemGroupActionResponse,
  filing: { categoryId: number | null; subcategoryId: number | null },
): { categoryId: number | null; subcategoryId: number | null } => {
  const destination = result.category
  if (!destination || filing.categoryId === null) return filing

  // A category moved into another one. Its new subcategory has the category's label,
  // which is unique within the destination, so the label identifies it even when this
  // client's copy of the destination is missing other subcategories.
  if (result.removedCategoryId !== null && filing.categoryId === result.removedCategoryId) {
    const moved = previousCategories.find((category) => category.id === result.removedCategoryId)
    const created = destination.subcategories.find(
      (subcategory) => subcategory.label === moved?.label,
    )
    return created ? { categoryId: destination.id, subcategoryId: created.id } : filing
  }
  if (filing.subcategoryId === null) return filing

  // A subcategory moved under another category and kept its identity.
  if (destination.subcategories.some((subcategory) => subcategory.id === filing.subcategoryId))
    return { categoryId: destination.id, subcategoryId: filing.subcategoryId }

  // A subcategory became a category: the response names a category other than the one
  // the subcategory was in. Deleting a subcategory names that same category instead.
  if (result.removedSubcategoryId === filing.subcategoryId && destination.id !== filing.categoryId)
    return { categoryId: destination.id, subcategoryId: null }
  return filing
}
