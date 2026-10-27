import type { ItemRecord } from "@lib/db-items"
import type {
  ItemGroupActionResponse,
  ItemGroupPreview,
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
