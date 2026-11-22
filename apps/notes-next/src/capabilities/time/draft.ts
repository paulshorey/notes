import type { ItemDraftPart } from "../types"

/**
 * The time block a stored item holds. No form edits it yet, so the draft only carries
 * whether one exists: it keeps an item whose text was emptied, and a save names neither
 * time field, which leaves the stored block as it is.
 */
export interface TimeDraft {
  timeStart: string | null
}

export const timePart: ItemDraftPart<TimeDraft> = {
  empty: () => ({ timeStart: null }),
  fromItem: (item) => ({ timeStart: item.timeStart }),
  toRequest: () => ({}),
  holds: (draft) => draft.timeStart != null,
}
