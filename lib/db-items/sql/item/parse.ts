import { parseEntryDate } from "../../contracts/item-journal"
import { normalizeTimeBlock } from "../../contracts/item-time"
import { parseOptionalPublicUid } from "../../contracts/public-uid"
import type { ItemInput, ItemPatch } from "./types"
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

const record = (value: unknown) => {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("Item payload is required.")
  return value as Record<string, unknown>
}

const text = (value: unknown) => {
  if (value == null) return null
  if (typeof value !== "string") throw new Error("description must be text.")
  return value
}

/**
 * The fields of an item write that a request names. A field that is absent is left
 * out of the result, which is how a request says nothing about it.
 */
const parseNamedFields = (fields: Record<string, unknown>): ItemPatch => {
  const named = <Value>(field: keyof ItemPatch, parse: (raw: unknown) => Value) =>
    fields[field] === undefined ? {} : { [field]: parse(fields[field]) }
  return {
    ...named("workspaceId", (raw) => positiveInt(raw, "workspaceId")),
    ...named("categoryId", (raw) => nullableId(raw, "categoryId")),
    ...named("subcategoryId", (raw) => nullableId(raw, "subcategoryId")),
    ...named("statusId", (raw) => nullableId(raw, "statusId")),
    ...named("tagIds", (raw) => ids(raw, "tagIds")),
    ...named("description", text),
    ...named("timeStart", (raw) => timestamp(raw, "Start time")),
    ...named("timeEnd", (raw) => timestamp(raw, "End time")),
    ...named("entryDate", parseEntryDate),
    ...named("timeDue", (raw) => timestamp(raw, "Due time")),
    ...named("timeRemind", (raw) => timestamp(raw, "Reminder time")),
  }
}

/** A new item: every field it does not name is empty. */
export const parseItemInput = (value: unknown): ItemInput => {
  const fields = record(value)
  return normalizeTimeBlock({
    uid: parseOptionalPublicUid(fields.uid),
    categoryId: null,
    subcategoryId: null,
    statusId: null,
    tagIds: [],
    description: null,
    timeDue: null,
    timeRemind: null,
    ...parseNamedFields(fields),
    workspaceId: positiveInt(fields.workspaceId, "workspaceId"),
  })
}

/** A change to a stored item: only the fields the request names. */
export const parseItemPatch = (value: unknown): ItemPatch =>
  normalizeTimeBlock(parseNamedFields(record(value)))
