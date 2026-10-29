import type { ItemRecord } from "@lib/db-items"
import {
  createDefaultTextCaptureForm,
  itemToFormState,
  type TextCaptureFormState,
  type ItemSaveStatus,
} from "@/types/items"

/**
 * Stable identity for an open entry: `note:${id}` once persisted, `draft:${n}`
 * before that. Identity is deliberately not the note id, because a new note's
 * id changes from null to a real value on its first save and the editor is
 * keyed on this — remounting CodeMirror mid-typing would lose the cursor.
 */
export type OpenItemKey = string

/**
 * Where an entry is stored. An alias rather than a bare `number` so the shape
 * of an address is stated in one place.
 */
export type ItemRef = number

export interface OpenItemEntry {
  key: OpenItemKey
  /** null while this entry is a new note that has never been persisted. */
  itemId: ItemRef | null
  /**
   * `timeModified` of the record this entry was last loaded or saved from.
   * Nothing reads it yet; it is the base revision a conflict check would need,
   * and it is far cheaper to record now than to backfill later.
   */
  baseTimeModified: string | null
  /** Live in-memory draft. */
  form: TextCaptureFormState
  /** Signature of what was last successfully persisted, for the dirty check. */
  savedSignature: string | null
  saveStatus: ItemSaveStatus
  /** Bumped to force the editor to remount within the same entry. */
  editorSessionId: number
  categoryInputValue: string
  pendingTagLabels: string[]
  /** Search term to scroll to and highlight; cleared once it has fired. */
  revealText: string | null
  autofocus: boolean
  openedAt: number
  lastActivatedAt: number
}

export interface OpenItemsState {
  /** MRU-ordered; index 0 is the most recently activated entry. */
  openItems: OpenItemEntry[]
  activeKey: OpenItemKey | null
  /** Visit history, most recent last. Bounded to `cap * 2`. */
  backStack: OpenItemKey[]
  nextDraftSequence: number
}

export interface OpenItemsResult {
  state: OpenItemsState
  removed: OpenItemEntry[]
}

export const MAX_OPEN_ITEMS_DEFAULT = 10
export const MAX_OPEN_ITEMS_MIN = 1
export const MAX_OPEN_ITEMS_MAX = 25

export const clampMaxOpenItems = (value: number): number => {
  if (!Number.isFinite(value)) return MAX_OPEN_ITEMS_DEFAULT
  return Math.round(Math.min(Math.max(value, MAX_OPEN_ITEMS_MIN), MAX_OPEN_ITEMS_MAX))
}

export const itemEntryKey = (itemId: ItemRef): OpenItemKey => `note:${itemId}`

export const createEmptyOpenItemsState = (): OpenItemsState => ({
  openItems: [],
  activeKey: null,
  backStack: [],
  nextDraftSequence: 0,
})

export const findEntry = (state: OpenItemsState, key: OpenItemKey | null): OpenItemEntry | null =>
  key === null ? null : (state.openItems.find((entry) => entry.key === key) ?? null)

export const findEntryByItemId = (state: OpenItemsState, itemId: ItemRef): OpenItemEntry | null =>
  state.openItems.find((entry) => entry.itemId === itemId) ?? null

export const getActiveEntry = (state: OpenItemsState): OpenItemEntry | null =>
  findEntry(state, state.activeKey)

/**
 * The entry `goBack` would activate, or null when the stack has no survivors.
 * Used to label and disable the back button.
 */
export const getBackTarget = (state: OpenItemsState): OpenItemEntry | null => {
  for (let index = state.backStack.length - 1; index >= 0; index -= 1) {
    const entry = findEntry(state, state.backStack[index] ?? null)
    if (entry && entry.key !== state.activeKey) return entry
  }
  return null
}

export const isEntryDirty = (
  entry: OpenItemEntry,
  signature: (entry: OpenItemEntry) => string,
): boolean => signature(entry) !== entry.savedSignature

/**
 * Mirrors `newItemHasUserInput` in `TextCaptureForm`, inverted: an entry the user has
 * not put anything into. Used to skip creating redundant drafts and to discard
 * abandoned ones.
 */
export const isEmptyDraft = (entry: OpenItemEntry): boolean =>
  entry.itemId === null &&
  entry.form.description.trim() === "" &&
  entry.form.selectedTagIds.length === 0 &&
  entry.pendingTagLabels.length === 0 &&
  !entry.form.dueExpanded &&
  entry.form.timeDue === null &&
  !entry.form.remindExpanded &&
  entry.form.timeRemind === null

const createEntry = (
  key: OpenItemKey,
  values: Partial<OpenItemEntry> & { form: TextCaptureFormState },
): OpenItemEntry => {
  const now = Date.now()
  return {
    key,
    itemId: null,
    baseTimeModified: null,
    savedSignature: null,
    saveStatus: "idle",
    editorSessionId: 0,
    categoryInputValue: "",
    pendingTagLabels: [],
    revealText: null,
    autofocus: true,
    openedAt: now,
    lastActivatedAt: now,
    ...values,
  }
}

const boundBackStack = (backStack: OpenItemKey[], cap: number): OpenItemKey[] => {
  const limit = Math.max(cap, MAX_OPEN_ITEMS_MIN) * 2
  return backStack.length <= limit ? backStack : backStack.slice(backStack.length - limit)
}

/**
 * Promote `key` to index 0, record the outgoing entry on the back stack, and
 * make it active. Does not evict: callers that add an entry must activate
 * before evicting, since eviction protects whichever entry is active.
 */
export const activate = (
  state: OpenItemsState,
  key: OpenItemKey,
  cap: number = MAX_OPEN_ITEMS_DEFAULT,
): OpenItemsState => {
  const entry = findEntry(state, key)
  if (!entry) return state
  if (state.activeKey === key) return state

  // An untouched draft the user is walking away from is noise: it would sit in
  // the recent list forever and push real notes out of the ring. Nothing is
  // lost, since by definition it has no content.
  const outgoing = getActiveEntry(state)
  const discardOutgoing = outgoing !== null && isEmptyDraft(outgoing)

  const backStack =
    state.activeKey === null || discardOutgoing
      ? state.backStack
      : [...state.backStack, state.activeKey]

  const survivors = state.openItems.filter(
    (item) => item.key !== key && (!discardOutgoing || item.key !== outgoing.key),
  )

  // Invariant: the back stack holds where you have *been*, so it never
  // contains the entry you are on now.
  const prunedBackStack = backStack.filter(
    (item) => item !== key && (!discardOutgoing || item !== outgoing.key),
  )

  return {
    ...state,
    openItems: [{ ...entry, lastActivatedAt: Date.now() }, ...survivors],
    activeKey: key,
    backStack: boundBackStack(prunedBackStack, cap),
  }
}

/**
 * Drop least-recently-used entries until the cap is met. Only the active entry
 * is protected — protecting the back target too can make the cap unenforceable
 * when the back target is the only candidate, and `goBack` already skips keys
 * that no longer exist.
 */
export const evictToCap = (state: OpenItemsState, cap: number): OpenItemsResult => {
  const limit = Math.max(cap, MAX_OPEN_ITEMS_MIN)
  if (state.openItems.length <= limit) return { state, removed: [] }

  const kept = [...state.openItems]
  const removed: OpenItemEntry[] = []

  for (let index = kept.length - 1; index >= 0 && kept.length > limit; index -= 1) {
    const candidate = kept[index]
    if (!candidate || candidate.key === state.activeKey) continue
    kept.splice(index, 1)
    removed.push(candidate)
  }

  if (removed.length === 0) return { state, removed: [] }

  const removedKeys = new Set(removed.map((entry) => entry.key))
  return {
    state: {
      ...state,
      openItems: kept,
      backStack: state.backStack.filter((key) => !removedKeys.has(key)),
    },
    removed,
  }
}

const insertActivateEvict = (
  state: OpenItemsState,
  entry: OpenItemEntry,
  cap: number,
): OpenItemsResult => {
  const withEntry: OpenItemsState = {
    ...state,
    openItems: [entry, ...state.openItems],
  }
  // Order matters: activating first makes the incoming entry the protected one,
  // so the outgoing entry becomes the eviction candidate. Evicting first would
  // protect the outgoing entry and, at cap 1, leave nothing droppable.
  return evictToCap(activate(withEntry, entry.key, cap), cap)
}

export const openExistingItem = (
  state: OpenItemsState,
  item: ItemRecord,
  cap: number = MAX_OPEN_ITEMS_DEFAULT,
): OpenItemsResult => {
  const existing = findEntryByItemId(state, item.id)
  if (existing) {
    // Keep the in-memory draft; the entry is the source of truth while open.
    return { state: activate(state, existing.key, cap), removed: [] }
  }

  const form = itemToFormState(item)
  const entry = createEntry(itemEntryKey(item.id), {
    itemId: item.id,
    baseTimeModified: item.timeModified,
    form,
    categoryInputValue: item.categories.map((category) => category.label).join(", "),
  })

  return insertActivateEvict(state, entry, cap)
}

export const openNewDraft = (
  state: OpenItemsState,
  options: {
    categoryIds?: number[]
    statusId?: number | null
    tagIds?: number[]
    categoryLabel?: string
  } = {},
  cap: number = MAX_OPEN_ITEMS_DEFAULT,
): OpenItemsResult => {
  const active = getActiveEntry(state)

  // Reusing an untouched draft keeps repeated `+` presses from pushing real
  // notes out of the ring.
  if (active && isEmptyDraft(active)) {
    const reused: OpenItemEntry = {
      ...active,
      form: {
        ...active.form,
        selectedCategoryIds: options.categoryIds ?? [],
        selectedStatusId:
          options.statusId === undefined ? active.form.selectedStatusId : options.statusId,
        selectedTagIds: options.tagIds ?? active.form.selectedTagIds,
      },
      categoryInputValue: options.categoryLabel ?? "",
      autofocus: true,
      editorSessionId: active.editorSessionId + 1,
    }
    return {
      state: {
        ...state,
        openItems: state.openItems.map((entry) => (entry.key === active.key ? reused : entry)),
      },
      removed: [],
    }
  }

  const entry = createEntry(`draft:${state.nextDraftSequence}`, {
    form: {
      ...createDefaultTextCaptureForm(),
      selectedCategoryIds: options.categoryIds ?? [],
      selectedStatusId: options.statusId ?? null,
      selectedTagIds: options.tagIds ?? [],
    },
    categoryInputValue: options.categoryLabel ?? "",
  })

  return insertActivateEvict(
    { ...state, nextDraftSequence: state.nextDraftSequence + 1 },
    entry,
    cap,
  )
}

/**
 * Walk backwards through visit history rather than toggling between the two
 * most recent entries. Popping without pushing is what keeps the walk
 * monotonic: A → B → C, back, back lands on A rather than returning to C.
 */
export const goBack = (state: OpenItemsState): OpenItemsState => {
  const backStack = [...state.backStack]

  while (backStack.length > 0) {
    const key = backStack.pop()
    if (key === undefined || key === state.activeKey) continue

    const entry = findEntry(state, key)
    if (!entry) continue

    return {
      ...state,
      openItems: [
        { ...entry, lastActivatedAt: Date.now() },
        ...state.openItems.filter((item) => item.key !== key),
      ],
      activeKey: key,
      backStack,
    }
  }

  return backStack.length === state.backStack.length ? state : { ...state, backStack }
}

export const closeEntry = (
  state: OpenItemsState,
  key: OpenItemKey,
  cap: number = MAX_OPEN_ITEMS_DEFAULT,
): OpenItemsResult => {
  const entry = findEntry(state, key)
  if (!entry) return { state, removed: [] }

  const withoutEntry: OpenItemsState = {
    ...state,
    openItems: state.openItems.filter((item) => item.key !== key),
    backStack: state.backStack.filter((item) => item !== key),
  }

  if (state.activeKey !== key) {
    return { state: withoutEntry, removed: [entry] }
  }

  const orphaned: OpenItemsState = { ...withoutEntry, activeKey: null }
  const backTarget = getBackTarget(orphaned)
  const nextKey = backTarget?.key ?? orphaned.openItems[0]?.key ?? null

  if (nextKey === null) {
    const { state: withDraft } = openNewDraft(orphaned, {}, cap)
    return { state: withDraft, removed: [entry] }
  }

  return {
    state: {
      ...orphaned,
      activeKey: nextKey,
      openItems: [
        ...orphaned.openItems.filter((item) => item.key === nextKey),
        ...orphaned.openItems.filter((item) => item.key !== nextKey),
      ],
      backStack: orphaned.backStack.filter((item) => item !== nextKey),
    },
    removed: [entry],
  }
}

export const patchEntry = (
  state: OpenItemsState,
  key: OpenItemKey,
  patch: Partial<OpenItemEntry> | ((entry: OpenItemEntry) => Partial<OpenItemEntry>),
): OpenItemsState => {
  const index = state.openItems.findIndex((entry) => entry.key === key)
  if (index === -1) return state

  const current = state.openItems[index]
  if (!current) return state

  const resolved = typeof patch === "function" ? patch(current) : patch
  const next = { ...current, ...resolved }

  const openItems = [...state.openItems]
  openItems[index] = next
  return { ...state, openItems }
}

export const patchEntryForm = (
  state: OpenItemsState,
  key: OpenItemKey,
  form: TextCaptureFormState | ((current: TextCaptureFormState) => TextCaptureFormState),
): OpenItemsState =>
  patchEntry(state, key, (entry) => ({
    form: typeof form === "function" ? form(entry.form) : form,
  }))

/**
 * Drop every entry pointing at a note that no longer exists. Used after a
 * delete so a closed note cannot linger in the recent list.
 */
export const closeEntriesForItem = (
  state: OpenItemsState,
  itemId: ItemRef,
  cap: number = MAX_OPEN_ITEMS_DEFAULT,
): OpenItemsResult => {
  const entry = findEntryByItemId(state, itemId)
  if (!entry) return { state, removed: [] }
  return closeEntry(state, entry.key, cap)
}
