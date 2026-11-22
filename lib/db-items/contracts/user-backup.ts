import type {
  BackupCategory,
  BackupItem,
  BackupStatus,
  BackupVocabulary,
  BackupWorkspace,
  UserBackup,
  UserPreferences,
} from "./items-app"
import { UNCATEGORIZED_LABEL } from "./category-name"
import { hasItemContent, hasText } from "./item-capabilities"
import { normalizeTimeBlock, TimeBlockOrderError } from "./item-time"
import { isPublicUid } from "./public-uid"

export const USER_BACKUP_FORMAT = "jot.new-user-backup"
export const USER_BACKUP_VERSION = 4
/** Versions 1 and 2 list several categories per item and have no subcategories. */
const FLAT_CATEGORY_VERSIONS = [1, 2]
/** Version 3 has one category per item and no time blocks, which read as absent. */
const READABLE_VERSIONS = [...FLAT_CATEGORY_VERSIONS, 3, USER_BACKUP_VERSION]
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
/** An item's time block. A file from before time blocks names none. */
const timeBlock = (item: Record<string, unknown>) => {
  const optional = (value: unknown) => (value == null ? null : timestamp(value))
  try {
    return normalizeTimeBlock({
      timeStart: optional(item.timeStart),
      timeEnd: optional(item.timeEnd),
    })
  } catch (error) {
    if (error instanceof TimeBlockOrderError) return fail("Backup contains an invalid time block.")
    throw error
  }
}
/**
 * A record's uid, as an entry to spread into it. Files written before records had a
 * uid carry none, and the parsed record then has no uid either; restore assigns one.
 */
const optionalUid = (value: unknown): { uid?: string } => {
  if (value === undefined || value === null) return {}
  return isPublicUid(value) ? { uid: value } : fail("Backup contains an invalid uid.")
}
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

/**
 * Files written under earlier rules (versions 1 to 3) can hold an item with only a
 * status or a date, and a status on an item without text. Neither can be stored, so
 * the first is left out and the second loses its status. A version 4 file follows the
 * current rules, so an item like that is invalid and the file is refused.
 */
const holdsContent = (item: BackupItem) => hasItemContent({ ...item, statusId: null })
const hasUnsupportedStatus = (item: BackupItem) =>
  item.status !== null && !hasText(item.description)
const withoutUnsupportedState = (item: BackupItem): BackupItem =>
  hasUnsupportedStatus(item) ? { ...item, status: null } : item

/** Validate the entire file before opening a write transaction. Never trust ids from a file. */
export const parseUserBackup = (value: unknown): UserBackup => {
  const b = object(value)
  const flatCategories = FLAT_CATEGORY_VERSIONS.includes(b.version as number)
  if (b.format !== USER_BACKUP_FORMAT || !READABLE_VERSIONS.includes(b.version as number)) {
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
      const categories = unique(
        count(w.categories).map((value): BackupCategory => {
          const category = vocabulary(value)
          const subcategories = flatCategories
            ? []
            : unique(count(object(value).subcategories).map(vocabulary), (v) => v.label)
          return { ...category, subcategories }
        }),
        (v) => v.label,
      )
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
            if (!available.has(result)) fail("An item refers to vocabulary outside its workspace.")
            return result
          }),
          (v) => v,
        )
      // Version 1 used the text-client name. Normalize it once at the boundary.
      const items = count(b.version === 1 ? w.notes : w.items).map((value): BackupItem => {
        const n = object(value)
        if (
          n.description !== null &&
          (typeof n.description !== "string" || !validText(n.description))
        )
          fail("Invalid item text.")
        const status = n.status === null ? null : label(n.status)
        if (status !== null && !statusLabels.has(status))
          fail("An item refers to an unknown status.")
        // Validate every reference before converting the old fallback row. A file
        // with several categories per item files the item in the first one listed.
        const listed = flatCategories
          ? refs(n.categories, categoryLabels)
          : n.category === null
            ? []
            : refs([n.category], categoryLabels)
        const category = listed.find((name) => name !== UNCATEGORIZED_LABEL) ?? null
        const subcategory =
          flatCategories || n.subcategory === null || n.subcategory === undefined
            ? null
            : label(n.subcategory)
        if (
          subcategory !== null &&
          !categories
            .find((entry) => entry.label === category)
            ?.subcategories.some((entry) => entry.label === subcategory)
        )
          fail("An item refers to a subcategory outside its category.")
        return {
          ...optionalUid(n.uid),
          description: n.description as string | null,
          category,
          subcategory,
          status,
          tags: refs(n.tags, tagLabels),
          ...timeBlock(n),
          timeDue: nullableTimestamp(n.timeDue),
          timeRemind: nullableTimestamp(n.timeRemind),
          timeCreated: timestamp(n.timeCreated),
          timeModified: timestamp(n.timeModified),
        }
      })
      return {
        ...optionalUid(w.uid),
        ...vocabulary(w),
        categories: categories.filter((category) => category.label !== UNCATEGORIZED_LABEL),
        statuses,
        tags,
        items:
          b.version === USER_BACKUP_VERSION
            ? items.map((item) =>
                holdsContent(item) && !hasUnsupportedStatus(item)
                  ? item
                  : fail(
                      "An item holds neither text nor a time block, or has a status without text.",
                    ),
              )
            : items.filter(holdsContent).map(withoutUnsupportedState),
      }
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
