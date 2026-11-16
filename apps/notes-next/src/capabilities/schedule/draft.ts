import { toDateTimeLocalValue } from "@/lib/dates"
import type { ItemDraftPart } from "../types"

export interface ScheduleDraft {
  timeDue: string | null
  timeRemind: string | null
  /** Whether each date field is shown in the form. A collapsed field is not saved. */
  dueExpanded: boolean
  remindExpanded: boolean
}

export const createDefaultDueValue = () => {
  const now = new Date()
  const dueAt = new Date(now.getTime() + 24 * 60 * 60 * 1000)
  return toDateTimeLocalValue(dueAt)
}

export const createDefaultRemindValue = () => {
  const now = new Date()
  const remindAt = new Date(now.getTime() + 30 * 60 * 1000)
  return toDateTimeLocalValue(remindAt)
}

const dateLabel = (value: string) =>
  new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" })

export const schedulePart: ItemDraftPart<ScheduleDraft> = {
  empty: () => ({ timeDue: null, timeRemind: null, dueExpanded: false, remindExpanded: false }),
  isBlank: (draft) =>
    !draft.dueExpanded &&
    draft.timeDue === null &&
    !draft.remindExpanded &&
    draft.timeRemind === null,
  fromItem: (item) => ({
    timeDue: item.timeDue === null ? null : toDateTimeLocalValue(item.timeDue),
    timeRemind: item.timeRemind === null ? null : toDateTimeLocalValue(item.timeRemind),
    dueExpanded: item.timeDue !== null,
    remindExpanded: item.timeRemind !== null,
  }),
  toRequest: (draft) => ({
    timeDue: draft.dueExpanded ? draft.timeDue : null,
    timeRemind: draft.remindExpanded ? draft.timeRemind : null,
  }),
  listLabel: (item) =>
    item.timeDue !== null
      ? `Due ${dateLabel(item.timeDue)}`
      : item.timeRemind !== null
        ? `Reminder ${dateLabel(item.timeRemind)}`
        : null,
}
