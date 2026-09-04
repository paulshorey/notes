import type { NoteRecord } from "@lib/db-notes"
import { toDateTimeLocalValue } from "@/lib/dates"

export interface NoteFormState {
  /**
   * The leaf group, and the only taxonomy field a draft holds. The epic and
   * category are derived from the tree, so browsing the picker never marks an
   * entry dirty and moving a group never rewrites a note.
   */
  selectedGroupId: number | null
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
 * - `blocked` — the draft has changes but cannot be saved yet, because it has
 *   no group. Distinct from `unsaved` because autosave will not retry it: a
 *   silently skipped save is indistinguishable from a successful one, and the
 *   local snapshot reproduces the note on reload either way.
 */
export type NoteSaveStatus =
  | "idle"
  | "unsaved"
  | "blocked"
  | "saving"
  | "saved"
  | "error"

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
    selectedGroupId: null,
    selectedTagIds: [],
    description: "",
    timeDue: null,
    timeRemind: null,
    dueExpanded: false,
    remindExpanded: false,
  }
}

export const noteToFormState = (note: NoteRecord): NoteFormState => ({
  selectedGroupId: note.groupId,
  selectedTagIds: note.tags.map((tag) => tag.id),
  description: note.description ?? "",
  timeDue: note.timeDue === null ? null : toDateTimeLocalValue(note.timeDue),
  timeRemind: note.timeRemind === null ? null : toDateTimeLocalValue(note.timeRemind),
  dueExpanded: note.timeDue !== null,
  remindExpanded: note.timeRemind !== null,
})
