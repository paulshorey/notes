import { create } from "zustand"
import type { NoteRecord } from "@lib/db-notes"
import type { NoteFormState, NoteSaveStatus } from "@/types/notes"
import {
  activate as activateEntryIn,
  clampMaxOpenNotes,
  closeEntriesForNote as closeEntriesForNoteIn,
  closeEntry as closeEntryIn,
  createEmptyOpenNotesState,
  evictToCap,
  getActiveEntry,
  getBackTarget,
  goBack as goBackIn,
  openExistingNote as openExistingNoteIn,
  openNewDraft as openNewDraftIn,
  patchEntry as patchEntryIn,
  patchEntryForm,
  MAX_OPEN_NOTES_DEFAULT,
  type NoteRef,
  type OpenNoteEntry,
  type OpenNoteKey,
  type OpenNotesState,
} from "./openNotes"

type State = OpenNotesState & {
  /**
   * Whether the notes results column is visible. On mobile this controls the
   * sliding panel; on desktop it controls the resizable results column.
   */
  resultsListVisible: boolean
  /**
   * Category currently expanded in the notes results accordion.
   * Only one category can be expanded at a time; null means all collapsed.
   */
  expandedTaxonomyIds: number[]
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
  maxOpenNotes: number
}

type Actions = {
  resetDefaultState: () => void
  setResultsListVisible: (visible: boolean | ((current: boolean) => boolean)) => void
  toggleTaxonomyExpanded: (taxonomyId: number) => void
  setTaxonomyExpanded: (taxonomyId: number, expanded: boolean) => void
  setSelectedTagId: (tagId: number | null) => void
  setSearchQuery: (query: string) => void
  /** Lowering the cap evicts immediately; the dropped entries are returned. */
  setMaxOpenNotes: (value: number) => OpenNoteEntry[]
  openExistingNote: (note: NoteRecord, groupLabel?: string) => OpenNoteEntry[]
  openNewDraft: (options?: {
    groupId?: number | null
    tagIds?: number[]
    groupLabel?: string
  }) => OpenNoteEntry[]
  activateEntry: (key: OpenNoteKey) => void
  goBack: () => void
  closeEntry: (key: OpenNoteKey) => OpenNoteEntry[]
  closeEntriesForNote: (noteId: NoteRef) => OpenNoteEntry[]
  patchEntry: (
    key: OpenNoteKey,
    patch: Partial<OpenNoteEntry> | ((entry: OpenNoteEntry) => Partial<OpenNoteEntry>),
  ) => void
  patchEntryForm: (
    key: OpenNoteKey,
    form: NoteFormState | ((current: NoteFormState) => NoteFormState),
  ) => void
  patchEveryEntry: (
    patch: (entry: OpenNoteEntry) => Partial<OpenNoteEntry>,
  ) => void
  replaceOpenNotes: (next: OpenNotesState) => void
}

export type NotesAppStore = State & Actions

const defaultState: State = {
  ...createEmptyOpenNotesState(),
  resultsListVisible: true,
  expandedTaxonomyIds: [],
  selectedTagId: null,
  searchQuery: "",
  maxOpenNotes: MAX_OPEN_NOTES_DEFAULT,
}

const openNotesSlice = (state: State): OpenNotesState => ({
  openNotes: state.openNotes,
  activeKey: state.activeKey,
  backStack: state.backStack,
  nextDraftSequence: state.nextDraftSequence,
})

export const useNotesAppStore = create<NotesAppStore>((set, get) => ({
  ...defaultState,
  resetDefaultState: () => {
    set({ ...defaultState, ...createEmptyOpenNotesState() })
  },
  setResultsListVisible: (visible) => {
    set((current) => ({
      resultsListVisible:
        typeof visible === "function" ? visible(current.resultsListVisible) : visible,
    }))
  },
  toggleTaxonomyExpanded: (taxonomyId) => {
    const current = get().expandedTaxonomyIds
    set({
      expandedTaxonomyIds: current.includes(taxonomyId)
        ? current.filter((id) => id !== taxonomyId)
        : [...current, taxonomyId],
    })
  },
  setTaxonomyExpanded: (taxonomyId, expanded) => {
    const current = get().expandedTaxonomyIds
    if (current.includes(taxonomyId) === expanded) return
    set({
      expandedTaxonomyIds: expanded
        ? [...current, taxonomyId]
        : current.filter((id) => id !== taxonomyId),
    })
  },
  setSelectedTagId: (tagId) => {
    set({ selectedTagId: tagId })
  },
  setSearchQuery: (query) => {
    set({ searchQuery: query })
  },
  setMaxOpenNotes: (value) => {
    const maxOpenNotes = clampMaxOpenNotes(value)
    const { state, removed } = evictToCap(openNotesSlice(get()), maxOpenNotes)
    set({ ...state, maxOpenNotes })
    return removed
  },
  openExistingNote: (note, groupLabel = "") => {
    const { state, removed } = openExistingNoteIn(
      openNotesSlice(get()),
      note,
      groupLabel,
      get().maxOpenNotes,
    )
    set(state)
    return removed
  },
  openNewDraft: (options = {}) => {
    const { state, removed } = openNewDraftIn(openNotesSlice(get()), options, get().maxOpenNotes)
    set(state)
    return removed
  },
  activateEntry: (key) => {
    set(activateEntryIn(openNotesSlice(get()), key, get().maxOpenNotes))
  },
  goBack: () => {
    set(goBackIn(openNotesSlice(get())))
  },
  closeEntry: (key) => {
    const { state, removed } = closeEntryIn(openNotesSlice(get()), key, get().maxOpenNotes)
    set(state)
    return removed
  },
  closeEntriesForNote: (noteId) => {
    const { state, removed } = closeEntriesForNoteIn(
      openNotesSlice(get()),
      noteId,
      get().maxOpenNotes,
    )
    set(state)
    return removed
  },
  patchEntry: (key, patch) => {
    set(patchEntryIn(openNotesSlice(get()), key, patch))
  },
  patchEntryForm: (key, form) => {
    set(patchEntryForm(openNotesSlice(get()), key, form))
  },
  patchEveryEntry: (patch) => {
    set((current) => ({
      openNotes: current.openNotes.map((entry) => ({ ...entry, ...patch(entry) })),
    }))
  },
  replaceOpenNotes: (next) => {
    set(next)
  },
}))

// Every selector below returns an existing reference or a primitive. A
// selector that builds a new object or array each call hands
// useSyncExternalStore a fresh snapshot on every render and loops forever —
// derive that kind of value with useMemo in the component instead.

export const selectActiveEntry = (state: NotesAppStore): OpenNoteEntry | null =>
  getActiveEntry(state)

export const selectActiveSaveStatus = (state: NotesAppStore): NoteSaveStatus =>
  getActiveEntry(state)?.saveStatus ?? "idle"

export const selectBackTarget = (state: NotesAppStore): OpenNoteEntry | null =>
  getBackTarget(state)

/**
 * True when a note the user is not looking at is mid-save or failed to save,
 * so the recent button can badge. A background entry sitting at `unsaved` is
 * normal and transient, so it does not count.
 */
export const selectHasBackgroundSaveActivity = (state: NotesAppStore): boolean =>
  state.openNotes.some(
    (entry) =>
      entry.key !== state.activeKey &&
      (entry.saveStatus === "saving" || entry.saveStatus === "error"),
  )
