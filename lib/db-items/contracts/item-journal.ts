import { InvalidRequestError } from "./request-error"
export const JOURNAL_DAY_TAKEN_ERROR = "This day already has a journal entry."

/** A write would give a workspace a second journal entry for one day. */
export class JournalDayTakenError extends Error {
  constructor() {
    super(JOURNAL_DAY_TAKEN_ERROR)
    this.name = "JournalDayTakenError"
  }
}

/** The unique index that keeps one journal entry per workspace and day. */
export const JOURNAL_DAY_INDEX = "workspace_item_v1_journal_day_key"

export const isJournalDayViolation = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  error.code === "23505" &&
  "constraint" in error &&
  error.constraint === JOURNAL_DAY_INDEX

/**
 * A journal entry's day as `YYYY-MM-DD`: a calendar date with no time or zone, so it
 * is the same day wherever it is read. Null and the empty string mean no day.
 */
export const parseEntryDate = (value: unknown): string | null => {
  if (value == null || value === "") return null
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const date = new Date(`${value}T00:00:00Z`)
    if (!Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value) return value
  }
  throw new InvalidRequestError("Journal day must be a date such as 2026-11-25.")
}
