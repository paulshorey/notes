import { create } from "zustand"
import type { ItemRecord } from "@lib/db-items"
import type { ItemGroupTarget } from "@lib/db-items/contracts/item-group-actions"
import type { ItemKindKey } from "@lib/db-items/contracts/item-kinds"
import type { TextCaptureFormState, ItemSaveStatus } from "@/types/items"
import { DEFAULT_VIEW_KIND } from "@/views/registry"
import {
  activate as activateEntryIn,
  claimActiveEntry,
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
  itemGroupDialog: {
    target: ItemGroupTarget
    intent: "rename" | "delete" | "move"
    label: string
  } | null
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
  /**
   * The view on screen and whether it always shows the editor. An entry the user
   * opens is handed to this view; see `claimActiveEntry`.
   */
  activeViewKind: ItemKindKey
  activeViewAlwaysShowsEditor: boolean
  /**
   * Called with the active entry just before another view takes it over, so the save
   * engine can send edits still pending under the view they were made in.
   */
  beforeViewClaim: ((entry: OpenItemEntry) => void) | null
}

type Actions = {
  setItemGroupDialog: (dialog: State["itemGroupDialog"]) => void
  setBackupOperation: (operation: "download" | "restore" | null) => void
  resetDefaultState: () => void
  setBeforeViewClaim: (handler: State["beforeViewClaim"]) => void
  /** Set the view on screen. A view that always shows the editor takes the active entry. */
  setActiveView: (kind: ItemKindKey, alwaysShowsEditor: boolean) => void
  setResultsListVisible: (visible: boolean | ((current: boolean) => boolean)) => void
  setSelectedTagId: (tagId: number | null) => void
  setSearchQuery: (query: string) => void
  /** Lowering the cap evicts immediately; the dropped entries are returned. */
  setMaxOpenItems: (value: number) => OpenItemEntry[]
  openExistingItem: (item: ItemRecord) => OpenItemEntry[]
  openNewDraft: (options?: {
    categoryId?: number | null
    subcategoryId?: number | null
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
  itemGroupDialog: null,
  backupOperation: null,
  ...createEmptyOpenItemsState(),
  resultsListVisible: true,
  selectedTagId: null,
  searchQuery: "",
  maxOpenItems: MAX_OPEN_ITEMS_DEFAULT,
  activeViewKind: DEFAULT_VIEW_KIND,
  activeViewAlwaysShowsEditor: true,
  beforeViewClaim: null,
}

/**
 * The ring with its active entry handed to the view on screen. `opened` says the user
 * opened or activated the entry; otherwise only a view that always shows the editor
 * takes it. Edits pending under the entry's previous view are sent first.
 */
const claimForActiveView = (state: State, opened = false): OpenItemsState => {
  const ring = openItemsSlice(state)
  if (!opened && !state.activeViewAlwaysShowsEditor) return ring
  const active = getActiveEntry(ring)
  if (!active || active.view === state.activeViewKind) return ring
  state.beforeViewClaim?.(active)
  return claimActiveEntry(ring, state.activeViewKind)
}

const openItemsSlice = (state: State): OpenItemsState => ({
  openItems: state.openItems,
  activeKey: state.activeKey,
  backStack: state.backStack,
  nextDraftSequence: state.nextDraftSequence,
})

export const useItemsAppStore = create<ItemsAppStore>((set, get) => ({
  ...defaultState,
  setItemGroupDialog: (itemGroupDialog) => set({ itemGroupDialog }),
  setBackupOperation: (backupOperation) => set({ backupOperation }),
  // The view on screen and the engine's hook outlive a session reset.
  resetDefaultState: () => {
    set((current) => ({
      ...defaultState,
      ...createEmptyOpenItemsState(),
      activeViewKind: current.activeViewKind,
      activeViewAlwaysShowsEditor: current.activeViewAlwaysShowsEditor,
      beforeViewClaim: current.beforeViewClaim,
    }))
  },
  setBeforeViewClaim: (beforeViewClaim) => set({ beforeViewClaim }),
  setActiveView: (kind, alwaysShowsEditor) => {
    set({ activeViewKind: kind, activeViewAlwaysShowsEditor: alwaysShowsEditor })
    if (alwaysShowsEditor) set(claimForActiveView(get()))
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
  // Opening or activating an entry is the user choosing to work on it here, so the
  // view on screen takes it over. An entry that becomes active some other way (its
  // neighbor closed, the ring was restored) is taken over only by a view that then
  // shows it in its editor.
  openExistingItem: (item) => {
    const { state, removed } = openExistingItemIn(openItemsSlice(get()), item, get().maxOpenItems)
    set(claimForActiveView({ ...get(), ...state }, true))
    return removed
  },
  openNewDraft: (options = {}) => {
    const { state, removed } = openNewDraftIn(openItemsSlice(get()), options, get().maxOpenItems)
    set(claimForActiveView({ ...get(), ...state }, true))
    return removed
  },
  activateEntry: (key) => {
    const state = activateEntryIn(openItemsSlice(get()), key, get().maxOpenItems)
    set(claimForActiveView({ ...get(), ...state }, true))
  },
  closeEntry: (key) => {
    const { state, removed } = closeEntryIn(openItemsSlice(get()), key, get().maxOpenItems)
    set(claimForActiveView({ ...get(), ...state }))
    return removed
  },
  closeEntriesForItem: (itemId) => {
    const { state, removed } = closeEntriesForItemIn(
      openItemsSlice(get()),
      itemId,
      get().maxOpenItems,
    )
    set(claimForActiveView({ ...get(), ...state }))
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
    set(claimForActiveView({ ...get(), ...next }))
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
