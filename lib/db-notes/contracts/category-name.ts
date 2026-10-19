/** Display-only name for notes with no category links; never a vocabulary row. */
export const UNCATEGORIZED_LABEL = "uncategorized"
export const RESERVED_CATEGORY_NAME_ERROR =
  "‘uncategorized’ is reserved for notes without a category. Choose another name."

export const getCategoryNameError = (value: string): string | null =>
  value.trim().toLowerCase() === UNCATEGORIZED_LABEL ? RESERVED_CATEGORY_NAME_ERROR : null

export const assertCategoryNameAllowed = (value: string) => {
  const error = getCategoryNameError(value)
  if (error) throw new Error(error)
}
