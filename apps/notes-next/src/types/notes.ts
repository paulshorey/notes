import type { NoteRecord } from "@lib/db-marketing"
import { toDateTimeLocalValue } from "@/lib/dates"

export interface NoteFormState {
  selectedCategoryId: number | null
  selectedTagIds: number[]
  description: string
  timeDue: string
  timeRemind: string
}

export type EmbeddingMaintenanceMode = "missing" | "stale"

export const createDefaultNoteForm = (): NoteFormState => {
  const now = new Date()
  const remindAt = new Date(now.getTime() + 30 * 60 * 1000)
  const dueAt = new Date(now.getTime() + 24 * 60 * 60 * 1000)
  return {
    selectedCategoryId: null,
    selectedTagIds: [],
    description: "",
    timeDue: toDateTimeLocalValue(dueAt),
    timeRemind: toDateTimeLocalValue(remindAt),
  }
}

export const noteToFormState = (note: NoteRecord): NoteFormState => ({
  selectedCategoryId: note.category.id,
  selectedTagIds: note.tags.map((tag) => tag.id),
  description: note.description ?? "",
  timeDue: toDateTimeLocalValue(note.timeDue),
  timeRemind: toDateTimeLocalValue(note.timeRemind),
})
