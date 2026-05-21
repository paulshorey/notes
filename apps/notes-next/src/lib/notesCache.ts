import type {
  CategoryRecord,
  NoteRecord,
  TagRecord,
  UserSummary,
} from "@lib/db-marketing"

/**
 * Local snapshot of the data that `NotesApp` shows on startup.
 *
 * Keeping a copy in `localStorage` lets the app render immediately on the next
 * launch (instead of blocking on a network round-trip to restore the session),
 * and then refresh in the background. This is the "stale-while-revalidate"
 * pattern, scoped to the notes app data.
 */
export interface NotesCacheSnapshot {
  schemaVersion: 1
  userId: number
  user: UserSummary
  notes: NoteRecord[]
  categories: CategoryRecord[]
  tags: TagRecord[]
  savedAt: number
}

const CACHE_STORAGE_KEY = "notes-app-cache-v1"
// Treat the snapshot as missing once it's this old. This bounds how stale the
// first paint can be if the user has been offline for a long time, while still
// covering the common "open the app daily" case.
const CACHE_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000

const isBrowser = () => typeof window !== "undefined"

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const isSnapshot = (value: unknown): value is NotesCacheSnapshot => {
  if (!isObject(value)) return false
  if (value.schemaVersion !== 1) return false
  if (typeof value.userId !== "number" || !Number.isInteger(value.userId)) return false
  if (!isObject(value.user)) return false
  if (!Array.isArray(value.notes)) return false
  if (!Array.isArray(value.categories)) return false
  if (!Array.isArray(value.tags)) return false
  if (typeof value.savedAt !== "number" || !Number.isFinite(value.savedAt)) return false
  return true
}

export const readNotesCache = (expectedUserId: number): NotesCacheSnapshot | null => {
  if (!isBrowser()) return null

  try {
    const raw = window.localStorage.getItem(CACHE_STORAGE_KEY)
    if (!raw) return null

    const parsed: unknown = JSON.parse(raw)
    if (!isSnapshot(parsed)) return null
    if (parsed.userId !== expectedUserId) return null
    if (Date.now() - parsed.savedAt > CACHE_MAX_AGE_MS) return null

    return parsed
  } catch {
    return null
  }
}

export const writeNotesCache = (
  snapshot: Omit<NotesCacheSnapshot, "schemaVersion" | "savedAt">,
): void => {
  if (!isBrowser()) return

  try {
    const payload: NotesCacheSnapshot = {
      schemaVersion: 1,
      ...snapshot,
      savedAt: Date.now(),
    }
    window.localStorage.setItem(CACHE_STORAGE_KEY, JSON.stringify(payload))
  } catch {
    // Quota or serialization errors are non-fatal; the next launch just falls
    // back to the slow path.
  }
}

type CacheListField = "notes" | "categories" | "tags"

type CacheListValue<K extends CacheListField> = K extends "notes"
  ? NoteRecord[]
  : K extends "categories"
    ? CategoryRecord[]
    : TagRecord[]

/**
 * Update a single list inside the cached snapshot without rewriting the whole
 * thing. Used by `loadNotes` / `loadCategories` / `loadTags` so each successful
 * fetch keeps the persisted snapshot fresh.
 *
 * Silently no-ops when there is no existing snapshot, or when the snapshot
 * belongs to a different user.
 */
export const updateNotesCacheList = <K extends CacheListField>(
  userId: number,
  field: K,
  value: CacheListValue<K>,
): void => {
  if (!isBrowser()) return

  try {
    const raw = window.localStorage.getItem(CACHE_STORAGE_KEY)
    if (!raw) return

    const parsed: unknown = JSON.parse(raw)
    if (!isSnapshot(parsed)) return
    if (parsed.userId !== userId) return

    const next: NotesCacheSnapshot = {
      ...parsed,
      [field]: value,
      savedAt: Date.now(),
    }
    window.localStorage.setItem(CACHE_STORAGE_KEY, JSON.stringify(next))
  } catch {
    // ignore
  }
}

export const updateNotesCacheUser = (userId: number, user: UserSummary): void => {
  if (!isBrowser()) return

  try {
    const raw = window.localStorage.getItem(CACHE_STORAGE_KEY)
    if (!raw) return

    const parsed: unknown = JSON.parse(raw)
    if (!isSnapshot(parsed)) return
    if (parsed.userId !== userId) return

    const next: NotesCacheSnapshot = {
      ...parsed,
      user,
      savedAt: Date.now(),
    }
    window.localStorage.setItem(CACHE_STORAGE_KEY, JSON.stringify(next))
  } catch {
    // ignore
  }
}

export const clearNotesCache = (): void => {
  if (!isBrowser()) return

  try {
    window.localStorage.removeItem(CACHE_STORAGE_KEY)
  } catch {
    // ignore
  }
}
