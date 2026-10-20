import type { ItemRecord } from "@lib/db-items"
import { toDateTimeLocalValue } from "@/lib/dates"

export interface TextCaptureFormState {
  selectedCategoryIds: number[]
  selectedStatusId: number | null
  selectedTagIds: number[]
  description: string
  timeDue: string | null
  timeRemind: string | null
  dueExpanded: boolean
  remindExpanded: boolean
}

export type EmbeddingMaintenanceMode = "missing" | "stale"

/**
 * Lifecycle of the note editor's persistence, surfaced to the UI (e.g. the
 * header save indicator).
 *
 * - `idle`    — empty new draft with nothing worth saving.
 * - `unsaved` — the draft has changes that have not been persisted yet.
 * - `saving`  — a save request for the current note is in flight.
 * - `saved`   — the current note matches what is stored on the server.
 * - `error`   — the last save attempt for the current note failed.
 */
export type ItemSaveStatus = "idle" | "unsaved" | "saving" | "saved" | "error"

export const createDefaultDueValue = () => {
  const now = new Date()
  const dueAt = new Date(now.getTime() + 24 * 60 * 60 * 1000)
  return toDateTimeLocalValue(dueAt)
}

export const createDefaultRemindValue = () => {
  const now = new Date()
  const remindAt = new Date(now.getTime() + 30 * 60 * 1000)
  return toDateTimeLocalValue(remindAt)
}

export const createDefaultTextCaptureForm = (): TextCaptureFormState => {
  return {
    selectedCategoryIds: [],
    selectedStatusId: null,
    selectedTagIds: [],
    description: "",
    timeDue: null,
    timeRemind: null,
    dueExpanded: false,
    remindExpanded: false,
  }
}

export const itemToFormState = (item: ItemRecord): TextCaptureFormState => ({
  selectedCategoryIds: item.categories.map((category) => category.id),
  selectedStatusId: item.status?.id ?? null,
  selectedTagIds: item.tags.map((tag) => tag.id),
  description: item.description ?? "",
  timeDue: item.timeDue === null ? null : toDateTimeLocalValue(item.timeDue),
  timeRemind: item.timeRemind === null ? null : toDateTimeLocalValue(item.timeRemind),
  dueExpanded: item.timeDue !== null,
  remindExpanded: item.timeRemind !== null,
})
