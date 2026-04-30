import { create } from "zustand"

type State = {
  /**
   * Whether the notes results column is visible. On mobile this controls the
   * sliding panel; on desktop it controls the resizable results column.
   */
  resultsListVisible: boolean
  /**
   * Category filter currently selected in the notes results footer.
   * Null means all categories are visible.
   */
  selectedCategoryId: number | null
  /**
   * Category the user explicitly opened in the notes results column, in
   * addition to the category currently selected in the note form.
   */
  manuallyExpandedCategoryId: number | null
  /**
   * Tag filter currently selected in the notes results footer.
   * Null means all tags are visible.
   */
  selectedTagId: number | null
  /**
   * Query used by the notes results search field.
   */
  searchQuery: string
}

type Actions = {
  resetDefaultState: () => void
  setResultsListVisible: (visible: boolean | ((current: boolean) => boolean)) => void
  setSelectedCategoryId: (categoryId: number | null) => void
  setManuallyExpandedCategoryId: (categoryId: number | null) => void
  setSelectedTagId: (tagId: number | null) => void
  setSearchQuery: (query: string) => void
}

export type NotesAppStore = State & Actions

const defaultState: State = {
  resultsListVisible: true,
  selectedCategoryId: null,
  manuallyExpandedCategoryId: null,
  selectedTagId: null,
  searchQuery: "",
}

export const useNotesAppStore = create<NotesAppStore>((set) => ({
  ...defaultState,
  resetDefaultState: () => {
    set(defaultState)
  },
  setResultsListVisible: (visible) => {
    set((current) => ({
      resultsListVisible:
        typeof visible === "function" ? visible(current.resultsListVisible) : visible,
    }))
  },
  setSelectedCategoryId: (categoryId) => {
    set({ selectedCategoryId: categoryId })
  },
  setManuallyExpandedCategoryId: (categoryId) => {
    set({ manuallyExpandedCategoryId: categoryId })
  },
  setSelectedTagId: (tagId) => {
    set({ selectedTagId: tagId })
  },
  setSearchQuery: (query) => {
    set({ searchQuery: query })
  },
}))
