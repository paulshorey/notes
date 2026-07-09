import { create } from "zustand"
import {
  createDefaultNoteForm,
  type NoteFormState,
  type NoteSaveStatus,
} from "@/types/notes"

type State = {
  /**
   * Whether the notes results column is visible. On mobile this controls the
   * sliding panel; on desktop it controls the resizable results column.
   */
  resultsListVisible: boolean
  /**
   * Category currently expanded in the notes results accordion.
   * Only one category can be expanded at a time; null means all collapsed.
   * Independent of the active note form category (which only affects color).
   */
  manuallyExpandedCategoryId: number | null
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
   * Current note editor draft. Description/due fields stay in memory only; the
   * category/tag selections are mirrored into the URL by the page container.
   */
  noteForm: NoteFormState
  /**
   * Note currently open for editing. Null means the editor is preparing a new note.
   */
  editingNoteId: number | null
  /**
   * Persistence status of the note currently open in the editor. Drives the
   * header save indicator and lets navigation know whether the in-memory draft
   * still needs to be flushed to the server.
   */
  noteSaveStatus: NoteSaveStatus
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
  /**
   * Whether the markdown editor should auto-focus on the next mount.
   * Set to false on mobile when opening a note from the results list so the
   * keyboard does not appear immediately — the user opens the note to read it
   * first and taps the editor to start typing.
   */
  editorAutofocus: boolean
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
  setNoteSaveStatus: (status: NoteSaveStatus) => void
  bumpDescriptionEditorSessionId: () => void
  setPendingTagLabels: (
    labels: string[] | ((current: string[]) => string[]),
  ) => void
  setCategoryInputValue: (value: string) => void
  setEditorAutofocus: (autofocus: boolean) => void
}

export type NotesAppStore = State & Actions

const defaultState: State = {
  resultsListVisible: true,
  manuallyExpandedCategoryId: null,
  selectedTagId: null,
  searchQuery: "",
  noteForm: createDefaultNoteForm(),
  editingNoteId: null,
  noteSaveStatus: "idle",
  descriptionEditorSessionId: 0,
  pendingTagLabels: [],
  categoryInputValue: "",
  editorAutofocus: true,
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
  setNoteSaveStatus: (status) => {
    set((current) =>
      current.noteSaveStatus === status ? current : { noteSaveStatus: status },
    )
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
  setEditorAutofocus: (autofocus) => {
    set({ editorAutofocus: autofocus })
  },
}))
