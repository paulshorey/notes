import { parseEntryDate } from "../../contracts/item-journal"
import { normalizeTimeBlock } from "../../contracts/item-time"
import { parseOptionalPublicUid } from "../../contracts/public-uid"
import type { ItemInput } from "./types"
const positiveInt = (value: unknown, field: string): number => {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number.parseInt(value, 10)
        : NaN
  if (!Number.isInteger(parsed) || parsed < 1)
    throw new Error(`${field} must be an integer of at least 1.`)
  return parsed
}
const ids = (value: unknown, field: string) => {
  if (value == null) return []
  if (!Array.isArray(value)) throw new Error(`${field} must be an array of integers.`)
  return [...new Set(value.map((item) => positiveInt(item, field)))].sort((a, b) => a - b)
}
const timestamp = (value: unknown, field: string) => {
  if (value == null || value === "") return null
  if (typeof value !== "string") throw new Error(`${field} must be a valid date.`)
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) throw new Error(`${field} must be a valid date.`)
  return date.toISOString()
}
const nullableId = (value: unknown, field: string) =>
  value == null || value === "" ? null : positiveInt(value, field)

export const OUTDATED_ITEM_REQUEST_ERROR =
  "This page is out of date. Reload it to keep saving; your text is kept."

/**
 * A request that lists `categoryIds` comes from a page loaded before items had one
 * category. Saving it would unfile the item, so it is refused and the page keeps its
 * draft until it is reloaded.
 */
const categoryId = (record: Record<string, unknown>) => {
  if (record.categoryId === undefined && record.categoryIds !== undefined)
    throw new Error(OUTDATED_ITEM_REQUEST_ERROR)
  return nullableId(record.categoryId, "categoryId")
}

export const parseItemInput = (value: unknown): ItemInput => {
  if (typeof value !== "object" || value === null) throw new Error("Item payload is required.")
  const record = value as Record<string, unknown>
  // A field that is absent is left out, which is how a request says nothing about it.
  const optional = <Value>(field: string, parse: (raw: unknown) => Value) =>
    record[field] === undefined ? {} : { [field]: parse(record[field]) }
  return normalizeTimeBlock({
    uid: parseOptionalPublicUid(record.uid),
    workspaceId: positiveInt(record.workspaceId, "workspaceId"),
    categoryId: categoryId(record),
    subcategoryId: nullableId(record.subcategoryId, "subcategoryId"),
    statusId:
      record.statusId == null || record.statusId === ""
        ? null
        : positiveInt(record.statusId, "statusId"),
    tagIds: ids(record.tagIds, "tagIds"),
    description: typeof record.description === "string" ? record.description : null,
    ...(optional("timeStart", (raw) => timestamp(raw, "Start time")) as Pick<
      ItemInput,
      "timeStart"
    >),
    ...(optional("timeEnd", (raw) => timestamp(raw, "End time")) as Pick<ItemInput, "timeEnd">),
    ...(optional("entryDate", parseEntryDate) as Pick<ItemInput, "entryDate">),
    timeDue: timestamp(record.timeDue, "Due time"),
    timeRemind: timestamp(record.timeRemind, "Reminder time"),
  })
}
