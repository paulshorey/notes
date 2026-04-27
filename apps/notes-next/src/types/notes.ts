import type { NoteRecord } from "@lib/db-marketing"
import { toDateTimeLocalValue } from "@/lib/dates"

export interface NoteFormState {
  selectedCategoryId: number | null
  selectedTagIds: number[]
  description: string
  timeDue: string | null
  timeRemind: string | null
  dueExpanded: boolean
  remindExpanded: boolean
}

export type EmbeddingMaintenanceMode = "missing" | "stale"

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

export const createDefaultNoteForm = (): NoteFormState => {
  return {
    selectedCategoryId: null,
    selectedTagIds: [],
    description: "",
    timeDue: null,
    timeRemind: null,
    dueExpanded: false,
    remindExpanded: false,
  }
}

export const noteToFormState = (note: NoteRecord): NoteFormState => ({
  selectedCategoryId: note.category.id,
  selectedTagIds: note.tags.map((tag) => tag.id),
  description: note.description ?? "",
  timeDue: note.timeDue === null ? null : toDateTimeLocalValue(note.timeDue),
  timeRemind: note.timeRemind === null ? null : toDateTimeLocalValue(note.timeRemind),
  dueExpanded: note.timeDue !== null,
  remindExpanded: note.timeRemind !== null,
})
