import {
  isEmptyDraft,
  type OpenItemEntry,
  type OpenItemKey,
  type OpenItemsState,
} from "@/stores/openItems"

export type DetachedSaveSnapshot = Pick<
  OpenItemEntry,
  "itemId" | "uid" | "form" | "savedSignature" | "baseTimeModified" | "view"
>

/** What a view's save rule looks at: the entry's view and its draft. */
type SaveCandidate = Pick<OpenItemEntry, "view" | "form" | "itemId">

export type ExitFlushItem = Pick<
  OpenItemEntry,
  "key" | "itemId" | "uid" | "form" | "baseTimeModified"
>

/**
 * Dirty ring entries that must land before the session, the workspace, or a group
 * changes underneath them.
 *
 * Only an entry with a save to send is worth waiting for. An untouched slot, or a
 * draft its view would not start an item from, is dirty by signature but sends
 * nothing, so a save attempt returns false. Waiting on one would block sign-in,
 * sign-up, sign-out, a workspace switch, a backup, or a group action over nothing that
 * can be lost. A stored item always has a save to send: an update, or its deletion
 * when it was emptied.
 *
 * An entry with a save to send stays included even when something else prevents the
 * save, such as a missing workspace or a failed request, so the caller refuses to move
 * on rather than lose what the user wrote.
 */
export const collectSessionFlushEntries = (
  openItems: OpenItemEntry[],
  isDirty: (entry: OpenItemEntry) => boolean,
  canSave: (entry: SaveCandidate) => boolean,
): OpenItemEntry[] =>
  openItems.filter((entry) => isDirty(entry) && !isEmptyDraft(entry) && canSave(entry))

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
      uid: save.uid,
      baseTimeModified: save.baseTimeModified,
      form: save.form,
      view: save.view,
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
  isSaveable: (entry: SaveCandidate) => boolean,
): ExitFlushItem[] => {
  const seen = new Set<OpenItemKey>()
  const items: ExitFlushItem[] = []

  for (const entry of openItems) {
    if (!isSaveable(entry) || !isDirty(entry)) continue
    seen.add(entry.key)
    items.push({
      key: entry.key,
      itemId: entry.itemId,
      uid: entry.uid,
      form: entry.form,
      baseTimeModified: entry.baseTimeModified,
    })
  }

  for (const [key, save] of detached) {
    if (seen.has(key) || !isSaveable(save)) continue
    items.push({
      key,
      itemId: save.itemId,
      uid: save.uid,
      form: save.form,
      baseTimeModified: save.baseTimeModified,
    })
  }

  return items
}

/**
 * Keepalive requests the dying page can fire, each key once. Never-saved drafts are
 * included: their create carries the entry's uid, so if the page reloads and sends the
 * draft again from its snapshot, the server answers with the item this request stored.
 */
export const selectKeepaliveExitItems = (
  items: ExitFlushItem[],
  alreadySent: ReadonlySet<OpenItemKey>,
): ExitFlushItem[] => items.filter((item) => !alreadySent.has(item.key))
