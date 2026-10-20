import { create } from "zustand"
import type { ItemRecord } from "@lib/db-items"
import type { TextCaptureFormState, ItemSaveStatus } from "@/types/items"
import {
  activate as activateEntryIn,
  clampMaxOpenItems,
  closeEntriesForItem as closeEntriesForItemIn,
  closeEntry as closeEntryIn,
  createEmptyOpenItemsState,
  evictToCap,
  getActiveEntry,
  openExistingItem as openExistingItemIn,
  openNewDraft as openNewDraftIn,
  patchEntry as patchEntryIn,
  patchEntryForm,
  MAX_OPEN_ITEMS_DEFAULT,
  type ItemRef,
  type OpenItemEntry,
  type OpenItemKey,
  type OpenItemsState,
} from "./openItems"

type State = OpenItemsState & {
  backupOperation: "download" | "restore" | null
  /**
   * Whether the navigation drawer is open on mobile/tablet. Desktop keeps
   * the resizable results column visible.
   */
  resultsListVisible: boolean
  /**
   * Tag filter currently selected in the notes results footer.
   * Null means all tags are visible.
   */
  selectedTagId: number | null
  /**
   * Query used by the app header search field.
   */
  searchQuery: string
  /**
   * How many notes stay open at once. Mirrors the `notesApp.maxOpenNotes`
   * user preference; kept here so the ring actions do not need it threaded
   * through every call site.
   */
  maxOpenItems: number
}

type Actions = {
  setBackupOperation: (operation: "download" | "restore" | null) => void
  resetDefaultState: () => void
  setResultsListVisible: (visible: boolean | ((current: boolean) => boolean)) => void
  setSelectedTagId: (tagId: number | null) => void
  setSearchQuery: (query: string) => void
  /** Lowering the cap evicts immediately; the dropped entries are returned. */
  setMaxOpenItems: (value: number) => OpenItemEntry[]
  openExistingItem: (item: ItemRecord) => OpenItemEntry[]
  openNewDraft: (options?: {
    categoryIds?: number[]
    statusId?: number | null
    tagIds?: number[]
    categoryLabel?: string
  }) => OpenItemEntry[]
  activateEntry: (key: OpenItemKey) => void
  closeEntry: (key: OpenItemKey) => OpenItemEntry[]
  closeEntriesForItem: (itemId: ItemRef) => OpenItemEntry[]
  patchEntry: (
    key: OpenItemKey,
    patch: Partial<OpenItemEntry> | ((entry: OpenItemEntry) => Partial<OpenItemEntry>),
  ) => void
  patchEntryForm: (
    key: OpenItemKey,
    form: TextCaptureFormState | ((current: TextCaptureFormState) => TextCaptureFormState),
  ) => void
  patchEveryEntry: (patch: (entry: OpenItemEntry) => Partial<OpenItemEntry>) => void
  replaceOpenItems: (next: OpenItemsState) => void
}

export type ItemsAppStore = State & Actions

const defaultState: State = {
  backupOperation: null,
  ...createEmptyOpenItemsState(),
  resultsListVisible: true,
  selectedTagId: null,
  searchQuery: "",
  maxOpenItems: MAX_OPEN_ITEMS_DEFAULT,
}

const openItemsSlice = (state: State): OpenItemsState => ({
  openItems: state.openItems,
  activeKey: state.activeKey,
  backStack: state.backStack,
  nextDraftSequence: state.nextDraftSequence,
})

export const useItemsAppStore = create<ItemsAppStore>((set, get) => ({
  ...defaultState,
  setBackupOperation: (backupOperation) => set({ backupOperation }),
  resetDefaultState: () => {
    set({ ...defaultState, ...createEmptyOpenItemsState() })
  },
  setResultsListVisible: (visible) => {
    set((current) => ({
      resultsListVisible:
        typeof visible === "function" ? visible(current.resultsListVisible) : visible,
    }))
  },
  setSelectedTagId: (tagId) => {
    set({ selectedTagId: tagId })
  },
  setSearchQuery: (query) => {
    set({ searchQuery: query })
  },
  setMaxOpenItems: (value) => {
    const maxOpenItems = clampMaxOpenItems(value)
    const { state, removed } = evictToCap(openItemsSlice(get()), maxOpenItems)
    set({ ...state, maxOpenItems })
    return removed
  },
  openExistingItem: (item) => {
    const { state, removed } = openExistingItemIn(openItemsSlice(get()), item, get().maxOpenItems)
    set(state)
    return removed
  },
  openNewDraft: (options = {}) => {
    const { state, removed } = openNewDraftIn(openItemsSlice(get()), options, get().maxOpenItems)
    set(state)
    return removed
  },
  activateEntry: (key) => {
    set(activateEntryIn(openItemsSlice(get()), key, get().maxOpenItems))
  },
  closeEntry: (key) => {
    const { state, removed } = closeEntryIn(openItemsSlice(get()), key, get().maxOpenItems)
    set(state)
    return removed
  },
  closeEntriesForItem: (itemId) => {
    const { state, removed } = closeEntriesForItemIn(
      openItemsSlice(get()),
      itemId,
      get().maxOpenItems,
    )
    set(state)
    return removed
  },
  patchEntry: (key, patch) => {
    set(patchEntryIn(openItemsSlice(get()), key, patch))
  },
  patchEntryForm: (key, form) => {
    set(patchEntryForm(openItemsSlice(get()), key, form))
  },
  patchEveryEntry: (patch) => {
    set((current) => ({
      openItems: current.openItems.map((entry) => ({ ...entry, ...patch(entry) })),
    }))
  },
  replaceOpenItems: (next) => {
    set(next)
  },
}))

// Every selector below returns an existing reference or a primitive. A
// selector that builds a new object or array each call hands
// useSyncExternalStore a fresh snapshot on every render and loops forever —
// derive that kind of value with useMemo in the component instead.

export const selectActiveEntry = (state: ItemsAppStore): OpenItemEntry | null =>
  getActiveEntry(state)

export const selectActiveSaveStatus = (state: ItemsAppStore): ItemSaveStatus =>
  getActiveEntry(state)?.saveStatus ?? "idle"

/**
 * True when a note the user is not looking at is mid-save or failed to save,
 * so the recent button can badge. A background entry sitting at `unsaved` is
 * normal and transient, so it does not count.
 */
export const selectHasBackgroundSaveActivity = (state: ItemsAppStore): boolean =>
  state.openItems.some(
    (entry) =>
      entry.key !== state.activeKey &&
      (entry.saveStatus === "saving" || entry.saveStatus === "error"),
  )
