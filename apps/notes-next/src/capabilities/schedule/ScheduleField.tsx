"use client"

import { CalendarBlank } from "@phosphor-icons/react"
import { useState } from "react"
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
  /** Called when the collapsed control is chosen, before the field expands. */
  onExpand?: () => void
  /** How the field looks before it has a date: a menu row, or a toolbar button. */
  collapsedAs?: "menuitem" | "button"
}

/**
 * One date of an item's schedule. Collapsed, it is a menu item that adds the date with
 * a default value; expanded, it is the date input. A form places the two states where
 * each belongs, using `isScheduleFieldExpanded`.
 */
export function ScheduleField({
  field,
  draft,
  onChange,
  onExpand,
  collapsedAs = "menuitem",
}: ScheduleFieldProps) {
  const { label, defaultValue } = FIELDS[field]

  if (!isScheduleFieldExpanded(draft, field)) {
    const inMenu = collapsedAs === "menuitem"
    return (
      <button
        type="button"
        className={inMenu ? styles.moreMenuItem : styles.dateAddButton}
        aria-label={inMenu ? undefined : `Add ${label.toLowerCase()} date`}
        onClick={() => {
          onExpand?.()
          onChange((current) =>
            field === "due"
              ? { dueExpanded: true, timeDue: current.timeDue || defaultValue() }
              : { remindExpanded: true, timeRemind: current.timeRemind || defaultValue() },
          )
        }}
        role={inMenu ? "menuitem" : undefined}
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
      <DateInput
        value={value ?? ""}
        onCommit={(next) =>
          onChange(() =>
            field === "due"
              ? { timeDue: next, dueExpanded: next !== null }
              : { timeRemind: next, remindExpanded: next !== null },
          )
        }
      />
    </label>
  )
}

/**
 * A date and time input that reports a date only when it has one. While a part of the
 * date is being retyped the browser's value is empty; that is an edit in progress,
 * not a removal, so the draft keeps its date until the field is left empty.
 */
function DateInput({
  value,
  onCommit,
}: {
  value: string
  onCommit: (value: string | null) => void
}) {
  const [incomplete, setIncomplete] = useState(false)

  return (
    <input
      type="datetime-local"
      value={incomplete ? "" : value}
      onChange={(event) => {
        const next = event.target.value
        setIncomplete(next === "")
        if (next !== "") onCommit(next)
      }}
      onBlur={() => {
        if (!incomplete) return
        // Left empty: the user removed the date.
        setIncomplete(false)
        onCommit(null)
      }}
      className={styles.dateInput}
    />
  )
}
