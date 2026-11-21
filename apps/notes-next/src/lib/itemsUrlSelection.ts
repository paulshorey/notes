import { isPublicUid } from "@lib/db-items/contracts/public-uid"

/** The open item, by its public uid. */
const ITEM_URL_UID_PARAM = "item"
/** The open item by its integer id, as addresses written before items had a uid do. */
const ITEM_URL_ID_PARAM = "id"
const ITEM_URL_CATEGORY_PARAM = "category"
const ITEM_URL_SUBCATEGORY_PARAM = "subcategory"
const ITEM_URL_TAGS_PARAM = "tags"

export interface ItemsUrlSelection {
  hasItemTarget: boolean
  hasState: boolean
  itemUid: string | null
  /** Read from an older address only; never written. */
  itemId: number | null
  categoryId: number | null
  subcategoryId: number | null
  tagIds: number[]
}

const parsePositiveInteger = (value: string | null) => {
  if (value === null || value.trim() === "") return null

  const parsed = Number.parseInt(value, 10)
  return Number.isSafeInteger(parsed) &&
    parsed > 0 &&
    parsed <= 2147483647 &&
    String(parsed) === value.trim()
    ? parsed
    : null
}

const parseUid = (value: string | null) => {
  const uid = value?.trim().toLowerCase() ?? null
  return isPublicUid(uid) ? uid : null
}

export const readItemTarget = (params: URLSearchParams) => ({
  hasItemTarget: params.has(ITEM_URL_UID_PARAM) || params.has(ITEM_URL_ID_PARAM),
  itemUid: parseUid(params.get(ITEM_URL_UID_PARAM)),
  itemId: params.has(ITEM_URL_UID_PARAM)
    ? null
    : parsePositiveInteger(params.get(ITEM_URL_ID_PARAM)),
})

export const readItemsUrlSelection = (): ItemsUrlSelection => {
  const params = new URLSearchParams(typeof window === "undefined" ? "" : window.location.search)
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
    ...readItemTarget(params),
    hasState:
      params.has(ITEM_URL_UID_PARAM) ||
      params.has(ITEM_URL_ID_PARAM) ||
      params.has(ITEM_URL_CATEGORY_PARAM) ||
      params.has(ITEM_URL_TAGS_PARAM),
    categoryId: parsePositiveInteger(params.get(ITEM_URL_CATEGORY_PARAM)),
    subcategoryId: parsePositiveInteger(params.get(ITEM_URL_SUBCATEGORY_PARAM)),
    tagIds,
  }
}

export const writeItemsUrlSelection = (
  {
    itemUid,
    categoryId,
    subcategoryId,
    tagIds,
  }: Omit<ItemsUrlSelection, "hasItemTarget" | "hasState" | "itemId">,
  push = false,
) => {
  if (typeof window === "undefined") {
    return
  }

  const url = new URL(window.location.href)
  // An address names an item by its uid, which is the same on every device.
  // A record painted from a cache written before items had a uid has none until the
  // server copy arrives; it gets no address rather than a wrong one.
  url.searchParams.delete(ITEM_URL_ID_PARAM)
  if (!isPublicUid(itemUid)) {
    url.searchParams.delete(ITEM_URL_UID_PARAM)
  } else {
    url.searchParams.set(ITEM_URL_UID_PARAM, itemUid)
    url.searchParams.delete("workspace")
    url.searchParams.delete("workspaceId")
    categoryId = null
    subcategoryId = null
    tagIds = []
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
    if (push) window.history.pushState(null, "", nextPath)
    else window.history.replaceState(window.history.state, "", nextPath)
  }
}
