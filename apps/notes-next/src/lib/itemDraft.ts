import { hasText } from "@lib/db-items/contracts/item-capabilities"
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
})

/**
 * The Notes screen captures text, so an entry is worth saving once it has some. This is
 * a rule of this screen only: the item service accepts an item holding any capability.
 */
export const isSaveableForm = (form: TextCaptureFormState) => hasText(form.description)
