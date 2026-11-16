import type { ItemDraftPart } from "./types"

export interface FilingDraft {
  selectedCategoryId: number | null
  /** Always a subcategory of `selectedCategoryId`; null when there is no category. */
  selectedSubcategoryId: number | null
}

/** Where the item is filed: one category and, inside it, one subcategory. */
export const filingPart: ItemDraftPart<FilingDraft> = {
  empty: () => ({ selectedCategoryId: null, selectedSubcategoryId: null }),
  fromItem: (item) => ({
    selectedCategoryId: item.category?.id ?? null,
    selectedSubcategoryId: item.subcategory?.id ?? null,
  }),
  toRequest: (draft) => ({
    categoryId: draft.selectedCategoryId,
    subcategoryId: draft.selectedSubcategoryId,
  }),
}

export interface TagsDraft {
  selectedTagIds: number[]
}

export const tagsPart: ItemDraftPart<TagsDraft> = {
  empty: () => ({ selectedTagIds: [] }),
  isBlank: (draft) => draft.selectedTagIds.length === 0,
  fromItem: (item) => ({ selectedTagIds: item.tags.map((tag) => tag.id) }),
  toRequest: (draft) => ({
    tagIds: [...draft.selectedTagIds].sort((left, right) => left - right),
  }),
}
