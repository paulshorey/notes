import { toInstant } from "@/lib/dates"
import { itemDraftRequest } from "@/capabilities/draftParts"
import type { TextCaptureFormState } from "@/types/items"
import type { ItemRef } from "@/stores/openItems"

export const snapshotTextCaptureForm = (form: TextCaptureFormState): TextCaptureFormState => ({
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
export const serializeItemDraft = (itemId: ItemRef | null, form: TextCaptureFormState) =>
  JSON.stringify({ itemId, ...itemDraftRequest(form) })

export const itemRequestBody = (form: TextCaptureFormState, workspaceId: number) => ({
  workspaceId,
  ...itemDraftRequest(form),
  timeDue: form.dueExpanded ? toInstant(form.timeDue) : null,
  timeRemind: form.remindExpanded ? toInstant(form.timeRemind) : null,
})

/**
 * The body of a create. It names the uid the new item takes, which makes the request
 * safe to send again: the server stores one item for one uid.
 */
export const newItemRequestBody = (
  form: TextCaptureFormState,
  workspaceId: number,
  uid: string,
) => ({
  uid,
  ...itemRequestBody(form, workspaceId),
})
