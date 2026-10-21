import type { ItemRecord } from "@lib/db-items"
import { itemToFormState, type TextCaptureFormState } from "@/types/items"
import { serializeItemDraft } from "@/lib/itemDraft"
import {
  createEmptyOpenItemsState,
  isEmptyDraft,
  type OpenItemEntry,
  type OpenItemKey,
  type OpenItemsState,
} from "@/stores/openItems"

/**
 * Deliberately separate from `items-app-cache-v3` in `itemsCache.ts`.
 *
 * That cache holds a discardable copy of server data: it expires itself after
 * 14 days and can be replaced after a server refresh. Open items hold
 * *unsaved user text*, so either behavior would destroy work. The two also have
 * opposite write patterns — the cache rewrites wholesale on every list fetch,
 * while this changes as the user types — so sharing one blob would put each on
 * the other's hot path.
 */
const LEGACY_STORAGE_KEY = "notes-open-notes-v1"
const LEGACY_STORAGE_PREFIX = "notes-open-notes-v2"
const STORAGE_KEY_PREFIX = "items-open-items-v3"
const LAST_STORAGE_KEY = `${STORAGE_KEY_PREFIX}:last`

const storageKey = (userId: number, workspaceId: number) =>
  `${STORAGE_KEY_PREFIX}:${userId}:${workspaceId}`

/**
 * Clean entries older than this are dropped on load; they cost nothing to
 * reopen from the server. Dirty entries never expire — unsaved text does not
 * go stale.
 */
const CLEAN_ENTRY_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000

interface PersistedEntry {
  key: OpenItemKey
  itemId: number | null
  baseTimeModified: string | null
  form: TextCaptureFormState
  savedSignature: string | null
  categoryInputValue: string
  pendingTagLabels: string[]
  openedAt: number
  lastActivatedAt: number
}

export interface OpenItemsSnapshot {
  schemaVersion: 3
  userId: number
  workspaceId: number
  activeKey: OpenItemKey | null
  backStack: OpenItemKey[]
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
  if (value.itemId !== null && !Number.isInteger(value.itemId)) return false
  if (!isObject(value.form)) return false
  if (typeof value.form.description !== "string") return false
  if (!Array.isArray(value.form.selectedTagIds)) return false
  if (
    !Array.isArray(value.form.selectedCategoryIds) &&
    !Number.isInteger(value.form.selectedCategoryId) &&
    value.form.selectedCategoryId !== null
  )
    return false
  if (!Array.isArray(value.pendingTagLabels)) return false
  return true
}

export type StoredOpenItemsSnapshot = Omit<OpenItemsSnapshot, "schemaVersion" | "workspaceId"> & {
  schemaVersion: 1 | 2 | 3
  workspaceId?: number
}

const isSnapshot = (value: unknown): value is StoredOpenItemsSnapshot => {
  if (!isObject(value)) return false
  if (value.schemaVersion !== 1 && value.schemaVersion !== 2 && value.schemaVersion !== 3)
    return false
  if (typeof value.userId !== "number" || !Number.isInteger(value.userId)) return false
  if (
    value.workspaceId !== undefined &&
    (typeof value.workspaceId !== "number" || !Number.isInteger(value.workspaceId))
  )
    return false
  if (!Array.isArray(value.entries)) return false
  if (!Array.isArray(value.backStack)) return false
  if (typeof value.nextDraftSequence !== "number") return false
  if (typeof value.savedAt !== "number" || !Number.isFinite(value.savedAt)) return false
  return value.entries.every(isPersistedEntry)
}

/** Rename serialized addresses, never authored text or other user values. */
const decodeSnapshot = (raw: string): unknown => {
  const value: unknown = JSON.parse(raw)
  if (
    !isObject(value) ||
    ![1, 2].includes(Number(value.schemaVersion)) ||
    !Array.isArray(value.entries)
  )
    return value
  return {
    ...value,
    entries: value.entries.map((entry: unknown) => {
      if (!isObject(entry)) return entry
      const { noteId, ...rest } = entry
      let savedSignature = rest.savedSignature
      if (typeof savedSignature === "string") {
        try {
          const signature: unknown = JSON.parse(savedSignature)
          if (isObject(signature) && "noteId" in signature) {
            savedSignature = JSON.stringify(
              Object.fromEntries(
                Object.entries(signature).map(([key, data]) => [
                  key === "noteId" ? "itemId" : key,
                  data,
                ]),
              ),
            )
          }
        } catch {
          // Preserve an unrecognized signature as dirty rather than discarding it.
        }
      }
      return { ...rest, itemId: rest.itemId === undefined ? noteId : rest.itemId, savedSignature }
    }),
  }
}

/**
 * Drops `editorSessionId` (restarts at 0 on a fresh page), `revealText` (a
 * search highlight must not re-fire after a reload), `autofocus` (recomputed
 * from layout), and `saveStatus` (a persisted "saving" is a lie once the tab
 * is gone — it is recomputed from the signature).
 */
export const toSnapshot = (
  userId: number,
  workspaceId: number,
  state: OpenItemsState,
): OpenItemsSnapshot => ({
  schemaVersion: 3,
  userId,
  workspaceId,
  activeKey: state.activeKey,
  backStack: state.backStack,
  nextDraftSequence: state.nextDraftSequence,
  entries: state.openItems.map((entry) => ({
    key: entry.key,
    itemId: entry.itemId,
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

export const readOpenItemsSnapshot = (
  expectedUserId: number,
  expectedWorkspaceId: number,
): OpenItemsSnapshot | null => {
  if (!isBrowser()) return null

  try {
    const scopedRaw = window.localStorage.getItem(storageKey(expectedUserId, expectedWorkspaceId))
    const raw =
      scopedRaw ??
      window.localStorage.getItem(
        `${LEGACY_STORAGE_PREFIX}:${expectedUserId}:${expectedWorkspaceId}`,
      ) ??
      window.localStorage.getItem(LEGACY_STORAGE_KEY)
    if (!raw) return null

    const parsed = decodeSnapshot(raw)
    if (!isSnapshot(parsed)) return null
    if (parsed.userId !== expectedUserId) return null
    if (parsed.workspaceId !== undefined && parsed.workspaceId !== expectedWorkspaceId) return null

    const snapshot = upgradeOpenItemsSnapshot(parsed, expectedUserId, expectedWorkspaceId)
    if (scopedRaw === null) migrateLegacySnapshot(snapshot)
    return snapshot
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
export const readOpenItemsSnapshotForAnyUser = (
  userId: number,
  workspaceId: number,
): OpenItemsSnapshot | null => {
  if (!isBrowser()) return null

  try {
    const lastKey =
      window.localStorage.getItem(LAST_STORAGE_KEY) ??
      window.localStorage.getItem(`${LEGACY_STORAGE_PREFIX}:last`)
    const scopedRaw = lastKey ? window.localStorage.getItem(lastKey) : null
    const raw = scopedRaw ?? window.localStorage.getItem(LEGACY_STORAGE_KEY)
    if (!raw) return null

    const parsed = decodeSnapshot(raw)
    if (!isSnapshot(parsed)) return null

    const snapshot = upgradeOpenItemsSnapshot(parsed, userId, workspaceId)
    if (scopedRaw === null) migrateLegacySnapshot(snapshot)
    return snapshot
  } catch {
    return null
  }
}

export const clearOpenItemsSnapshot = (userId?: number, workspaceId?: number): void => {
  if (!isBrowser()) return
  try {
    if (userId !== undefined && workspaceId !== undefined) {
      window.localStorage.removeItem(storageKey(userId, workspaceId))
      window.localStorage.removeItem(`${LEGACY_STORAGE_PREFIX}:${userId}:${workspaceId}`)
      return
    }
    window.localStorage.removeItem(LEGACY_STORAGE_KEY)
    window.localStorage.removeItem(LAST_STORAGE_KEY)
    for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
      const key = window.localStorage.key(index)
      if (key?.startsWith(`${STORAGE_KEY_PREFIX}:`) || key?.startsWith(`${LEGACY_STORAGE_PREFIX}:`))
        window.localStorage.removeItem(key)
    }
  } catch {
    // ignore
  }
}

const writeRaw = (snapshot: OpenItemsSnapshot) => {
  const key = storageKey(snapshot.userId, snapshot.workspaceId)
  window.localStorage.setItem(key, JSON.stringify(snapshot))
  window.localStorage.setItem(LAST_STORAGE_KEY, key)
}

const migrateLegacySnapshot = (snapshot: OpenItemsSnapshot) => {
  try {
    writeRaw(snapshot)
    window.localStorage.removeItem(LEGACY_STORAGE_KEY)
  } catch {
    // Keep the legacy copy when migration cannot be persisted. Returning the
    // upgraded snapshot still restores the draft for this session without
    // risking the only durable copy of unsaved text.
  }
}

export const upgradeOpenItemsSnapshot = (
  snapshot: StoredOpenItemsSnapshot,
  userId: number,
  workspaceId: number,
): OpenItemsSnapshot => ({
  ...snapshot,
  schemaVersion: 3,
  userId,
  workspaceId,
  entries: snapshot.entries.map((entry) => {
    const legacy = entry.form as TextCaptureFormState & { selectedCategoryId?: number | null }
    if (Array.isArray(legacy.selectedCategoryIds)) return entry
    const form: TextCaptureFormState = {
      ...legacy,
      selectedCategoryIds: legacy.selectedCategoryId == null ? [] : [legacy.selectedCategoryId],
      selectedStatusId: null,
    }
    const wasClean =
      entry.savedSignature ===
      JSON.stringify({
        itemId: entry.itemId,
        categoryId: legacy.selectedCategoryId ?? null,
        tagIds: [...legacy.selectedTagIds].sort((a, b) => a - b),
        description: legacy.description,
        timeDue: legacy.dueExpanded ? legacy.timeDue : null,
        timeRemind: legacy.remindExpanded ? legacy.timeRemind : null,
      })
    return {
      ...entry,
      form,
      savedSignature: wasClean ? serializeItemDraft(entry.itemId, form) : entry.savedSignature,
    }
  }),
})

/**
 * Never silently drops a dirty entry. On a quota error it retries with only the
 * dirty entries, then with clean entries' text blanked (they reload from the
 * server anyway). Returns false only if even the dirty-only write failed.
 */
export const writeOpenItemsSnapshot = (
  userId: number,
  workspaceId: number,
  state: OpenItemsState,
  isDirty: (entry: OpenItemEntry) => boolean,
): boolean => {
  if (!isBrowser()) return true

  const snapshot = toSnapshot(userId, workspaceId, state)

  try {
    writeRaw(snapshot)
    return true
  } catch {
    // Fall through to the reduced writes below.
  }

  const dirtyKeys = new Set(state.openItems.filter(isDirty).map((entry) => entry.key))

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
  state: OpenItemsState
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
export const reconcileOpenItems = (
  snapshot: OpenItemsSnapshot,
  lookupItem: (itemId: number) => ItemRecord | undefined,
  options: {
    now?: number
    categoryExists?: (categoryId: number) => boolean
    statusExists?: (statusId: number) => boolean
    tagExists?: (tagId: number) => boolean
  } = {},
): ReconcileResult => {
  const now = options.now ?? Date.now()
  const categoryExists = options.categoryExists ?? (() => true)
  const statusExists = options.statusExists ?? (() => true)
  const tagExists = options.tagExists ?? (() => true)

  const entries: OpenItemEntry[] = []
  let orphanedDraftCount = 0
  let nextDraftSequence = snapshot.nextDraftSequence

  for (const persisted of snapshot.entries) {
    const base: OpenItemEntry = {
      key: persisted.key,
      itemId: persisted.itemId,
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

    const dirty = serializeItemDraft(base.itemId, base.form) !== base.savedSignature

    if (base.itemId === null) {
      // A never-saved draft is worth restoring only if it has content.
      if (!isEmptyDraft(base)) entries.push(base)
      continue
    }

    const record = lookupItem(base.itemId)

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
        itemId: null,
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
      const form = itemToFormState(record)
      entries.push({
        ...base,
        form,
        baseTimeModified: record.timeModified,
        savedSignature: serializeItemDraft(record.id, form),
        categoryInputValue: record.categories.map((category) => category.label).join(", "),
      })
      continue
    }

    entries.push(base)
  }

  // Repair references to categories and tags that no longer exist. Same rule:
  // this is not a user edit, so the signature moves with the form.
  const repaired = entries.map((entry) => {
    const validCategoryIds = entry.form.selectedCategoryIds.filter(categoryExists)
    const validStatusId =
      entry.form.selectedStatusId === null || statusExists(entry.form.selectedStatusId)
        ? entry.form.selectedStatusId
        : null
    const validTagIds = entry.form.selectedTagIds.filter(tagExists)

    if (
      validCategoryIds.length === entry.form.selectedCategoryIds.length &&
      validStatusId === entry.form.selectedStatusId &&
      validTagIds.length === entry.form.selectedTagIds.length
    ) {
      return entry
    }

    const form: TextCaptureFormState = {
      ...entry.form,
      selectedCategoryIds: validCategoryIds,
      selectedStatusId: validStatusId,
      selectedTagIds: validTagIds,
    }
    const wasDirty = serializeItemDraft(entry.itemId, entry.form) !== entry.savedSignature

    return {
      ...entry,
      form,
      savedSignature: wasDirty ? entry.savedSignature : serializeItemDraft(entry.itemId, form),
    }
  })

  const keys = new Set(repaired.map((entry) => entry.key))
  const activeKey =
    snapshot.activeKey !== null && keys.has(snapshot.activeKey)
      ? snapshot.activeKey
      : (repaired[0]?.key ?? null)

  return {
    state: {
      ...createEmptyOpenItemsState(),
      openItems: repaired,
      activeKey,
      backStack: snapshot.backStack.filter((key) => keys.has(key) && key !== activeKey),
      nextDraftSequence,
    },
    orphanedDraftCount,
  }
}
