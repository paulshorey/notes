import { type CategoryRecord, type TagRecord } from "@lib/db-items"
import { createDefaultTextCaptureForm, type TextCaptureFormState } from "@/types/items"
import { serializeItemDraft } from "@/lib/itemDraft"
import { type OpenItemEntry } from "@/stores/openItems"

export const PREFERENCES_SAVE_DEBOUNCE_MS = 500
export const OPEN_ITEMS_PERSIST_DEBOUNCE_MS = 1000
export const TAXONOMY_REFRESH_DEBOUNCE_MS = 4000

export const getDefaultTagId = (tagList: TagRecord[]) =>
  tagList.length > 0 ? tagList.reduce((a, b) => (a.id < b.id ? a : b)).id : null

export type ItemGroupSortRecord = CategoryRecord | TagRecord

export const compareItemGroups = <
  T extends { sortTime: number } & (
    | { category: ItemGroupSortRecord }
    | { tag: ItemGroupSortRecord }
  ),
>(
  left: T,
  right: T,
) => {
  const leftRecord = "category" in left ? left.category : left.tag
  const rightRecord = "category" in right ? right.category : right.tag

  return (
    right.sortTime - left.sortTime ||
    leftRecord.label.localeCompare(rightRecord.label, undefined, { sensitivity: "base" }) ||
    leftRecord.id - rightRecord.id
  )
}

/**
 * How a save was triggered. All three are silent — the editor has no submit
 * control, so every save is a background save.
 *
 * - `autosave` — debounced background save while the note stays open.
 * - `flush`    — forced save awaited by the caller, used before the session
 *   is torn down (sign-in, sign-up, sign-out) so nothing is lost in transit.
 * - `detached` — save of an entry that has already left the ring, by eviction,
 *   close, or a lowered cap. Never touches store state, since there is no
 *   longer a slot to write back to.
 */
export type ItemSaveMode = "autosave" | "flush" | "detached"

/**
 * A dirty entry that left the ring but whose text still has to reach the
 * server. `savedSignature` tracks what has already landed for it, because a
 * save that completes after the entry is gone has no store slot to write to.
 */
export interface DetachedSave {
  itemId: number | null
  form: TextCaptureFormState
  savedSignature: string | null
}

export const entrySignature = (entry: OpenItemEntry) => serializeItemDraft(entry.itemId, entry.form)

// Stable identities so an empty ring does not remount the editor every render.
export const EMPTY_ITEM_FORM: TextCaptureFormState = createDefaultTextCaptureForm()
export const EMPTY_PENDING_TAG_LABELS: string[] = []

export const isEntryDirty = (entry: OpenItemEntry) => entrySignature(entry) !== entry.savedSignature
