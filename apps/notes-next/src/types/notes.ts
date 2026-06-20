import type { NoteInput, NoteRecord, WorkflowStatusRecord } from "@lib/db-marketing"
import { toDateTimeLocalValue } from "@/lib/dates"

export interface NoteFormState {
  selectedCategoryId: number | null
  selectedTagIds: number[]
  description: string
  timeDue: string | null
  timeRemind: string | null
  dueExpanded: boolean
  remindExpanded: boolean
  workflowStatusId: number | null
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
export type NoteSaveStatus = "idle" | "unsaved" | "saving" | "saved" | "error"

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
    workflowStatusId: null,
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
  workflowStatusId: note.workflowStatus?.id ?? null,
})

export const getDefaultWorkflowStatusId = (
  workflowStatuses: WorkflowStatusRecord[],
): number | null => {
  const todoStatus = workflowStatuses.find((status) => status.label === "todo")
  if (todoStatus) {
    return todoStatus.id
  }

  const firstActiveStatus = workflowStatuses.find((status) => !status.isTerminal)
  return firstActiveStatus?.id ?? workflowStatuses[0]?.id ?? null
}

export const noteRecordToInput = (
  note: NoteRecord,
  overrides: Partial<NoteInput> = {},
): NoteInput => ({
  categoryId: note.category.id,
  tagIds: note.tags.map((tag) => tag.id),
  description: note.description ?? "",
  timeDue: note.timeDue,
  timeRemind: note.timeRemind,
  workflowStatusId: note.workflowStatus?.id ?? null,
  ...overrides,
})
