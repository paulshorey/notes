import type { NoteFormState } from "@/types/notes"
import type { NoteRef } from "@/stores/openNotes"

export const snapshotNoteForm = (form: NoteFormState): NoteFormState => ({
  ...form,
  selectedCategoryIds: [...form.selectedCategoryIds],
  selectedTagIds: [...form.selectedTagIds],
})

/**
 * Stable string identifying exactly what would be persisted. Comparing this
 * against an entry's `savedSignature` is the dirty check, so it must include
 * the note id: a draft's signature changes when its first save assigns one,
 * and the saved signature has to be recomputed with the new id at that moment
 * or the entry reads as permanently dirty.
 */
export const serializeNoteDraft = (noteId: NoteRef | null, form: NoteFormState) =>
  JSON.stringify({
    noteId,
    categoryIds: [...form.selectedCategoryIds].sort((left, right) => left - right),
    statusId: form.selectedStatusId,
    tagIds: [...form.selectedTagIds].sort((left, right) => left - right),
    description: form.description,
    timeDue: form.dueExpanded ? form.timeDue : null,
    timeRemind: form.remindExpanded ? form.timeRemind : null,
  })

export const noteRequestBody = (form: NoteFormState, workspaceId: number) => ({
  workspaceId,
  categoryIds: [...form.selectedCategoryIds].sort((left, right) => left - right),
  statusId: form.selectedStatusId,
  tagIds: [...form.selectedTagIds].sort((left, right) => left - right),
  description: form.description,
  timeDue: form.dueExpanded ? form.timeDue : null,
  timeRemind: form.remindExpanded ? form.timeRemind : null,
})

/** Whether an entry holds anything worth sending to the server. */
export const isSaveableForm = (form: NoteFormState) => form.description.trim() !== ""
