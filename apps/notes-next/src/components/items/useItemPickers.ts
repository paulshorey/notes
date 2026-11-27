import { useMemo } from "react"
import type { CategoryRecord, TagRecord } from "@lib/db-items"
import { getCategoryNameError } from "@lib/db-items/contracts/category-name"
import { normalizeLabel } from "@/lib/strings"
import { categoryOptions, filingOptionId, NO_FILING, type ItemFiling } from "@/lib/itemFiling"
import type { TextCaptureFormState } from "@/types/items"

export interface ItemPickerProps {
  form: TextCaptureFormState
  userPresent: boolean
  categories: CategoryRecord[]
  tags: TagRecord[]
  pendingTagLabels: string[]
  createCategoryPending: boolean
  createTagPending: boolean
  onSelectFiling: (filing: ItemFiling) => void | Promise<void>
  onSelectSubcategoryId: (rawId: string) => void | Promise<void>
  onCreateCategory: (label: string) => void | Promise<void>
  onCreateSubcategory: (label: string) => void | Promise<void>
  onTagValuesChange: (values: string[], changedLabel: string) => void | Promise<void>
}

export function useItemPickers({
  form,
  userPresent,
  categories,
  tags,
  pendingTagLabels,
  createCategoryPending,
  createTagPending,
  onSelectFiling,
  onSelectSubcategoryId,
  onCreateCategory,
  onCreateSubcategory,
  onTagValuesChange,
}: ItemPickerProps) {
  const selectedCategory = categories.find((category) => category.id === form.selectedCategoryId)
  const selectedSubcategory = selectedCategory?.subcategories.find(
    (subcategory) => subcategory.id === form.selectedSubcategoryId,
  )
  const selectedCategoryLabel = selectedCategory?.label ?? ""
  const selectedSubcategoryLabel = selectedSubcategory?.label ?? ""
  const selectedTagLabels = useMemo(() => {
    const next = [
      ...form.selectedTagIds.map((id) => tags.find((tag) => tag.id === id)?.label ?? `Tag #${id}`),
      ...pendingTagLabels,
    ]
    const seen = new Set<string>()
    return next.filter((label) => {
      const normalized = normalizeLabel(label)
      if (normalized === "" || seen.has(normalized)) {
        return false
      }
      seen.add(normalized)
      return true
    })
  }, [form.selectedTagIds, pendingTagLabels, tags])

  const selectedTagLabelSet = useMemo(() => {
    return new Set(selectedTagLabels.map((label) => normalizeLabel(label)))
  }, [selectedTagLabels])

  const addTagLabel = (label: string) => {
    const normalized = normalizeLabel(label)
    if (normalized === "" || selectedTagLabelSet.has(normalized)) {
      return
    }
    return onTagValuesChange([...selectedTagLabels, label], label)
  }

  const toggleTagLabel = (label: string) => {
    const normalized = normalizeLabel(label)
    if (normalized === "") {
      return
    }
    if (selectedTagLabelSet.has(normalized)) {
      return onTagValuesChange(
        selectedTagLabels.filter((selectedLabel) => normalizeLabel(selectedLabel) !== normalized),
        label,
      )
    }
    return addTagLabel(label)
  }

  // What each picker offers is the same wherever the view places it.
  const options = useMemo(() => categoryOptions(categories), [categories])
  const categoryPicker = {
    triggerAriaLabel: "Categories",
    listboxAriaLabel: "Category options",
    options,
    createOnNewLabel: true,
    selectedIds: [
      filingOptionId({
        categoryId: form.selectedCategoryId,
        subcategoryId: form.selectedSubcategoryId,
      }),
    ],
    disabled: !userPresent,
    pending: createCategoryPending,
    onSelectOption: (option: { id: string | number }) => {
      const destination = options.find((candidate) => candidate.id === option.id)
      if (!destination) return
      const filing = destination.filing
      const reselectedParent =
        filing.subcategoryId === null &&
        form.selectedSubcategoryId === null &&
        filing.categoryId === form.selectedCategoryId
      return onSelectFiling(reselectedParent ? NO_FILING : filing)
    },
    onCreateOption: onCreateCategory,
    validateInput: (label: string) =>
      normalizeLabel(label) === "uncategorized" ? null : getCategoryNameError(label),
    emptyWithoutQueryMessage: "No categories yet",
    inputPlaceholder: "Enter new category...",
  }
  const subcategoryPicker = {
    triggerAriaLabel: "Subcategory",
    listboxAriaLabel: "Subcategory options",
    options: [{ id: "", label: "no subcategory" }, ...(selectedCategory?.subcategories ?? [])],
    selectedIds: [form.selectedSubcategoryId ?? ""],
    disabled: !userPresent || !selectedCategory,
    pending: createCategoryPending,
    onSelectOption: (subcategory: { id: number | string }) =>
      onSelectSubcategoryId(String(subcategory.id)),
    onCreateOption: onCreateSubcategory,
    validateInput: getCategoryNameError,
    inputPlaceholder: "Enter new subcategory...",
  }
  const tagPicker = {
    triggerAriaLabel: "Tags",
    listboxAriaLabel: "Tag options",
    options: tags,
    selectedIds: form.selectedTagIds,
    pending: createTagPending,
    multiple: true,
    onSelectOption: (tag: { label: string }) => toggleTagLabel(tag.label),
    onCreateOption: addTagLabel,
    emptyWithoutQueryMessage: "No tags yet",
    inputPlaceholder: "Enter new tag...",
  }

  return {
    categoryPicker,
    subcategoryPicker,
    tagPicker,
    selectedCategoryLabel,
    selectedSubcategoryLabel,
    selectedTagLabels,
  }
}
