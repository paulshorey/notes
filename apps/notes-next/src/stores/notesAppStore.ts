import { create } from "zustand"

type State = {
  /**
   * Category filter currently selected in the notes results footer.
   * Null means all categories are visible.
   */
  selectedCategoryId: number | null
  /**
   * Tag filter currently selected in the notes results footer.
   * Null means all tags are visible.
   */
  selectedTagId: number | null
}

type Actions = {
  resetDefaultState: () => void
  setSelectedCategoryId: (categoryId: number | null) => void
  setSelectedTagId: (tagId: number | null) => void
}

export type NotesAppStore = State & Actions

const defaultState: State = {
  selectedCategoryId: null,
  selectedTagId: null,
}

export const useNotesAppStore = create<NotesAppStore>((set) => ({
  ...defaultState,
  resetDefaultState: () => {
    set(defaultState)
  },
  setSelectedCategoryId: (categoryId) => {
    set({ selectedCategoryId: categoryId })
  },
  setSelectedTagId: (tagId) => {
    set({ selectedTagId: tagId })
  },
}))
