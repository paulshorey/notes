import type { TextCaptureFormState } from "@/types/items"
import {
  isEmptyDraft,
  type OpenItemEntry,
  type OpenItemKey,
  type OpenItemsState,
} from "@/stores/openItems"

/**
 * The slice of a detached save that persistence and the exit flush need.
 * Keep this free of React so the merge and keepalive rules can be unit-tested.
 */
export interface DetachedSaveSnapshot {
  itemId: number | null
  form: TextCaptureFormState
  savedSignature: string | null
}

export interface ExitFlushItem {
  key: OpenItemKey
  itemId: number | null
  form: TextCaptureFormState
}

/**
 * Dirty ring entries that must land before the acting session changes.
 *
 * A new draft starts with `savedSignature: null`, so the untouched editor can
 * be technically dirty even though it contains
 * nothing to persist. Trying to save that slot returns false and would block
 * sign-in, sign-up, and sign-out. Started drafts remain included — even when
 * they have no workspace and cannot save — so the caller still refuses to replace
 * the session rather than lose their content.
 */
export const collectSessionFlushEntries = (
  openItems: OpenItemEntry[],
  isDirty: (entry: OpenItemEntry) => boolean,
): OpenItemEntry[] => openItems.filter((entry) => isDirty(entry) && !isEmptyDraft(entry))

/**
 * Fold detached dirty notes back into ring state for a localStorage write.
 *
 * Eviction removes them from `openItems`, so a snapshot of the ring alone
 * would drop the very text the exit path claims to recover. Entries already
 * in the ring win — they are the live draft.
 */
export const stateWithDetachedSaves = (
  state: OpenItemsState,
  detached: Iterable<[OpenItemKey, DetachedSaveSnapshot]>,
  now = Date.now(),
): OpenItemsState => {
  const existing = new Set(state.openItems.map((entry) => entry.key))
  const extras: OpenItemEntry[] = []

  for (const [key, save] of detached) {
    if (existing.has(key)) continue
    extras.push({
      key,
      itemId: save.itemId,
      baseTimeModified: null,
      form: save.form,
      savedSignature: save.savedSignature,
      saveStatus: "idle",
      editorSessionId: 0,
      categoryInputValue: "",
      pendingTagLabels: [],
      revealText: null,
      autofocus: false,
      openedAt: now,
      lastActivatedAt: now,
    })
  }

  if (extras.length === 0) return state
  return { ...state, openItems: [...state.openItems, ...extras] }
}

export const collectExitFlushItems = (
  openItems: OpenItemEntry[],
  detached: Iterable<[OpenItemKey, DetachedSaveSnapshot]>,
  isDirty: (entry: OpenItemEntry) => boolean,
  isSaveable: (form: TextCaptureFormState) => boolean,
): ExitFlushItem[] => {
  const seen = new Set<OpenItemKey>()
  const items: ExitFlushItem[] = []

  for (const entry of openItems) {
    if (!isSaveable(entry.form) || !isDirty(entry)) continue
    seen.add(entry.key)
    items.push({ key: entry.key, itemId: entry.itemId, form: entry.form })
  }

  for (const [key, save] of detached) {
    if (seen.has(key) || !isSaveable(save.form)) continue
    items.push({ key, itemId: save.itemId, form: save.form })
  }

  return items
}

/**
 * Keepalive requests the dying page can fire. Never-saved drafts (`itemId`
 * null) are excluded: a POST that the page cannot wait for races a reload,
 * which would POST again from the dirty snapshot and create a duplicate note.
 * Those drafts recover from localStorage on the next visit.
 */
export const selectKeepaliveExitItems = (
  items: ExitFlushItem[],
  alreadySent: ReadonlySet<OpenItemKey>,
): ExitFlushItem[] => items.filter((item) => item.itemId !== null && !alreadySent.has(item.key))
