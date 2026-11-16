import type { CategoryRecord, ItemRecord, SubcategoryRecord } from "@lib/db-items"

/** Where an entry is filed: one category, and optionally one of its subcategories. */
export interface ItemFiling {
  categoryId: number | null
  subcategoryId: number | null
}

export const NO_FILING: ItemFiling = { categoryId: null, subcategoryId: null }

export const findSubcategory = (
  categories: readonly CategoryRecord[],
  categoryId: number | null,
  subcategoryId: number | null,
): SubcategoryRecord | null =>
  categoryId === null || subcategoryId === null
    ? null
    : (categories
        .find((category) => category.id === categoryId)
        ?.subcategories.find((subcategory) => subcategory.id === subcategoryId) ?? null)

/**
 * The part of a filing that still exists. A missing category clears both levels; a
 * subcategory that is missing, or belongs to another category, clears only itself.
 */
export const existingFiling = (
  categories: readonly CategoryRecord[],
  filing: ItemFiling,
): ItemFiling => {
  const category = categories.find((entry) => entry.id === filing.categoryId)
  if (!category) return NO_FILING
  return {
    categoryId: category.id,
    subcategoryId: findSubcategory(categories, category.id, filing.subcategoryId)?.id ?? null,
  }
}

export const isSameFiling = (left: ItemFiling, right: ItemFiling) =>
  left.categoryId === right.categoryId && left.subcategoryId === right.subcategoryId

/** "work › ideas", "work", or an empty string for an unfiled item. */
export const itemFilingLabel = (item: Pick<ItemRecord, "category" | "subcategory">) =>
  [item.category?.label, item.subcategory?.label].filter(Boolean).join(" › ")

export const filingLabel = (categories: readonly CategoryRecord[], filing: ItemFiling) => {
  const category = categories.find((entry) => entry.id === filing.categoryId)
  if (!category) return ""
  const subcategory = findSubcategory(categories, category.id, filing.subcategoryId)
  return subcategory ? `${category.label} › ${subcategory.label}` : category.label
}

/** Add or replace one category record, keeping the list sorted by label. */
export const upsertCategory = (
  categories: readonly CategoryRecord[],
  category: CategoryRecord,
): CategoryRecord[] =>
  [...categories.filter((entry) => entry.id !== category.id), category].sort((a, b) =>
    a.label.localeCompare(b.label, undefined, { sensitivity: "base" }),
  )
