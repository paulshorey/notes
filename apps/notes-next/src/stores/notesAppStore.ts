import { create } from "zustand"
import { createDefaultNoteForm, type NoteFormState } from "@/types/notes"

type State = {
  /**
   * Whether the notes results column is visible. On mobile this controls the
   * sliding panel; on desktop it controls the resizable results column.
   */
  resultsListVisible: boolean
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
  /**
   * Current note editor draft. Description/due fields stay in memory only.
   */
  noteForm: NoteFormState
  /**
   * Note currently open for editing. Null means the editor is preparing a new note.
   */
  editingNoteId: number | null
  /**
   * Monotonic id used to reset the markdown editor when switching notes/drafts.
   */
  descriptionEditorSessionId: number
  /**
   * Labels that have been entered into the form but are still being created.
   */
  pendingTagLabels: string[]
  /**
   * Search/create value in the category picker input.
   */
  categoryInputValue: string
}

type Actions = {
  resetDefaultState: () => void
  setResultsListVisible: (visible: boolean | ((current: boolean) => boolean)) => void
  setManuallyExpandedCategoryId: (categoryId: number | null) => void
  setSelectedTagId: (tagId: number | null) => void
  setSearchQuery: (query: string) => void
  setNoteForm: (
    form:
      | NoteFormState
      | ((current: NoteFormState) => NoteFormState),
  ) => void
  setEditingNoteId: (noteId: number | null) => void
  bumpDescriptionEditorSessionId: () => void
  setPendingTagLabels: (
    labels: string[] | ((current: string[]) => string[]),
  ) => void
  setCategoryInputValue: (value: string) => void
}

export type NotesAppStore = State & Actions

const defaultState: State = {
  resultsListVisible: true,
  manuallyExpandedCategoryId: null,
  selectedTagId: null,
  searchQuery: "",
  noteForm: createDefaultNoteForm(),
  editingNoteId: null,
  descriptionEditorSessionId: 0,
  pendingTagLabels: [],
  categoryInputValue: "",
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
  setManuallyExpandedCategoryId: (categoryId) => {
    set({ manuallyExpandedCategoryId: categoryId })
  },
  setSelectedTagId: (tagId) => {
    set({ selectedTagId: tagId })
  },
  setSearchQuery: (query) => {
    set({ searchQuery: query })
  },
  setNoteForm: (form) => {
    set((current) => ({
      noteForm: typeof form === "function" ? form(current.noteForm) : form,
    }))
  },
  setEditingNoteId: (noteId) => {
    set({ editingNoteId: noteId })
  },
  bumpDescriptionEditorSessionId: () => {
    set((current) => ({
      descriptionEditorSessionId: current.descriptionEditorSessionId + 1,
    }))
  },
  setPendingTagLabels: (labels) => {
    set((current) => ({
      pendingTagLabels:
        typeof labels === "function" ? labels(current.pendingTagLabels) : labels,
    }))
  },
  setCategoryInputValue: (value) => {
    set({ categoryInputValue: value })
  },
}))
