import type { NoteFormState } from "@/types/notes"
import type { NoteRef } from "@/stores/openNotes"

export const snapshotNoteForm = (form: NoteFormState): NoteFormState => ({
  ...form,
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
    groupId: form.selectedGroupId,
    tagIds: [...form.selectedTagIds].sort((left, right) => left - right),
    description: form.description,
    timeDue: form.dueExpanded ? form.timeDue : null,
    timeRemind: form.remindExpanded ? form.timeRemind : null,
  })

export const noteRequestBody = (form: NoteFormState) => ({
  groupId: form.selectedGroupId,
  tagIds: form.selectedTagIds,
  description: form.description,
  timeDue: form.dueExpanded ? form.timeDue : null,
  timeRemind: form.remindExpanded ? form.timeRemind : null,
})

/** Whether an entry holds anything worth sending to the server. */
export const isSaveableForm = (form: NoteFormState) =>
  form.description.trim() !== "" && form.selectedGroupId !== null

/**
 * Has content the user would expect to be stored, but cannot be sent yet.
 * Autosave skips these silently, so the UI has to say so.
 */
export const isBlockedForm = (form: NoteFormState) =>
  form.description.trim() !== "" && form.selectedGroupId === null
