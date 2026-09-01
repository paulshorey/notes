import type { NoteRecord } from "@lib/db-notes"
import { noteToFormState, type NoteFormState } from "@/types/notes"
import { serializeNoteDraft } from "@/lib/noteDraft"
import {
  createEmptyOpenNotesState,
  isEmptyDraft,
  type OpenNoteEntry,
  type OpenNoteKey,
  type OpenNotesState,
} from "@/stores/openNotes"

/**
 * Deliberately separate from `notes-app-cache-v1` in `notesCache.ts`.
 *
 * That cache holds a discardable copy of server data: it expires itself after
 * 14 days and is wiped whenever a session restore fails. Open notes hold
 * *unsaved user text*, so either behavior would destroy work. The two also have
 * opposite write patterns — the cache rewrites wholesale on every list fetch,
 * while this changes as the user types — so sharing one blob would put each on
 * the other's hot path.
 */
const STORAGE_KEY = "notes-open-notes-v1"

/**
 * Clean entries older than this are dropped on load; they cost nothing to
 * reopen from the server. Dirty entries never expire — unsaved text does not
 * go stale.
 */
const CLEAN_ENTRY_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000

interface PersistedEntry {
  key: OpenNoteKey
  noteId: number | null
  baseTimeModified: string | null
  form: NoteFormState
  savedSignature: string | null
  categoryInputValue: string
  pendingTagLabels: string[]
  openedAt: number
  lastActivatedAt: number
}

export interface OpenNotesSnapshot {
  schemaVersion: 1
  userId: number
  activeKey: OpenNoteKey | null
  backStack: OpenNoteKey[]
  nextDraftSequence: number
  entries: PersistedEntry[]
  savedAt: number
}

const isBrowser = () => typeof window !== "undefined"

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const isPersistedEntry = (value: unknown): value is PersistedEntry => {
  if (!isObject(value)) return false
  if (typeof value.key !== "string") return false
  if (value.noteId !== null && !Number.isInteger(value.noteId)) return false
  if (!isObject(value.form)) return false
  if (typeof value.form.description !== "string") return false
  if (!Array.isArray(value.form.selectedTagIds)) return false
  if (!Array.isArray(value.pendingTagLabels)) return false
  return true
}

const isSnapshot = (value: unknown): value is OpenNotesSnapshot => {
  if (!isObject(value)) return false
  if (value.schemaVersion !== 1) return false
  if (typeof value.userId !== "number" || !Number.isInteger(value.userId)) return false
  if (!Array.isArray(value.entries)) return false
  if (!Array.isArray(value.backStack)) return false
  if (typeof value.nextDraftSequence !== "number") return false
  if (typeof value.savedAt !== "number" || !Number.isFinite(value.savedAt)) return false
  return value.entries.every(isPersistedEntry)
}

/**
 * Drops `editorSessionId` (restarts at 0 on a fresh page), `revealText` (a
 * search highlight must not re-fire after a reload), `autofocus` (recomputed
 * from layout), and `saveStatus` (a persisted "saving" is a lie once the tab
 * is gone — it is recomputed from the signature).
 */
export const toSnapshot = (
  userId: number,
  state: OpenNotesState,
): OpenNotesSnapshot => ({
  schemaVersion: 1,
  userId,
  activeKey: state.activeKey,
  backStack: state.backStack,
  nextDraftSequence: state.nextDraftSequence,
  entries: state.openNotes.map((entry) => ({
    key: entry.key,
    noteId: entry.noteId,
    baseTimeModified: entry.baseTimeModified,
    form: entry.form,
    savedSignature: entry.savedSignature,
    categoryInputValue: entry.categoryInputValue,
    pendingTagLabels: entry.pendingTagLabels,
    openedAt: entry.openedAt,
    lastActivatedAt: entry.lastActivatedAt,
  })),
  savedAt: Date.now(),
})

export const readOpenNotesSnapshot = (expectedUserId: number): OpenNotesSnapshot | null => {
  if (!isBrowser()) return null

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null

    const parsed: unknown = JSON.parse(raw)
    if (!isSnapshot(parsed)) return null
    if (parsed.userId !== expectedUserId) return null

    return parsed
  } catch {
    return null
  }
}

/**
 * Read the snapshot regardless of which user wrote it, re-keyed to `userId`.
 *
 * Only for the anonymous-merge path, where the acting user id changes but the
 * notes themselves are reparented and keep their ids. Reconciliation repairs
 * the category and tag references, which the merge does remap.
 */
export const readOpenNotesSnapshotForAnyUser = (userId: number): OpenNotesSnapshot | null => {
  if (!isBrowser()) return null

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null

    const parsed: unknown = JSON.parse(raw)
    if (!isSnapshot(parsed)) return null

    return { ...parsed, userId }
  } catch {
    return null
  }
}

export const clearOpenNotesSnapshot = (): void => {
  if (!isBrowser()) return
  try {
    window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    // ignore
  }
}

const writeRaw = (snapshot: OpenNotesSnapshot) => {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot))
}

/**
 * Never silently drops a dirty entry. On a quota error it retries with only the
 * dirty entries, then with clean entries' text blanked (they reload from the
 * server anyway). Returns false only if even the dirty-only write failed.
 */
export const writeOpenNotesSnapshot = (
  userId: number,
  state: OpenNotesState,
  isDirty: (entry: OpenNoteEntry) => boolean,
): boolean => {
  if (!isBrowser()) return true

  const snapshot = toSnapshot(userId, state)

  try {
    writeRaw(snapshot)
    return true
  } catch {
    // Fall through to the reduced writes below.
  }

  const dirtyKeys = new Set(state.openNotes.filter(isDirty).map((entry) => entry.key))

  try {
    writeRaw({
      ...snapshot,
      entries: snapshot.entries.map((entry) =>
        dirtyKeys.has(entry.key) ? entry : { ...entry, form: { ...entry.form, description: "" } },
      ),
    })
    return true
  } catch {
    // Fall through to dirty-only.
  }

  try {
    writeRaw({
      ...snapshot,
      entries: snapshot.entries.filter((entry) => dirtyKeys.has(entry.key)),
    })
    return true
  } catch {
    return false
  }
}

export interface ReconcileResult {
  state: OpenNotesState
  /** Entries whose note was deleted elsewhere but still held unsaved text. */
  orphanedDraftCount: number
}

/**
 * Rebuild ring state from a snapshot against the notes that actually exist.
 *
 * Takes a lookup rather than an array so the whole-corpus assumption stays out
 * of this module. Idempotent: running it twice gives the same result as once,
 * which is what makes the cached-paint-then-fresh-load double pass safe.
 *
 * The invariant that matters: a change *this function* makes to a form must
 * never leave the entry looking dirty, or the autosave hook will immediately
 * push it back to the server. Every branch that rewrites a form recomputes
 * `savedSignature` alongside it.
 */
export const reconcileOpenNotes = (
  snapshot: OpenNotesSnapshot,
  lookupNote: (noteId: number) => NoteRecord | undefined,
  options: {
    now?: number
    categoryExists?: (categoryId: number) => boolean
    tagExists?: (tagId: number) => boolean
    fallbackCategoryId?: number | null
  } = {},
): ReconcileResult => {
  const now = options.now ?? Date.now()
  const categoryExists = options.categoryExists ?? (() => true)
  const tagExists = options.tagExists ?? (() => true)

  const entries: OpenNoteEntry[] = []
  let orphanedDraftCount = 0
  let nextDraftSequence = snapshot.nextDraftSequence

  for (const persisted of snapshot.entries) {
    const base: OpenNoteEntry = {
      key: persisted.key,
      noteId: persisted.noteId,
      baseTimeModified: persisted.baseTimeModified ?? null,
      form: persisted.form,
      savedSignature: persisted.savedSignature ?? null,
      saveStatus: "idle",
      editorSessionId: 0,
      categoryInputValue: persisted.categoryInputValue ?? "",
      pendingTagLabels: persisted.pendingTagLabels ?? [],
      revealText: null,
      autofocus: false,
      openedAt: persisted.openedAt ?? now,
      lastActivatedAt: persisted.lastActivatedAt ?? now,
    }

    const dirty = serializeNoteDraft(base.noteId, base.form) !== base.savedSignature

    if (base.noteId === null) {
      // A never-saved draft is worth restoring only if it has content.
      if (!isEmptyDraft(base)) entries.push(base)
      continue
    }

    const record = lookupNote(base.noteId)

    if (!record) {
      if (!dirty) continue

      // Deleted elsewhere while this entry held unsaved text. Keeping the text
      // as a fresh draft can resurrect a note the user deliberately removed,
      // but the alternative is destroying words they typed and never saw
      // saved, so the text wins and the caller surfaces a message.
      orphanedDraftCount += 1
      entries.push({
        ...base,
        key: `draft:${nextDraftSequence}`,
        noteId: null,
        baseTimeModified: null,
        savedSignature: null,
      })
      nextDraftSequence += 1
      continue
    }

    if (!dirty) {
      if (now - base.lastActivatedAt > CLEAN_ENTRY_MAX_AGE_MS) continue

      // Clean, so the server copy wins. Recompute the signature from the form
      // we just adopted, otherwise the entry loads dirty and autosaves the
      // server's own data straight back at it.
      const form = noteToFormState(record)
      entries.push({
        ...base,
        form,
        baseTimeModified: record.timeModified,
        savedSignature: serializeNoteDraft(record.id, form),
        categoryInputValue: record.category.label,
      })
      continue
    }

    entries.push(base)
  }

  // Repair references to categories and tags that no longer exist. Same rule:
  // this is not a user edit, so the signature moves with the form.
  const repaired = entries.map((entry) => {
    const categoryOk =
      entry.form.selectedCategoryId !== null && categoryExists(entry.form.selectedCategoryId)
    const validTagIds = entry.form.selectedTagIds.filter(tagExists)

    if (categoryOk && validTagIds.length === entry.form.selectedTagIds.length) {
      return entry
    }

    const form: NoteFormState = {
      ...entry.form,
      selectedCategoryId: categoryOk
        ? entry.form.selectedCategoryId
        : (options.fallbackCategoryId ?? null),
      selectedTagIds: validTagIds,
    }
    const wasDirty = serializeNoteDraft(entry.noteId, entry.form) !== entry.savedSignature

    return {
      ...entry,
      form,
      savedSignature: wasDirty ? entry.savedSignature : serializeNoteDraft(entry.noteId, form),
    }
  })

  const keys = new Set(repaired.map((entry) => entry.key))
  const activeKey =
    snapshot.activeKey !== null && keys.has(snapshot.activeKey)
      ? snapshot.activeKey
      : (repaired[0]?.key ?? null)

  return {
    state: {
      ...createEmptyOpenNotesState(),
      openNotes: repaired,
      activeKey,
      backStack: snapshot.backStack.filter((key) => keys.has(key) && key !== activeKey),
      nextDraftSequence,
    },
    orphanedDraftCount,
  }
}
