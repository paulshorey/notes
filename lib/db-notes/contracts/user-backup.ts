import type {
  BackupNote,
  BackupStatus,
  BackupVocabulary,
  BackupWorkspace,
  UserBackup,
  UserPreferences,
} from "./notes-app"

export const USER_BACKUP_FORMAT = "jot.new-user-backup"
export const USER_BACKUP_VERSION = 1
export const USER_BACKUP_MAX_BYTES = 50 * 1024 * 1024
const MAX_RECORDS = 100_000

export class BackupValidationError extends Error {}

const fail = (message: string): never => {
  throw new BackupValidationError(message)
}
const object = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : fail("Backup contains an invalid object.")
const array = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : fail("Backup contains an invalid list.")
const validText = (value: string) =>
  !value.includes("\0") &&
  !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)
const label = (value: unknown): string =>
  typeof value === "string" &&
  value.length > 0 &&
  value === value.trim().toLowerCase() &&
  validText(value)
    ? value
    : fail("Backup labels must be nonempty, normalized text.")
const timestamp = (value: unknown): string => {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) ||
    !Number.isFinite(Date.parse(value))
  )
    return fail("Backup contains an invalid date.")
  // Date.parse normalizes impossible days (for example February 31). Reject
  // that instead of silently changing a backed-up due date during restore.
  const localDateTime = value.slice(0, 19)
  if (
    value.startsWith("0000-") ||
    new Date(`${localDateTime}Z`).toISOString().slice(0, 19) !== localDateTime
  )
    return fail("Backup contains an invalid date.")
  return new Date(value).toISOString()
}
const nullableTimestamp = (value: unknown) => (value === null ? null : timestamp(value))
const unique = <T>(values: T[], getLabel: (value: T) => string): T[] => {
  if (new Set(values.map(getLabel)).size !== values.length)
    fail("Backup contains duplicate labels.")
  return values
}
const vocabulary = (value: unknown): BackupVocabulary => {
  const v = object(value)
  return {
    label: label(v.label),
    timeCreated: timestamp(v.timeCreated),
    timeModified: timestamp(v.timeModified),
  }
}

// Preserve future preference keys, but reject prototype keys, excessive nesting,
// and values JSONB cannot represent before calling the recursive merge.
const preferences = (value: unknown, depth = 0): unknown => {
  if (depth > 16) fail("Backup preferences are nested too deeply.")
  if (value === null || typeof value === "boolean") return value
  if (typeof value === "string") return validText(value) ? value : fail("Invalid preference text.")
  if (typeof value === "number")
    return Number.isFinite(value) ? value : fail("Invalid preference number.")
  if (Array.isArray(value)) return value.map((v) => preferences(v, depth + 1))
  return Object.fromEntries(
    Object.entries(object(value)).map(([key, v]) => {
      if (["__proto__", "constructor", "prototype"].includes(key) || !validText(key))
        fail("Backup contains an unsafe preference key.")
      return [key, preferences(v, depth + 1)]
    }),
  )
}

/** Validate the entire file before opening a write transaction. Never trust ids from a file. */
export const parseUserBackup = (value: unknown): UserBackup => {
  const b = object(value)
  if (b.format !== USER_BACKUP_FORMAT || b.version !== USER_BACKUP_VERSION) {
    fail("Unsupported backup format or version. Choose a jot.new backup file.")
  }
  let records = 0
  const count = (value: unknown) => {
    const items = array(value)
    records += items.length
    if (records > MAX_RECORDS) fail("Backup contains too many records (maximum 100,000).")
    return items
  }
  const workspaces = unique(
    count(b.workspaces).map((value): BackupWorkspace => {
      const w = object(value)
      const categories = unique(count(w.categories).map(vocabulary), (v) => v.label)
      const tags = unique(count(w.tags).map(vocabulary), (v) => v.label)
      const statuses = unique(
        count(w.statuses).map((value): BackupStatus => {
          const s = object(value)
          if (
            !Number.isInteger(s.position) ||
            Number(s.position) < 0 ||
            Number(s.position) > 2_147_483_647
          )
            fail("Invalid status position.")
          return { ...vocabulary(s), position: Number(s.position) }
        }),
        (v) => v.label,
      )
      const categoryLabels = new Set(categories.map((v) => v.label))
      const tagLabels = new Set(tags.map((v) => v.label))
      const statusLabels = new Set(statuses.map((v) => v.label))
      const refs = (value: unknown, available: Set<string>) =>
        unique(
          array(value).map((v) => {
            const result = label(v)
            if (!available.has(result)) fail("A note refers to vocabulary outside its workspace.")
            return result
          }),
          (v) => v,
        )
      const notes = count(w.notes).map((value): BackupNote => {
        const n = object(value)
        if (
          n.description !== null &&
          (typeof n.description !== "string" || !validText(n.description))
        )
          fail("Invalid note text.")
        const status = n.status === null ? null : label(n.status)
        if (status !== null && !statusLabels.has(status))
          fail("A note refers to an unknown status.")
        return {
          description: n.description as string | null,
          categories: refs(n.categories, categoryLabels),
          status,
          tags: refs(n.tags, tagLabels),
          timeDue: nullableTimestamp(n.timeDue),
          timeRemind: nullableTimestamp(n.timeRemind),
          timeCreated: timestamp(n.timeCreated),
          timeModified: timestamp(n.timeModified),
        }
      })
      return { ...vocabulary(w), categories, statuses, tags, notes }
    }),
    (w) => w.label,
  )
  if (workspaces.length === 0) fail("Backup must contain at least one workspace.")
  const activeWorkspaceLabel =
    b.activeWorkspaceLabel === null ? null : label(b.activeWorkspaceLabel)
  if (activeWorkspaceLabel !== null && !workspaces.some((w) => w.label === activeWorkspaceLabel))
    fail("Backup active workspace does not exist.")
  const prefs = preferences(object(b.preferences)) as UserPreferences
  if (prefs.notesApp !== undefined) {
    object(prefs.notesApp)
    // A database id from the old account is never portable.
    delete prefs.notesApp.currentWorkspaceId
  }
  return {
    format: USER_BACKUP_FORMAT,
    version: USER_BACKUP_VERSION,
    exportedAt: timestamp(b.exportedAt),
    preferences: prefs,
    activeWorkspaceLabel,
    workspaces,
  }
}
