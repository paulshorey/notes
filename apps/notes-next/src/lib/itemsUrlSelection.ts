const ITEM_URL_ID_PARAM = "id"
const ITEM_URL_CATEGORY_PARAM = "category"
const ITEM_URL_SUBCATEGORY_PARAM = "subcategory"
const ITEM_URL_TAGS_PARAM = "tags"

export interface ItemsUrlSelection {
  hasState: boolean
  itemId: number | null
  categoryId: number | null
  subcategoryId: number | null
  tagIds: number[]
}

const parsePositiveInteger = (value: string | null) => {
  if (value === null || value.trim() === "") return null

  const parsed = Number.parseInt(value, 10)
  return Number.isInteger(parsed) && parsed > 0 && String(parsed) === value.trim() ? parsed : null
}

export const readItemsUrlSelection = (): ItemsUrlSelection => {
  if (typeof window === "undefined") {
    return { hasState: false, itemId: null, categoryId: null, subcategoryId: null, tagIds: [] }
  }

  const params = new URLSearchParams(window.location.search)
  const rawTags = params.get(ITEM_URL_TAGS_PARAM)
  const tagIds =
    rawTags === null
      ? []
      : Array.from(
          new Set(
            rawTags
              .split(",")
              .map((value) => parsePositiveInteger(value))
              .filter((value): value is number => value !== null),
          ),
        )

  return {
    hasState:
      params.has(ITEM_URL_ID_PARAM) ||
      params.has(ITEM_URL_CATEGORY_PARAM) ||
      params.has(ITEM_URL_TAGS_PARAM),
    itemId: parsePositiveInteger(params.get(ITEM_URL_ID_PARAM)),
    categoryId: parsePositiveInteger(params.get(ITEM_URL_CATEGORY_PARAM)),
    subcategoryId: parsePositiveInteger(params.get(ITEM_URL_SUBCATEGORY_PARAM)),
    tagIds,
  }
}

export const writeItemsUrlSelection = ({
  itemId,
  categoryId,
  subcategoryId,
  tagIds,
}: Omit<ItemsUrlSelection, "hasState">) => {
  if (typeof window === "undefined") {
    return
  }

  const url = new URL(window.location.href)
  if (itemId === null) {
    url.searchParams.delete(ITEM_URL_ID_PARAM)
  } else {
    url.searchParams.set(ITEM_URL_ID_PARAM, String(itemId))
  }

  if (categoryId === null) {
    url.searchParams.delete(ITEM_URL_CATEGORY_PARAM)
  } else {
    url.searchParams.set(ITEM_URL_CATEGORY_PARAM, String(categoryId))
  }

  if (categoryId === null || subcategoryId === null) {
    url.searchParams.delete(ITEM_URL_SUBCATEGORY_PARAM)
  } else {
    url.searchParams.set(ITEM_URL_SUBCATEGORY_PARAM, String(subcategoryId))
  }

  const nextTagIds = Array.from(new Set(tagIds)).filter((id) => Number.isInteger(id) && id > 0)
  if (nextTagIds.length === 0) {
    url.searchParams.delete(ITEM_URL_TAGS_PARAM)
  } else {
    url.searchParams.set(ITEM_URL_TAGS_PARAM, nextTagIds.join(","))
  }

  const nextPath = `${url.pathname}${url.search}${url.hash}`
  const currentPath = `${window.location.pathname}${window.location.search}${window.location.hash}`
  if (nextPath !== currentPath) {
    window.history.replaceState(window.history.state, "", nextPath)
  }
}
