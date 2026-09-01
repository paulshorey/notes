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

export const OPEN_NOTES_SCHEMA_VERSION = 2

/**
 * Clean entries older than this are dropped on load; they cost nothing to
 * reopen from the server. Dirty entries never expire — unsaved text does not
 * go stale.
 */
const CLEAN_ENTRY_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000

/** A v1 form, before `selectedCategoryId` became `selectedGroupId`. */
interface LegacyNoteFormState extends Omit<NoteFormState, "selectedGroupId"> {
  selectedCategoryId?: number | null
}

interface PersistedEntry {
  key: OpenNoteKey
  noteId: number | null
  baseTimeModified: string | null
  form: NoteFormState
  savedSignature: string | null
  groupInputValue: string
  pendingTagLabels: string[]
  openedAt: number
  lastActivatedAt: number
}

export interface OpenNotesSnapshot {
  schemaVersion: 1 | 2
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

/**
 * Accepts v1 as well as v2. Rejecting an older version here would not degrade
 * gracefully: the caller reads `null` as "nothing to restore", so a version
 * bump alone would silently discard every unsaved draft in every browser on the
 * first load after deploy, with no error anywhere. `upgradeSnapshot` migrates
 * instead.
 */
const isSnapshot = (value: unknown): value is OpenNotesSnapshot => {
  if (!isObject(value)) return false
  if (value.schemaVersion !== 1 && value.schemaVersion !== 2) return false
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
  schemaVersion: OPEN_NOTES_SCHEMA_VERSION,
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
    groupInputValue: entry.groupInputValue,
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
 * Bring a v1 snapshot forward to v2.
 *
 * Two things have to happen together. The form's `selectedCategoryId` becomes
 * the `selectedGroupId` of that category's seeded group, and `savedSignature`
 * is recomputed for every entry that was clean — a v1 signature contains
 * `categoryId` and can never match a v2 one, so leaving it would mark every
 * restored note dirty and fire a save storm on the first load after deploy.
 *
 * Entries that were already dirty keep their old signature, because "dirty"
 * is what they were and any non-matching value preserves that.
 */
export const upgradeSnapshot = (
  snapshot: OpenNotesSnapshot,
  defaultGroupForCategory: ((categoryId: number) => number | undefined) | undefined,
): OpenNotesSnapshot => {
  if (snapshot.schemaVersion === OPEN_NOTES_SCHEMA_VERSION) return snapshot

  const entries = snapshot.entries.map((persisted) => {
    const legacyForm = persisted.form as unknown as LegacyNoteFormState
    const legacyCategoryId = legacyForm.selectedCategoryId ?? null

    const selectedGroupId =
      legacyCategoryId === null
        ? null
        : (defaultGroupForCategory?.(legacyCategoryId) ?? null)

    const form: NoteFormState = {
      ...(persisted.form as NoteFormState),
      selectedGroupId,
    }
    delete (form as Partial<LegacyNoteFormState>).selectedCategoryId

    const wasClean =
      persisted.savedSignature !== null &&
      persisted.savedSignature ===
        JSON.stringify({
          noteId: persisted.noteId,
          categoryId: legacyCategoryId,
          tagIds: [...legacyForm.selectedTagIds].sort((left, right) => left - right),
          description: legacyForm.description,
          timeDue: legacyForm.dueExpanded ? legacyForm.timeDue : null,
          timeRemind: legacyForm.remindExpanded ? legacyForm.timeRemind : null,
        })

    return {
      ...persisted,
      form,
      savedSignature: wasClean
        ? serializeNoteDraft(persisted.noteId, form)
        : persisted.savedSignature,
    }
  })

  return { ...snapshot, schemaVersion: OPEN_NOTES_SCHEMA_VERSION, entries }
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
    groupExists?: (groupId: number) => boolean
    tagExists?: (tagId: number) => boolean
    fallbackGroupId?: number | null
    /**
     * v1 stored a flat category id. The migration creates one group under every
     * category, so this mapping is total; without it an upgraded draft would
     * land on the fallback group and lose its placement.
     */
    defaultGroupForCategory?: (categoryId: number) => number | undefined
    /** Group labels live in the taxonomy tree, which this module does not hold. */
    groupLabel?: (groupId: number) => string | undefined
  } = {},
): ReconcileResult => {
  const now = options.now ?? Date.now()
  const groupExists = options.groupExists ?? (() => true)
  const tagExists = options.tagExists ?? (() => true)
  const upgraded = upgradeSnapshot(snapshot, options.defaultGroupForCategory)
  snapshot = upgraded

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
      groupInputValue: persisted.groupInputValue ?? "",
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
        groupInputValue: options.groupLabel?.(record.groupId) ?? base.groupInputValue,
      })
      continue
    }

    entries.push(base)
  }

  // Repair references to groups and tags that no longer exist. Same rule:
  // this is not a user edit, so the signature moves with the form.
  const repaired = entries.map((entry) => {
    const groupOk = entry.form.selectedGroupId !== null && groupExists(entry.form.selectedGroupId)
    const validTagIds = entry.form.selectedTagIds.filter(tagExists)

    if (groupOk && validTagIds.length === entry.form.selectedTagIds.length) {
      return entry
    }

    const form: NoteFormState = {
      ...entry.form,
      selectedGroupId: groupOk
        ? entry.form.selectedGroupId
        : (options.fallbackGroupId ?? null),
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
