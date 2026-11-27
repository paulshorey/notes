import type { ItemRecord } from "@lib/db-items"
import type { OpenItemKey } from "@/stores/openItems"
import type { ItemDraft } from "@/capabilities/draftParts"

/** Hold the editor's save slot through vocabulary creation, the item PATCH, and reconciliation. */
export async function runListWrite(
  key: OpenItemKey,
  inFlight: Map<OpenItemKey, Promise<void>>,
  write: () => Promise<ItemRecord | null>,
  resumeAutosave: () => void,
): Promise<ItemRecord | null> {
  let previous = inFlight.get(key)
  while (previous) {
    await previous.catch(() => undefined)
    previous = inFlight.get(key)
  }
  const request = Promise.resolve().then(write)
  const settled = request
    .then(
      () => undefined,
      () => undefined,
    )
    .finally(() => {
      if (inFlight.get(key) !== settled) return
      inFlight.delete(key)
      resumeAutosave()
    })
  inFlight.set(key, settled)
  return request
}

/** The fields a list action may change on a stored item; the rest are sent as stored. */
export type StoredItemChange = Partial<{
  categoryId: number | null
  subcategoryId: number | null
  statusId: number | null
  timeDue: string | null
  timeRemind: string | null
  tagIds: number[]
}>

export const storedItemFields = (item: ItemRecord): Required<StoredItemChange> => ({
  categoryId: item.category?.id ?? null,
  subcategoryId: item.subcategory?.id ?? null,
  statusId: item.status?.id ?? null,
  timeDue: item.timeDue,
  timeRemind: item.timeRemind,
  tagIds: item.tags.map((tag) => tag.id),
})

/** Whether a change would leave the stored item as it is, so nothing needs sending. */
export const changesNothing = (item: ItemRecord, change: StoredItemChange): boolean => {
  const stored = storedItemFields(item)
  const next = { ...stored, ...change }
  const tags = (ids: number[]) => [...ids].sort((left, right) => left - right).join()
  return (
    next.categoryId === stored.categoryId &&
    next.subcategoryId === stored.subcategoryId &&
    next.statusId === stored.statusId &&
    next.timeDue === stored.timeDue &&
    next.timeRemind === stored.timeRemind &&
    tags(next.tagIds) === tags(stored.tagIds)
  )
}

/**
 * An open draft after a list write to its item landed while the draft held unsaved
 * edits. The edits stay. A field the write changed is taken from `stored`, the form of
 * the item as it is now stored, unless the user changed that same field after the
 * write was sent: `sent` is the draft as it was then, and the later choice wins.
 */
export const draftAfterListWrite = (
  draft: ItemDraft,
  stored: ItemDraft,
  change: StoredItemChange,
  sent: ItemDraft = draft,
): ItemDraft => {
  const refiledSince =
    draft.selectedCategoryId !== sent.selectedCategoryId ||
    draft.selectedSubcategoryId !== sent.selectedSubcategoryId
  return {
    ...draft,
    ...(("categoryId" in change || "subcategoryId" in change) && !refiledSince
      ? {
          selectedCategoryId: stored.selectedCategoryId,
          selectedSubcategoryId: stored.selectedSubcategoryId,
        }
      : {}),
    ...("statusId" in change && draft.selectedStatusId === sent.selectedStatusId
      ? { selectedStatusId: stored.selectedStatusId }
      : {}),
    ...("timeDue" in change && draft.timeDue === sent.timeDue
      ? { timeDue: stored.timeDue, dueExpanded: stored.dueExpanded }
      : {}),
    ...("timeRemind" in change && draft.timeRemind === sent.timeRemind
      ? { timeRemind: stored.timeRemind, remindExpanded: stored.remindExpanded }
      : {}),
    ...("tagIds" in change
      ? {
          // Apply the editor's additions and removals since the click to the stored set.
          selectedTagIds: [
            ...stored.selectedTagIds.filter(
              (id) => !sent.selectedTagIds.includes(id) || draft.selectedTagIds.includes(id),
            ),
            ...draft.selectedTagIds.filter(
              (id) => !sent.selectedTagIds.includes(id) && !stored.selectedTagIds.includes(id),
            ),
          ],
        }
      : {}),
  }
}
