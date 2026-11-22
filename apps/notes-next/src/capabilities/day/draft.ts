import type { ItemDraftPart } from "../types"

/**
 * The journal day a stored item holds. No form edits it yet, so the draft only carries
 * it: it keeps an entry whose text was emptied, and a save names the day it holds, so an
 * entry without text still has content. A draft with no day names none.
 */
export interface DayDraft {
  entryDate: string | null
}

export const dayPart: ItemDraftPart<DayDraft> = {
  empty: () => ({ entryDate: null }),
  fromItem: (item) => ({ entryDate: item.entryDate }),
  toRequest: (draft) => (draft.entryDate ? { entryDate: draft.entryDate } : {}),
  // A draft restored from browser storage may predate this part and hold no day.
  holds: (draft) => (draft.entryDate ?? null) !== null,
}
