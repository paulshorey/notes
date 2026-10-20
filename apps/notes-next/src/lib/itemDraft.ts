import type { TextCaptureFormState } from "@/types/items"
import type { ItemRef } from "@/stores/openItems"

export const snapshotTextCaptureForm = (form: TextCaptureFormState): TextCaptureFormState => ({
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
export const serializeItemDraft = (itemId: ItemRef | null, form: TextCaptureFormState) =>
  JSON.stringify({
    itemId,
    categoryIds: [...form.selectedCategoryIds].sort((left, right) => left - right),
    statusId: form.selectedStatusId,
    tagIds: [...form.selectedTagIds].sort((left, right) => left - right),
    description: form.description,
    timeDue: form.dueExpanded ? form.timeDue : null,
    timeRemind: form.remindExpanded ? form.timeRemind : null,
  })

export const itemRequestBody = (form: TextCaptureFormState, workspaceId: number) => ({
  workspaceId,
  categoryIds: [...form.selectedCategoryIds].sort((left, right) => left - right),
  statusId: form.selectedStatusId,
  tagIds: [...form.selectedTagIds].sort((left, right) => left - right),
  description: form.description,
  timeDue: form.dueExpanded ? form.timeDue : null,
  timeRemind: form.remindExpanded ? form.timeRemind : null,
})

/** Whether an entry holds anything worth sending to the server. */
export const isSaveableForm = (form: TextCaptureFormState) => form.description.trim() !== ""
