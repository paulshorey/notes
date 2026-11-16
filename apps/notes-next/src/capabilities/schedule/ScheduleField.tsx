"use client"

import { CalendarBlank } from "@phosphor-icons/react"
import styles from "@/components/items/TextCaptureForm.module.css"
import type { DraftControlProps } from "../types"
import { createDefaultDueValue, createDefaultRemindValue, type ScheduleDraft } from "./draft"

const FIELDS = {
  due: { label: "Due", defaultValue: createDefaultDueValue },
  remind: { label: "Remind", defaultValue: createDefaultRemindValue },
} as const

export type ScheduleFieldKey = keyof typeof FIELDS

export const isScheduleFieldExpanded = (draft: ScheduleDraft, field: ScheduleFieldKey) =>
  field === "due" ? draft.dueExpanded : draft.remindExpanded

interface ScheduleFieldProps extends DraftControlProps<ScheduleDraft> {
  field: ScheduleFieldKey
  /** Called when the collapsed menu item is chosen, before the field expands. */
  onExpand?: () => void
}

/**
 * One date of an item's schedule. Collapsed, it is a menu item that adds the date with
 * a default value; expanded, it is the date input. A form places the two states where
 * each belongs, using `isScheduleFieldExpanded`.
 */
export function ScheduleField({ field, draft, onChange, onExpand }: ScheduleFieldProps) {
  const { label, defaultValue } = FIELDS[field]

  if (!isScheduleFieldExpanded(draft, field)) {
    return (
      <button
        type="button"
        className={styles.moreMenuItem}
        onClick={() => {
          onExpand?.()
          onChange((current) =>
            field === "due"
              ? { dueExpanded: true, timeDue: current.timeDue || defaultValue() }
              : { remindExpanded: true, timeRemind: current.timeRemind || defaultValue() },
          )
        }}
        role="menuitem"
      >
        <span>{label}</span>
        <CalendarBlank size={14} weight="regular" />
      </button>
    )
  }

  const value = field === "due" ? draft.timeDue : draft.timeRemind
  return (
    <label className={styles.dateField}>
      <span className={styles.dateFieldLabel}>{label}</span>
      <input
        type="datetime-local"
        value={value ?? ""}
        onChange={(event) => {
          const next = event.target.value
          onChange(() => (field === "due" ? { timeDue: next } : { timeRemind: next }))
        }}
        className={styles.dateInput}
      />
    </label>
  )
}
