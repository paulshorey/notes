import type { NoteInput } from "./types"
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
export const parseNoteInput = (value: unknown): NoteInput => {
  if (typeof value !== "object" || value === null) throw new Error("Note payload is required.")
  const record = value as Record<string, unknown>
  return {
    workspaceId: positiveInt(record.workspaceId, "workspaceId"),
    categoryIds: ids(record.categoryIds, "categoryIds"),
    statusId:
      record.statusId == null || record.statusId === ""
        ? null
        : positiveInt(record.statusId, "statusId"),
    tagIds: ids(record.tagIds, "tagIds"),
    description: typeof record.description === "string" ? record.description : "",
    timeDue: timestamp(record.timeDue, "Due time"),
    timeRemind: timestamp(record.timeRemind, "Reminder time"),
  }
}
