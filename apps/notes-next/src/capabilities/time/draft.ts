import type { ItemDraftPart } from "../types"

export interface TimeDraft {
  /** The block's two ends as ISO instants, both set or both null. */
  timeStart: string | null
  timeEnd: string | null
  timePlanned: boolean
  /**
   * Whether a save says anything about the time block. False for an item that never
   * had one, whose saves leave the fields out so its signature is the one stored
   * before items had time blocks. True once an item has, or had, a block.
   */
  timeBlockKnown: boolean
}

/**
 * A draft restored from browser storage may predate this part and hold none of its
 * fields, so every read goes through here.
 */
const read = (draft: Partial<TimeDraft>): TimeDraft => ({
  timeStart: draft.timeStart ?? null,
  timeEnd: draft.timeEnd ?? null,
  timePlanned: draft.timePlanned ?? false,
  timeBlockKnown: draft.timeBlockKnown ?? false,
})

export const draftHasTimeBlock = (draft: Partial<TimeDraft>): boolean =>
  read(draft).timeStart !== null

const clock = (value: string) =>
  new Date(value).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })

export const timePart: ItemDraftPart<TimeDraft> = {
  empty: () => ({ timeStart: null, timeEnd: null, timePlanned: false, timeBlockKnown: false }),
  isBlank: (draft) => !draftHasTimeBlock(draft),
  holds: draftHasTimeBlock,
  fromItem: (item) => ({
    timeStart: item.timeStart,
    timeEnd: item.timeEnd,
    timePlanned: item.timePlanned,
    timeBlockKnown: item.timeStart !== null,
  }),
  toRequest: (draft) => {
    const { timeStart, timeEnd, timePlanned, timeBlockKnown } = read(draft)
    // Leaving the fields out tells the server to keep whatever is stored. A restored
    // draft that holds a start but no timeBlockKnown flag predates the end field, so
    // it also leaves them out rather than send a start with no end.
    if (!timeBlockKnown) return {}
    return { timeStart, timeEnd, timePlanned: timeStart !== null && timePlanned }
  },
  listLabel: (item) =>
    item.timeStart === null || item.timeEnd === null
      ? null
      : item.timeStart === item.timeEnd
        ? clock(item.timeStart)
        : `${clock(item.timeStart)} – ${clock(item.timeEnd)}`,
}
