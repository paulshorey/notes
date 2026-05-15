"use client"

import type {
  CategoriesResponse,
  CategoryRecord,
  CreateCategoryResponse,
  DeleteCategoryResponse,
  TagsResponse,
  TagRecord,
  CreateTagResponse,
  DeleteTagResponse,
  EmbeddingMaintenanceResponse,
  NoteResponse,
  NotesResponse,
  NoteRecord,
  SearchResponse,
  SessionResponse,
  UpdateCategoryResponse,
  UpdateTagResponse,
  UserPreferences,
  UserSummary,
} from "@lib/db-marketing"
import { NOTES_APP_SEARCH_MAX_RESULTS } from "@lib/db-marketing/notes-search-constants"
import {
  type CSSProperties,
  type FormEvent,
  type PointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { Text } from "@gravity-ui/uikit"
import { STORAGE_KEY } from "@/constants/notes"
import { getErrorMessage, readJson } from "@/lib/api"
import { normalizeLabel } from "@/lib/strings"
import {
  createDefaultNoteForm,
  noteToFormState,
  type EmbeddingMaintenanceMode,
  type NoteFormState,
} from "@/types/notes"
import { useAutoDismissStatus } from "@/hooks/useAutoDismissStatus"
import { useNotesAppStore } from "@/stores/notesAppStore"
import { FeedbackNotifications } from "./FeedbackNotifications"
import { LoginForm } from "./LoginForm"
import { NoteForm } from "./NoteForm"
import type { DisplayNoteItem } from "./NoteResultsList"
import { NotesHeader } from "./NotesHeader"
import { ResultsColumn, type CategoryNoteGroup, type TagNoteGroup } from "./ResultsColumn"
import { DeleteCategoryModal } from "./modals/DeleteCategoryModal"
import { DeleteTagModal } from "./modals/DeleteTagModal"
import { EditCategoryModal } from "./modals/EditCategoryModal"
import { EditTagModal } from "./modals/EditTagModal"
import styles from "./NotesApp.module.css"

const RESULTS_COLUMN_MIN_WIDTH = 222
const RESULTS_COLUMN_DEFAULT_WIDTH = RESULTS_COLUMN_MIN_WIDTH
const RESULTS_COLUMN_MAX_WIDTH = 720
const FORM_COLUMN_MIN_WIDTH = 333
const RESIZE_HANDLE_WIDTH = 8
const RESIZE_DRAG_THRESHOLD = 4
const MOBILE_RESULTS_MEDIA_QUERY = "(max-width: 720px)"
const MOBILE_RESULTS_TRANSITION_MS = 400
const NOTE_AUTOSAVE_DEBOUNCE_MS = 3000
const PREFERENCES_SAVE_DEBOUNCE_MS = 500
const DEFAULT_MARKDOWN_EDITOR_MODE = "wysiwyg"
const NOTE_URL_ID_PARAM = "id"
const NOTE_URL_CATEGORY_PARAM = "category"
const NOTE_URL_TAGS_PARAM = "tags"

type MarkdownEditorModePreference = "wysiwyg" | "markup"

interface NotesUrlSelection {
  hasState: boolean
  noteId: number | null
  categoryId: number | null
  tagIds: number[]
}

const isPreferencesObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const normalizeUserPreferences = (value: unknown): UserPreferences =>
  isPreferencesObject(value) ? (value as UserPreferences) : {}

const sortPreferenceValue = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(sortPreferenceValue)
  }

  if (!isPreferencesObject(value)) {
    return value
  }

  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nestedValue]) => [key, sortPreferenceValue(nestedValue)]),
  )
}

const serializeUserPreferences = (preferences: UserPreferences) =>
  JSON.stringify(sortPreferenceValue(preferences))

const clampStoredResultsColumnWidth = (width: number) =>
  Math.round(Math.min(Math.max(width, RESULTS_COLUMN_MIN_WIDTH), RESULTS_COLUMN_MAX_WIDTH))

const isMobileResultsLayout = () =>
  typeof window !== "undefined" && window.matchMedia(MOBILE_RESULTS_MEDIA_QUERY).matches

const isMarkdownEditorModePreference = (value: unknown): value is MarkdownEditorModePreference =>
  value === "wysiwyg" || value === "markup"

const parsePositiveInteger = (value: string | null) => {
  if (value === null || value.trim() === "") return null

  const parsed = Number.parseInt(value, 10)
  return Number.isInteger(parsed) && parsed > 0 && String(parsed) === value.trim() ? parsed : null
}

const readNotesUrlSelection = (): NotesUrlSelection => {
  if (typeof window === "undefined") {
    return { hasState: false, noteId: null, categoryId: null, tagIds: [] }
  }

  const params = new URLSearchParams(window.location.search)
  const rawTags = params.get(NOTE_URL_TAGS_PARAM)
  const tagIds =
    rawTags === null
      ? []
      : Array.from(
          new Set(
            rawTags
              .split(",")
              .map((value) => parsePositiveInteger(value))
              .filter((value): value is number => value !== null),
          ),
        )

  return {
    hasState:
      params.has(NOTE_URL_ID_PARAM) ||
      params.has(NOTE_URL_CATEGORY_PARAM) ||
      params.has(NOTE_URL_TAGS_PARAM),
    noteId: parsePositiveInteger(params.get(NOTE_URL_ID_PARAM)),
    categoryId: parsePositiveInteger(params.get(NOTE_URL_CATEGORY_PARAM)),
    tagIds,
  }
}

const writeNotesUrlSelection = ({
  noteId,
  categoryId,
  tagIds,
}: Omit<NotesUrlSelection, "hasState">) => {
  if (typeof window === "undefined") {
    return
  }

  const url = new URL(window.location.href)
  if (noteId === null) {
    url.searchParams.delete(NOTE_URL_ID_PARAM)
  } else {
    url.searchParams.set(NOTE_URL_ID_PARAM, String(noteId))
  }

  if (categoryId === null) {
    url.searchParams.delete(NOTE_URL_CATEGORY_PARAM)
  } else {
    url.searchParams.set(NOTE_URL_CATEGORY_PARAM, String(categoryId))
  }

  const nextTagIds = Array.from(new Set(tagIds)).filter((id) => Number.isInteger(id) && id > 0)
  if (nextTagIds.length === 0) {
    url.searchParams.delete(NOTE_URL_TAGS_PARAM)
  } else {
    url.searchParams.set(NOTE_URL_TAGS_PARAM, nextTagIds.join(","))
  }

  const nextPath = `${url.pathname}${url.search}${url.hash}`
  const currentPath = `${window.location.pathname}${window.location.search}${window.location.hash}`
  if (nextPath !== currentPath) {
    window.history.replaceState(window.history.state, "", nextPath)
  }
}

const getStoredMarkdownEditorMode = (preferences: UserPreferences) => {
  const notesAppPreferences = preferences.notesApp
  if (!isPreferencesObject(notesAppPreferences)) return null

  const mode = notesAppPreferences.markdownEditorMode
  return isMarkdownEditorModePreference(mode) ? mode : null
}

const getStoredResultsColumnWidth = (preferences: UserPreferences) => {
  const notesAppPreferences = preferences.notesApp
  if (!isPreferencesObject(notesAppPreferences)) return null

  const width = notesAppPreferences.resultsColumnWidth
  if (typeof width !== "number" || !Number.isFinite(width)) {
    return null
  }

  return clampStoredResultsColumnWidth(width)
}

const withResultsColumnWidthPreference = (
  preferences: UserPreferences,
  width: number,
): UserPreferences => ({
  ...preferences,
  notesApp: {
    ...(isPreferencesObject(preferences.notesApp) ? preferences.notesApp : {}),
    resultsColumnWidth: clampStoredResultsColumnWidth(width),
  },
})

const withMarkdownEditorModePreference = (
  preferences: UserPreferences,
  mode: MarkdownEditorModePreference,
): UserPreferences => ({
  ...preferences,
  notesApp: {
    ...(isPreferencesObject(preferences.notesApp) ? preferences.notesApp : {}),
    markdownEditorMode: mode,
  },
})

const getDefaultCategoryId = (categoryList: CategoryRecord[]) =>
  categoryList.length > 0 ? categoryList.reduce((a, b) => (a.id < b.id ? a : b)).id : null

const getTimeValue = (value: string | null | undefined) => {
  if (!value) return 0
  const time = new Date(value).getTime()
  return Number.isFinite(time) ? time : 0
}

const getNoteSortTime = (note: NoteRecord) => getTimeValue(note.timeModified)

const getGroupSortTime = (items: DisplayNoteItem[]) =>
  items.reduce((latest, { note }) => Math.max(latest, getNoteSortTime(note)), 0)

type NoteGroupSortRecord = CategoryRecord | TagRecord

const compareNoteGroups = <
  T extends { sortTime: number } & (
    | { category: NoteGroupSortRecord }
    | { tag: NoteGroupSortRecord }
  ),
>(
  left: T,
  right: T,
) => {
  const leftRecord = "category" in left ? left.category : left.tag
  const rightRecord = "category" in right ? right.category : right.tag

  return (
    right.sortTime - left.sortTime ||
    leftRecord.label.localeCompare(rightRecord.label, undefined, { sensitivity: "base" }) ||
    leftRecord.id - rightRecord.id
  )
}

const compareCategoryNoteGroups = (
  left: CategoryNoteGroup,
  right: CategoryNoteGroup,
  uncategorizedCategoryId: number | null,
) => {
  const leftIsEmptyUncategorized =
    uncategorizedCategoryId !== null &&
    left.category.id === uncategorizedCategoryId &&
    left.items.length === 0
  const rightIsEmptyUncategorized =
    uncategorizedCategoryId !== null &&
    right.category.id === uncategorizedCategoryId &&
    right.items.length === 0

  if (leftIsEmptyUncategorized !== rightIsEmptyUncategorized) {
    return leftIsEmptyUncategorized ? 1 : -1
  }

  return compareNoteGroups(left, right)
}

interface ResetNoteFormOptions {
  categoryList?: CategoryRecord[]
  selectedCategoryId?: number | null
  selectedTagIds?: number[]
}

type NoteSaveMode = "manual" | "autosave"

const snapshotNoteForm = (form: NoteFormState): NoteFormState => ({
  ...form,
  selectedTagIds: [...form.selectedTagIds],
})

const serializeNoteDraft = (noteId: number | null, form: NoteFormState) =>
  JSON.stringify({
    noteId,
    categoryId: form.selectedCategoryId,
    tagIds: [...form.selectedTagIds].sort((left, right) => left - right),
    description: form.description,
    timeDue: form.dueExpanded ? form.timeDue : null,
    timeRemind: form.remindExpanded ? form.timeRemind : null,
  })

const noteRequestBody = (form: NoteFormState) => ({
  categoryId: form.selectedCategoryId,
  tagIds: form.selectedTagIds,
  description: form.description,
  timeDue: form.dueExpanded ? form.timeDue : null,
  timeRemind: form.remindExpanded ? form.timeRemind : null,
})

const notePatchBody = (note: NoteRecord) => ({
  categoryId: note.category.id,
  tagIds: note.tags.map((tag) => tag.id),
  description: note.description ?? "",
  timeDue: note.timeDue,
  timeRemind: note.timeRemind,
})

export default function NotesApp() {
  const [identifier, setIdentifier] = useState("")
  const [user, setUser] = useState<UserSummary | null>(null)
  const [userPreferences, setUserPreferences] = useState<UserPreferences>({})
  const [notes, setNotes] = useState<NoteRecord[]>([])
  const [categories, setCategories] = useState<CategoryRecord[]>([])
  const [tags, setTags] = useState<TagRecord[]>([])
  const fallbackCategoryId = getDefaultCategoryId(categories)
  const {
    resultsListVisible,
    setResultsListVisible,
    selectedTagId,
    setSelectedTagId,
    searchQuery,
    setSearchQuery,
    noteForm,
    setNoteForm,
    editingNoteId,
    setEditingNoteId,
    descriptionEditorSessionId,
    bumpDescriptionEditorSessionId,
    pendingTagLabels,
    setPendingTagLabels,
    categoryInputValue,
    setCategoryInputValue,
    resetDefaultState: resetNotesAppStore,
  } = useNotesAppStore()
  const [searchResults, setSearchResults] = useState<SearchResponse["results"]>([])
  const [sessionLoading, setSessionLoading] = useState(true)
  const [notesUrlSelectionReady, setNotesUrlSelectionReady] = useState(false)
  const [notesLoading, setNotesLoading] = useState(false)
  const [searchLoading, setSearchLoading] = useState(false)
  const [authPending, setAuthPending] = useState(false)
  const [notePending, setNotePending] = useState(false)
  const [embeddingMaintenancePending, setEmbeddingMaintenancePending] =
    useState<EmbeddingMaintenanceMode | null>(null)
  const [createCategoryPending, setCreateCategoryPending] = useState(false)
  const [createTagPending, setCreateTagPending] = useState(false)
  const [deletingNoteId, setDeletingNoteId] = useState<number | null>(null)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [searchErrorMessage, setSearchErrorMessage] = useState<string | null>(null)
  const [editingCategory, setEditingCategory] = useState<CategoryRecord | null>(null)
  const [editCategoryLabel, setEditCategoryLabel] = useState("")
  const [editCategoryPending, setEditCategoryPending] = useState(false)
  const [deletingCategory, setDeletingCategory] = useState<CategoryRecord | null>(null)
  const [deleteCategoryPending, setDeleteCategoryPending] = useState(false)
  const [editingTag, setEditingTag] = useState<TagRecord | null>(null)
  const [editTagLabel, setEditTagLabel] = useState("")
  const [editTagPending, setEditTagPending] = useState(false)
  const [deletingTag, setDeletingTag] = useState<TagRecord | null>(null)
  const [deleteTagPending, setDeleteTagPending] = useState(false)
  const [preferredResultsColumnWidth, setPreferredResultsColumnWidth] = useState(
    RESULTS_COLUMN_DEFAULT_WIDTH,
  )
  const [preferredMarkdownEditorMode, setPreferredMarkdownEditorMode] =
    useState<MarkdownEditorModePreference>(DEFAULT_MARKDOWN_EDITOR_MODE)
  const [resultsColumnWidth, setResultsColumnWidth] = useState(RESULTS_COLUMN_DEFAULT_WIDTH)
  const [mobileResultsOverlayMounted, setMobileResultsOverlayMounted] = useState(false)
  const contentRef = useRef<HTMLDivElement | null>(null)
  const userRef = useRef<UserSummary | null>(null)
  const notesRef = useRef<NoteRecord[]>(notes)
  const categoriesRef = useRef<CategoryRecord[]>(categories)
  const tagsRef = useRef<TagRecord[]>(tags)
  const noteFormRef = useRef<NoteFormState>(noteForm)
  const editingNoteIdRef = useRef<number | null>(editingNoteId)
  const noteSavePromiseRef = useRef<Promise<void> | null>(null)
  const queuedAutosaveRef = useRef(false)
  const lastSavedNoteDraftRef = useRef<string | null>(null)
  const pendingTagLabelsRef = useRef<string[]>([])
  const creatingTagLabelsRef = useRef(new Set<string>())
  const lastSavedPreferencesRef = useRef(serializeUserPreferences({}))
  const preferenceSaveRequestIdRef = useRef(0)
  const mobileResultsOverlayTimeoutRef = useRef<number | null>(null)
  const resizeStateRef = useRef<{
    pointerId: number
    startX: number
    startWidth: number
    dragged: boolean
  } | null>(null)
  const trimmedSearchQuery = searchQuery.trim()
  const searchMode = trimmedSearchQuery.length > 0

  const clampResultsColumnWidth = useCallback((width: number) => {
    const contentWidth =
      contentRef.current?.getBoundingClientRect().width ??
      (typeof window === "undefined" ? RESULTS_COLUMN_DEFAULT_WIDTH : window.innerWidth)
    const availableWidth = contentWidth - FORM_COLUMN_MIN_WIDTH - RESIZE_HANDLE_WIDTH
    const maxWidth = Math.max(
      RESULTS_COLUMN_MIN_WIDTH,
      Math.min(RESULTS_COLUMN_MAX_WIDTH, availableWidth),
    )

    return Math.round(Math.min(Math.max(width, RESULTS_COLUMN_MIN_WIDTH), maxWidth))
  }, [])

  const resultsColumnStyle = useMemo<CSSProperties>(
    () => ({
      flexBasis: resultsColumnWidth,
      width: resultsColumnWidth,
    }),
    [resultsColumnWidth],
  )

  const clearMobileResultsOverlayTimeout = useCallback(() => {
    if (mobileResultsOverlayTimeoutRef.current === null) return

    window.clearTimeout(mobileResultsOverlayTimeoutRef.current)
    mobileResultsOverlayTimeoutRef.current = null
  }, [])

  const handleResizePointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    event.preventDefault()
    resizeStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: resultsListVisible ? resultsColumnWidth : RESULTS_COLUMN_MIN_WIDTH,
      dragged: false,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const handleResizePointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    if (isMobileResultsLayout()) return

    const resizeState = resizeStateRef.current
    if (!resizeState || resizeState.pointerId !== event.pointerId) return

    const delta = resizeState.startX - event.clientX
    if (!resizeState.dragged && Math.abs(delta) < RESIZE_DRAG_THRESHOLD) return

    resizeState.dragged = true
    const nextPreferredWidth = clampStoredResultsColumnWidth(resizeState.startWidth + delta)
    setResultsListVisible(true)
    setPreferredResultsColumnWidth(nextPreferredWidth)
    setResultsColumnWidth(clampResultsColumnWidth(nextPreferredWidth))
    setUserPreferences((current) =>
      getStoredResultsColumnWidth(current) === nextPreferredWidth
        ? current
        : withResultsColumnWidthPreference(current, nextPreferredWidth),
    )
  }

  const handleResizePointerUp = (event: PointerEvent<HTMLButtonElement>) => {
    const resizeState = resizeStateRef.current
    if (!resizeState || resizeState.pointerId !== event.pointerId) return

    if (!resizeState.dragged) {
      setResultsListVisible((visible) => !visible)
    }

    resizeStateRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  const handleResizePointerCancel = (event: PointerEvent<HTMLButtonElement>) => {
    resizeStateRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  const handleMobileResultsOverlayClick = useCallback(() => {
    setResultsListVisible(false)
  }, [setResultsListVisible])

  useEffect(() => {
    const mediaQuery = window.matchMedia(MOBILE_RESULTS_MEDIA_QUERY)
    const syncResultsVisibility = () => {
      if (mediaQuery.matches) {
        setResultsListVisible(false)
      } else {
        setMobileResultsOverlayMounted(false)
        setResultsListVisible(true)
      }
    }

    syncResultsVisibility()
    mediaQuery.addEventListener("change", syncResultsVisibility)
    return () => mediaQuery.removeEventListener("change", syncResultsVisibility)
  }, [setResultsListVisible])

  useEffect(() => {
    if (resultsListVisible) {
      clearMobileResultsOverlayTimeout()
      setMobileResultsOverlayMounted(isMobileResultsLayout())
      return
    }

    if (!mobileResultsOverlayMounted) return

    clearMobileResultsOverlayTimeout()
    mobileResultsOverlayTimeoutRef.current = window.setTimeout(() => {
      mobileResultsOverlayTimeoutRef.current = null
      setMobileResultsOverlayMounted(false)
    }, MOBILE_RESULTS_TRANSITION_MS)

    return clearMobileResultsOverlayTimeout
  }, [clearMobileResultsOverlayTimeout, mobileResultsOverlayMounted, resultsListVisible])

  useEffect(() => clearMobileResultsOverlayTimeout, [clearMobileResultsOverlayTimeout])

  useEffect(() => {
    if (!resultsListVisible) return

    const handleDocumentKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape" && isMobileResultsLayout()) {
        setResultsListVisible(false)
      }
    }

    document.addEventListener("keydown", handleDocumentKeyDown)
    return () => {
      document.removeEventListener("keydown", handleDocumentKeyDown)
    }
  }, [resultsListVisible, setResultsListVisible])

  useEffect(() => {
    userRef.current = user
  }, [user])

  useEffect(() => {
    notesRef.current = notes
  }, [notes])

  useEffect(() => {
    categoriesRef.current = categories
  }, [categories])

  useEffect(() => {
    tagsRef.current = tags
  }, [tags])

  useEffect(() => {
    noteFormRef.current = noteForm
  }, [noteForm])

  useEffect(() => {
    editingNoteIdRef.current = editingNoteId
  }, [editingNoteId])

  useEffect(() => {
    const handleWindowResize = () => {
      setResultsColumnWidth(clampResultsColumnWidth(preferredResultsColumnWidth))
    }

    window.addEventListener("resize", handleWindowResize)
    return () => window.removeEventListener("resize", handleWindowResize)
  }, [clampResultsColumnWidth, preferredResultsColumnWidth])

  useEffect(() => {
    pendingTagLabelsRef.current = pendingTagLabels
  }, [pendingTagLabels])

  const clearStatusMessage = useCallback(() => setStatusMessage(null), [])
  useAutoDismissStatus(statusMessage, clearStatusMessage)

  const clearMessages = useCallback(() => {
    setStatusMessage(null)
    setErrorMessage(null)
    setSearchErrorMessage(null)
  }, [])

  const applyLoadedUser = useCallback(
    (nextUser: UserSummary) => {
      const nextPreferences = normalizeUserPreferences(nextUser.preferences)
      const nextPreferredResultsColumnWidth =
        getStoredResultsColumnWidth(nextPreferences) ?? RESULTS_COLUMN_DEFAULT_WIDTH
      const nextPreferredMarkdownEditorMode =
        getStoredMarkdownEditorMode(nextPreferences) ?? DEFAULT_MARKDOWN_EDITOR_MODE

      lastSavedPreferencesRef.current = serializeUserPreferences(nextPreferences)
      setUser({ ...nextUser, preferences: nextPreferences })
      setUserPreferences(nextPreferences)
      setPreferredResultsColumnWidth(nextPreferredResultsColumnWidth)
      setPreferredMarkdownEditorMode(nextPreferredMarkdownEditorMode)
      setResultsColumnWidth(clampResultsColumnWidth(nextPreferredResultsColumnWidth))
    },
    [clampResultsColumnWidth],
  )

  const resetNoteForm = useCallback(
    (options: ResetNoteFormOptions = {}) => {
      const categoryList = options.categoryList ?? categories
      const selectedCategoryId: number | null =
        "selectedCategoryId" in options
          ? (options.selectedCategoryId ?? null)
          : getDefaultCategoryId(categoryList)
      const selectedTagIds = options.selectedTagIds ?? []
      const nextForm = {
        ...createDefaultNoteForm(),
        selectedCategoryId,
        selectedTagIds,
      }

      noteFormRef.current = nextForm
      editingNoteIdRef.current = null
      lastSavedNoteDraftRef.current = serializeNoteDraft(null, nextForm)
      setNoteForm(nextForm)
      setEditingNoteId(null)
      bumpDescriptionEditorSessionId()
      setPendingTagLabels([])
    },
    [
      bumpDescriptionEditorSessionId,
      categories,
      setEditingNoteId,
      setNoteForm,
      setPendingTagLabels,
    ],
  )

  const applyNotesUrlSelection = useCallback(
    ({
      categoryList = categoriesRef.current,
      noteList = notesRef.current,
      tagList = tagsRef.current,
    }: {
      categoryList?: CategoryRecord[]
      noteList?: NoteRecord[]
      tagList?: TagRecord[]
    } = {}) => {
      const selection = readNotesUrlSelection()
      const validTagIds = selection.tagIds.filter((tagId) =>
        tagList.some((tag) => tag.id === tagId),
      )

      if (selection.noteId !== null) {
        const note = noteList.find((item) => item.id === selection.noteId)
        if (note) {
          const nextForm = noteToFormState(note)
          const shouldResetDescriptionEditor = editingNoteIdRef.current !== note.id
          editingNoteIdRef.current = note.id
          noteFormRef.current = nextForm
          lastSavedNoteDraftRef.current = serializeNoteDraft(note.id, nextForm)
          setEditingNoteId(note.id)
          if (shouldResetDescriptionEditor) {
            bumpDescriptionEditorSessionId()
          }
          setPendingTagLabels([])
          setNoteForm(nextForm)
          setCategoryInputValue(note.category.label)
          setNotesUrlSelectionReady(true)
          return
        }
      }

      const categoryId =
        selection.categoryId !== null &&
        categoryList.some((category) => category.id === selection.categoryId)
          ? selection.categoryId
          : getDefaultCategoryId(categoryList)
      const nextForm = {
        ...createDefaultNoteForm(),
        selectedCategoryId: categoryId,
        selectedTagIds: validTagIds,
      }
      const categoryLabel =
        categoryId === null
          ? ""
          : (categoryList.find((category) => category.id === categoryId)?.label ?? "")

      noteFormRef.current = nextForm
      editingNoteIdRef.current = null
      lastSavedNoteDraftRef.current = serializeNoteDraft(null, nextForm)
      setEditingNoteId(null)
      bumpDescriptionEditorSessionId()
      setPendingTagLabels([])
      setNoteForm(nextForm)
      setCategoryInputValue(categoryLabel)
      setNotesUrlSelectionReady(true)
    },
    [
      bumpDescriptionEditorSessionId,
      setCategoryInputValue,
      setEditingNoteId,
      setNoteForm,
      setNotesUrlSelectionReady,
      setPendingTagLabels,
    ],
  )

  const handleCancelEdit = useCallback(() => {
    resetNoteForm({ selectedCategoryId: noteForm.selectedCategoryId })
  }, [noteForm.selectedCategoryId, resetNoteForm])

  const loadNotes = useCallback(async (userId: number) => {
    setNotesLoading(true)
    try {
      const response = await fetch(`/api/notes?userId=${userId}`, { cache: "no-store" })
      const data = await readJson<NotesResponse>(response)
      setNotes(data.notes)
      return data.notes
    } finally {
      setNotesLoading(false)
    }
  }, [])

  const loadCategories = useCallback(async (userId: number) => {
    const response = await fetch(`/api/categories?userId=${userId}`, { cache: "no-store" })
    const data = await readJson<CategoriesResponse>(response)
    setCategories(data.categories)
    return data.categories
  }, [])

  const loadTags = useCallback(async (userId: number) => {
    const response = await fetch(`/api/tags?userId=${userId}`, { cache: "no-store" })
    const data = await readJson<TagsResponse>(response)
    setTags(data.tags)
    return data.tags
  }, [])

  const runSearch = useCallback(async (userId: number, query: string, limit: number) => {
    const response = await fetch("/api/notes/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId,
        query,
        limit: Math.min(Math.max(limit, 1), NOTES_APP_SEARCH_MAX_RESULTS),
      }),
    })
    const data = await readJson<SearchResponse>(response)
    setSearchResults(data.results)
    return data.results
  }, [])

  useEffect(() => {
    let active = true

    const restoreSession = async () => {
      const storedUserId = window.localStorage.getItem(STORAGE_KEY)

      if (!storedUserId) {
        setSessionLoading(false)
        return
      }

      try {
        const sessionResponse = await fetch(`/api/session?userId=${storedUserId}`, {
          cache: "no-store",
        })
        const sessionData = await readJson<SessionResponse>(sessionResponse)

        if (!active) return

        applyLoadedUser(sessionData.user)
        const [loadedNotes, loadedCategories, loadedTags] = await Promise.all([
          loadNotes(sessionData.user.id),
          loadCategories(sessionData.user.id),
          loadTags(sessionData.user.id),
        ])
        applyNotesUrlSelection({
          categoryList: loadedCategories,
          noteList: loadedNotes,
          tagList: loadedTags,
        })
      } catch (error) {
        if (!active) return
        window.localStorage.removeItem(STORAGE_KEY)
        preferenceSaveRequestIdRef.current += 1
        lastSavedPreferencesRef.current = serializeUserPreferences({})
        setUser(null)
        setUserPreferences({})
        setCategories([])
        setTags([])
        setNotes([])
        resetNotesAppStore()
        setResultsListVisible(!isMobileResultsLayout())
        setPreferredResultsColumnWidth(RESULTS_COLUMN_DEFAULT_WIDTH)
        setPreferredMarkdownEditorMode(DEFAULT_MARKDOWN_EDITOR_MODE)
        setResultsColumnWidth(RESULTS_COLUMN_DEFAULT_WIDTH)
        setErrorMessage(getErrorMessage(error))
      } finally {
        if (active) setSessionLoading(false)
      }
    }

    void restoreSession()
    return () => {
      active = false
    }
  }, [
    applyLoadedUser,
    loadCategories,
    loadTags,
    loadNotes,
    applyNotesUrlSelection,
    resetNotesAppStore,
    setResultsListVisible,
  ])

  useEffect(() => {
    if (!user) return

    const serializedPreferences = serializeUserPreferences(userPreferences)
    if (serializedPreferences === lastSavedPreferencesRef.current) return

    const requestId = preferenceSaveRequestIdRef.current + 1
    preferenceSaveRequestIdRef.current = requestId

    const timeoutId = window.setTimeout(() => {
      void fetch("/api/session", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: user.id,
          preferences: userPreferences,
        }),
      })
        .then((response) => readJson<SessionResponse>(response))
        .then((data) => {
          if (preferenceSaveRequestIdRef.current !== requestId) return

          const nextPreferences = normalizeUserPreferences(data.user.preferences)
          const nextPreferredResultsColumnWidth =
            getStoredResultsColumnWidth(nextPreferences) ?? RESULTS_COLUMN_DEFAULT_WIDTH
          const nextPreferredMarkdownEditorMode =
            getStoredMarkdownEditorMode(nextPreferences) ?? DEFAULT_MARKDOWN_EDITOR_MODE
          lastSavedPreferencesRef.current = serializeUserPreferences(nextPreferences)
          setUser({ ...data.user, preferences: nextPreferences })
          setUserPreferences(nextPreferences)
          setPreferredResultsColumnWidth(nextPreferredResultsColumnWidth)
          setPreferredMarkdownEditorMode(nextPreferredMarkdownEditorMode)
          setResultsColumnWidth(clampResultsColumnWidth(nextPreferredResultsColumnWidth))
        })
        .catch((error: unknown) => {
          if (preferenceSaveRequestIdRef.current !== requestId) return
          setErrorMessage(getErrorMessage(error))
        })
    }, PREFERENCES_SAVE_DEBOUNCE_MS)

    return () => window.clearTimeout(timeoutId)
  }, [clampResultsColumnWidth, user, userPreferences])

  useEffect(() => {
    if (!user) return
    if (!notesUrlSelectionReady) return

    writeNotesUrlSelection({
      noteId: editingNoteId,
      categoryId: noteForm.selectedCategoryId,
      tagIds: noteForm.selectedTagIds,
    })
  }, [
    editingNoteId,
    noteForm.selectedCategoryId,
    noteForm.selectedTagIds,
    notesUrlSelectionReady,
    user,
  ])

  useEffect(() => {
    if (!user) return

    const handlePopState = () => {
      applyNotesUrlSelection()
    }

    window.addEventListener("popstate", handlePopState)
    return () => {
      window.removeEventListener("popstate", handlePopState)
    }
  }, [applyNotesUrlSelection, user])

  useEffect(() => {
    if (!user) {
      setSearchResults([])
      setSearchErrorMessage(null)
      setSearchLoading(false)
      return
    }

    if (!trimmedSearchQuery) {
      setSearchResults([])
      setSearchErrorMessage(null)
      setSearchLoading(false)
      return
    }

    const controller = new AbortController()
    const timeoutId = window.setTimeout(() => {
      setSearchLoading(true)
      setSearchErrorMessage(null)

      void fetch("/api/notes/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: user.id,
          query: trimmedSearchQuery,
          limit: NOTES_APP_SEARCH_MAX_RESULTS,
        }),
        signal: controller.signal,
      })
        .then((response) => readJson<SearchResponse>(response))
        .then((data) => {
          setSearchResults(data.results)
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return
          setSearchResults([])
          setSearchErrorMessage(getErrorMessage(error))
        })
        .finally(() => {
          if (!controller.signal.aborted) setSearchLoading(false)
        })
    }, 250)

    return () => {
      controller.abort()
      window.clearTimeout(timeoutId)
    }
  }, [notes.length, trimmedSearchQuery, user])

  const refreshResults = useCallback(
    async (userId: number) => {
      const [latestNotes, latestCategories, latestTags] = await Promise.all([
        loadNotes(userId),
        loadCategories(userId),
        loadTags(userId),
      ])
      setNoteForm((prev) => {
        if (
          prev.selectedCategoryId !== null &&
          latestCategories.some((category) => category.id === prev.selectedCategoryId)
        ) {
          return prev
        }

        return {
          ...prev,
          selectedCategoryId: getDefaultCategoryId(latestCategories),
        }
      })
      if (trimmedSearchQuery) {
        await runSearch(userId, trimmedSearchQuery, NOTES_APP_SEARCH_MAX_RESULTS)
      }
      return { latestNotes, latestCategories, latestTags }
    },
    [loadCategories, loadTags, loadNotes, runSearch, trimmedSearchQuery],
  )

  const saveCurrentNote = useCallback(
    async function saveCurrentNote(mode: NoteSaveMode): Promise<void> {
      if (noteSavePromiseRef.current) {
        if (mode === "autosave") {
          queuedAutosaveRef.current = true
          return
        }

        await noteSavePromiseRef.current.catch(() => undefined)
      }

      const currentUser = userRef.current
      const formSnapshot = snapshotNoteForm(noteFormRef.current)
      const noteId = editingNoteIdRef.current
      const draftSignature = serializeNoteDraft(noteId, formSnapshot)

      if (!currentUser) {
        if (mode === "manual") setErrorMessage("Sign in before editing notes.")
        return
      }

      if (formSnapshot.selectedCategoryId === null) {
        if (mode === "manual") setErrorMessage("Choose a category before saving the note.")
        return
      }

      if (mode === "autosave") {
        if (formSnapshot.description.trim() === "") return
        if (draftSignature === lastSavedNoteDraftRef.current) return
      } else {
        clearMessages()
        setNotePending(true)
      }

      const savePromise = (async () => {
        const requestBody =
          noteId === null
            ? {
                userId: currentUser.id,
                note: noteRequestBody(formSnapshot),
              }
            : {
                userId: currentUser.id,
                noteId,
                note: noteRequestBody(formSnapshot),
              }
        const response = await fetch("/api/notes", {
          method: noteId === null ? "POST" : "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestBody),
        })
        const data = await readJson<{ note: NoteRecord }>(response)

        if (userRef.current?.id !== currentUser.id) return

        const { latestNotes, latestCategories } = await refreshResults(currentUser.id)

        const savedNoteId = data.note.id
        lastSavedNoteDraftRef.current = serializeNoteDraft(savedNoteId, formSnapshot)

        if (mode === "autosave") {
          const currentForm = noteFormRef.current
          const currentDescriptionHasText = currentForm.description.trim() !== ""

          if (noteId === null && editingNoteIdRef.current === null && currentDescriptionHasText) {
            editingNoteIdRef.current = savedNoteId
            setEditingNoteId(savedNoteId)
          }
          return
        }

        resetNoteForm({ categoryList: latestCategories })
        setStatusMessage(noteId === null ? "Note created." : "Note updated.")
      })()

      noteSavePromiseRef.current = savePromise

      try {
        await savePromise
      } catch (error) {
        if (userRef.current?.id === currentUser.id) {
          setErrorMessage(getErrorMessage(error))
        }
      } finally {
        if (noteSavePromiseRef.current === savePromise) {
          noteSavePromiseRef.current = null
        }
        if (mode === "manual") setNotePending(false)
      }

      if (queuedAutosaveRef.current) {
        queuedAutosaveRef.current = false
        const latestForm = noteFormRef.current
        const latestSignature = serializeNoteDraft(editingNoteIdRef.current, latestForm)
        if (
          latestForm.description.trim() !== "" &&
          latestForm.selectedCategoryId !== null &&
          latestSignature !== lastSavedNoteDraftRef.current
        ) {
          void saveCurrentNote("autosave")
        }
      }
    },
    [clearMessages, refreshResults, resetNoteForm],
  )

  useEffect(() => {
    if (!user) return
    if (notePending) return
    if (noteForm.description.trim() === "") return
    if (noteForm.selectedCategoryId === null) return

    const draftSignature = serializeNoteDraft(editingNoteId, noteForm)
    if (draftSignature === lastSavedNoteDraftRef.current) return

    const timeoutId = window.setTimeout(() => {
      void saveCurrentNote("autosave")
    }, NOTE_AUTOSAVE_DEBOUNCE_MS)

    return () => window.clearTimeout(timeoutId)
  }, [editingNoteId, noteForm, notePending, saveCurrentNote, user])

  const matchesSelectedTag = useCallback(
    (note: NoteRecord) =>
      selectedTagId === null || note.tags.some((tag) => tag.id === selectedTagId),
    [selectedTagId],
  )

  const searchItems = useMemo<DisplayNoteItem[]>(() => {
    if (!searchMode) {
      return []
    }

    return [...searchResults]
      .filter((result) => matchesSelectedTag(result.note))
      .sort((left, right) => right.similarity - left.similarity)
      .map((result) => ({
        note: result.note,
        relevance: result.similarity,
      }))
  }, [matchesSelectedTag, searchMode, searchResults])

  const allNoteItems = useMemo<DisplayNoteItem[]>(
    () =>
      [...notes]
        .sort((left, right) => getNoteSortTime(right) - getNoteSortTime(left))
        .map((note) => ({ note })),
    [notes],
  )

  const allCategoryItems = useMemo<DisplayNoteItem[]>(
    () => allNoteItems.filter(({ note }) => matchesSelectedTag(note)),
    [allNoteItems, matchesSelectedTag],
  )

  const allCategoriesNoteCount = selectedTagId === null ? notes.length : allCategoryItems.length

  const categoryNoteGroups = useMemo<CategoryNoteGroup[]>(() => {
    const notesByCategory = new Map<number, NoteRecord[]>()
    for (const category of categories) {
      notesByCategory.set(category.id, [])
    }

    for (const note of notes) {
      const categoryNotes = notesByCategory.get(note.category.id)
      if (categoryNotes) {
        categoryNotes.push(note)
      }
    }

    return categories
      .map((category) => {
        const categoryNotes = notesByCategory.get(category.id) ?? []
        const items = [...categoryNotes]
          .filter(matchesSelectedTag)
          .sort((left, right) => getNoteSortTime(right) - getNoteSortTime(left))
          .map((note) => ({ note }))

        return {
          category,
          items,
          sortTime: getGroupSortTime(items),
        }
      })
      .sort((left, right) => compareCategoryNoteGroups(left, right, fallbackCategoryId))
  }, [categories, fallbackCategoryId, matchesSelectedTag, notes])

  const tagNoteGroups = useMemo<TagNoteGroup[]>(() => {
    const notesByTag = new Map<number, DisplayNoteItem[]>()
    for (const tag of tags) {
      notesByTag.set(tag.id, [])
    }

    for (const item of allNoteItems) {
      for (const tag of item.note.tags) {
        notesByTag.get(tag.id)?.push(item)
      }
    }

    return tags
      .map((tag) => {
        const items = notesByTag.get(tag.id) ?? []

        return {
          tag,
          items,
          sortTime: getGroupSortTime(items),
        }
      })
      .sort(compareNoteGroups)
  }, [allNoteItems, tags])

  const selectedTag = useMemo(
    () => (selectedTagId === null ? null : (tags.find((c) => c.id === selectedTagId) ?? null)),
    [tags, selectedTagId],
  )

  const handleTagValuesChange = (nextValues: string[]) => {
    const cleanedValues: string[] = []
    const seen = new Set<string>()

    for (const rawValue of nextValues) {
      const value = normalizeLabel(rawValue)
      const normalized = normalizeLabel(value)
      if (normalized === "" || seen.has(normalized)) {
        continue
      }
      seen.add(normalized)
      cleanedValues.push(value)
    }

    const nextSelectedTagIds = cleanedValues.flatMap((value) => {
      const matchingTag = tags.find((tag) => normalizeLabel(tag.label) === normalizeLabel(value))
      return matchingTag ? [matchingTag.id] : []
    })
    const nextPendingLabels = cleanedValues.filter(
      (value) => !tags.some((tag) => normalizeLabel(tag.label) === normalizeLabel(value)),
    )

    setNoteForm((prev) => ({
      ...prev,
      selectedTagIds: nextSelectedTagIds,
    }))
    setPendingTagLabels(nextPendingLabels)
    nextPendingLabels.forEach((label) => {
      void handleCreateTag(label)
    })
  }

  const handleRefreshNotes = async () => {
    if (!user) return
    clearMessages()
    try {
      await refreshResults(user.id)
      setStatusMessage("Notes refreshed.")
    } catch (error) {
      setErrorMessage(getErrorMessage(error))
    }
  }

  const handleRunEmbeddingMaintenance = async (mode: EmbeddingMaintenanceMode) => {
    if (!user) return
    clearMessages()
    setEmbeddingMaintenancePending(mode)
    try {
      const response = await fetch("/api/notes/maintenance/embeddings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: user.id,
          mode,
          limit: Math.min(Math.max(notes.length, 100), 500),
        }),
      })
      const data = await readJson<EmbeddingMaintenanceResponse>(response)
      await refreshResults(user.id)
      const parts: string[] = []
      if (data.tagsUpdated > 0) {
        parts.push(`${data.tagsUpdated} tag${data.tagsUpdated === 1 ? "" : "s"}`)
      }
      if (data.updated > 0) {
        parts.push(`${data.updated} note${data.updated === 1 ? "" : "s"}`)
      }
      setStatusMessage(
        parts.length === 0
          ? `Embedding maintenance (${mode}) found nothing to update.`
          : `Embedding maintenance (${mode}) updated ${parts.join(" and ")}${data.hasMore ? ". More remain; run again." : "."}`,
      )
    } catch (error) {
      setErrorMessage(getErrorMessage(error))
    } finally {
      setEmbeddingMaintenancePending(null)
    }
  }

  const handleLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    clearMessages()
    setAuthPending(true)
    try {
      const response = await fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier }),
      })
      const data = await readJson<SessionResponse>(response)
      window.localStorage.setItem(STORAGE_KEY, String(data.user.id))
      applyLoadedUser(data.user)
      const [loadedCategories, loadedTags, loadedNotes] = await Promise.all([
        loadCategories(data.user.id),
        loadTags(data.user.id),
        loadNotes(data.user.id),
      ])
      setIdentifier("")
      applyNotesUrlSelection({
        categoryList: loadedCategories,
        noteList: loadedNotes,
        tagList: loadedTags,
      })
      setSearchQuery("")
      setSearchResults([])
      setSearchErrorMessage(null)
    } catch (error) {
      setErrorMessage(getErrorMessage(error))
    } finally {
      setAuthPending(false)
      setSessionLoading(false)
    }
  }

  const handleLogout = () => {
    window.localStorage.removeItem(STORAGE_KEY)
    preferenceSaveRequestIdRef.current += 1
    lastSavedPreferencesRef.current = serializeUserPreferences({})
    setUser(null)
    setUserPreferences({})
    setCategories([])
    setTags([])
    setNotes([])
    setSearchQuery("")
    setSearchResults([])
    setSearchErrorMessage(null)
    resetNotesAppStore()
    setResultsListVisible(!isMobileResultsLayout())
    setPreferredResultsColumnWidth(RESULTS_COLUMN_DEFAULT_WIDTH)
    setPreferredMarkdownEditorMode(DEFAULT_MARKDOWN_EDITOR_MODE)
    setResultsColumnWidth(RESULTS_COLUMN_DEFAULT_WIDTH)
    resetNoteForm({ categoryList: [] })
    clearMessages()
  }

  // const handleMarkdownEditorModeChange = useCallback((mode: MarkdownEditorModePreference) => {
  //   setPreferredMarkdownEditorMode(mode)
  //   setUserPreferences((current) =>
  //     getStoredMarkdownEditorMode(current) === mode
  //       ? current
  //       : withMarkdownEditorModePreference(current, mode),
  //   )
  // }, [])

  const handleStartEdit = (note: NoteRecord) => {
    clearMessages()
    const nextForm = noteToFormState(note)
    const shouldResetDescriptionEditor = editingNoteIdRef.current !== note.id
    editingNoteIdRef.current = note.id
    noteFormRef.current = nextForm
    lastSavedNoteDraftRef.current = serializeNoteDraft(note.id, nextForm)
    setEditingNoteId(note.id)
    if (shouldResetDescriptionEditor) {
      bumpDescriptionEditorSessionId()
    }
    setPendingTagLabels([])
    setNoteForm(nextForm)
  }

  const closeResultsListOnMobile = () => {
    if (isMobileResultsLayout()) {
      setResultsListVisible(false)
    }
  }

  const handleOpenNoteFromResults = (note: NoteRecord) => {
    handleStartEdit(note)
    closeResultsListOnMobile()
  }

  const handleAddNoteForCategory = (category: CategoryRecord) => {
    clearMessages()
    resetNoteForm({ selectedCategoryId: category.id })
    setCategoryInputValue(category.label)
    closeResultsListOnMobile()
  }

  const handleAddNoteForTag = (tag: TagRecord) => {
    clearMessages()
    const currentCategoryId = noteFormRef.current.selectedCategoryId
    const selectedCategoryId =
      currentCategoryId !== null && categories.some((category) => category.id === currentCategoryId)
        ? currentCategoryId
        : getDefaultCategoryId(categories)
    resetNoteForm({ selectedCategoryId, selectedTagIds: [tag.id] })
    const categoryLabel =
      selectedCategoryId === null
        ? ""
        : (categories.find((category) => category.id === selectedCategoryId)?.label ?? "")
    setCategoryInputValue(categoryLabel)
    closeResultsListOnMobile()
  }

  const handleSelectCategory = (rawId: string) => {
    if (rawId === "") {
      return
    }
    const id = Number.parseInt(rawId, 10)
    if (!Number.isInteger(id) || id < 1) {
      return
    }
    const category = categories.find((item) => item.id === id)
    if (!category) {
      return
    }
    setNoteForm((prev) => ({
      ...prev,
      selectedCategoryId: category.id,
    }))
    setCategoryInputValue(category.label)
  }

  const handleCreateTag = async (rawLabel: string) => {
    if (!user) {
      setErrorMessage("Sign in before adding tags.")
      return
    }
    const label = rawLabel.trim()
    if (label === "") {
      return
    }
    const normalizedLabel = normalizeLabel(label)
    const existingTag = tags.find((tag) => normalizeLabel(tag.label) === normalizedLabel)
    if (existingTag) {
      setPendingTagLabels((prev) => prev.filter((item) => normalizeLabel(item) !== normalizedLabel))
      setNoteForm((prev) => ({
        ...prev,
        selectedTagIds: prev.selectedTagIds.includes(existingTag.id)
          ? prev.selectedTagIds
          : [...prev.selectedTagIds, existingTag.id],
      }))
      return
    }
    if (creatingTagLabelsRef.current.has(normalizedLabel)) {
      return
    }
    clearMessages()
    creatingTagLabelsRef.current.add(normalizedLabel)
    setCreateTagPending(true)
    try {
      const response = await fetch("/api/tags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.id, label }),
      })
      const data = await readJson<CreateTagResponse>(response)
      setTags((prev) => {
        const without = prev.filter((c) => c.id !== data.tag.id)
        return [...without, data.tag].sort((a, b) =>
          a.label.localeCompare(b.label, undefined, { sensitivity: "base" }),
        )
      })
      const shouldKeepSelected = pendingTagLabelsRef.current.some(
        (item) => normalizeLabel(item) === normalizedLabel,
      )
      setPendingTagLabels((prev) => prev.filter((item) => normalizeLabel(item) !== normalizedLabel))
      if (shouldKeepSelected) {
        setNoteForm((prev) => ({
          ...prev,
          selectedTagIds: prev.selectedTagIds.includes(data.tag.id)
            ? prev.selectedTagIds
            : [...prev.selectedTagIds, data.tag.id],
        }))
      }
      setStatusMessage(`Tag “${data.tag.label}” added.`)
    } catch (error) {
      setPendingTagLabels((prev) => prev.filter((item) => normalizeLabel(item) !== normalizedLabel))
      setErrorMessage(getErrorMessage(error))
    } finally {
      creatingTagLabelsRef.current.delete(normalizedLabel)
      setCreateTagPending(false)
    }
  }

  const handleCreateCategory = async (rawLabel: string) => {
    if (!user) {
      setErrorMessage("Sign in before adding categories.")
      return
    }
    const label = rawLabel.trim()
    if (label === "") {
      return
    }
    const existingCategory = categories.find(
      (category) => normalizeLabel(category.label) === normalizeLabel(label),
    )
    if (existingCategory) {
      setNoteForm((prev) => ({
        ...prev,
        selectedCategoryId: existingCategory.id,
      }))
      setCategoryInputValue(existingCategory.label)
      return
    }
    clearMessages()
    setCreateCategoryPending(true)
    try {
      const response = await fetch("/api/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.id, label }),
      })
      const data = await readJson<CreateCategoryResponse>(response)
      setCategories((prev) => {
        const without = prev.filter((category) => category.id !== data.category.id)
        return [...without, data.category].sort((a, b) =>
          a.label.localeCompare(b.label, undefined, { sensitivity: "base" }),
        )
      })
      setNoteForm((prev) => ({
        ...prev,
        selectedCategoryId: data.category.id,
      }))
      setCategoryInputValue(data.category.label)
      setStatusMessage(`Category “${data.category.label}” added.`)
    } catch (error) {
      setErrorMessage(getErrorMessage(error))
    } finally {
      setCreateCategoryPending(false)
    }
  }

  const handleSaveNote = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void saveCurrentNote("manual")
  }

  const resolveCategoryForSidebarMove = async (
    rawLabel: string,
  ): Promise<CategoryRecord | null> => {
    if (!user) {
      setErrorMessage("Sign in before moving notes.")
      return null
    }
    const label = normalizeLabel(rawLabel)
    if (label === "") {
      return null
    }
    const existingCategory = categories.find(
      (category) => normalizeLabel(category.label) === normalizeLabel(label),
    )
    if (existingCategory) {
      return existingCategory
    }

    const response = await fetch("/api/categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: user.id, label }),
    })
    const data = await readJson<CreateCategoryResponse>(response)
    setCategories((prev) => {
      const without = prev.filter((category) => category.id !== data.category.id)
      return [...without, data.category].sort((a, b) =>
        a.label.localeCompare(b.label, undefined, { sensitivity: "base" }),
      )
    })
    return data.category
  }

  const resolveTagForSidebarMove = async (rawLabel: string): Promise<TagRecord | null> => {
    if (!user) {
      setErrorMessage("Sign in before moving notes.")
      return null
    }
    const label = normalizeLabel(rawLabel)
    if (label === "") {
      return null
    }
    const existingTag = tags.find((tag) => normalizeLabel(tag.label) === normalizeLabel(label))
    if (existingTag) {
      return existingTag
    }

    const response = await fetch("/api/tags", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: user.id, label }),
    })
    const data = await readJson<CreateTagResponse>(response)
    setTags((prev) => {
      const without = prev.filter((tag) => tag.id !== data.tag.id)
      return [...without, data.tag].sort((a, b) =>
        a.label.localeCompare(b.label, undefined, { sensitivity: "base" }),
      )
    })
    return data.tag
  }

  const patchNoteFromSidebar = async (
    note: NoteRecord,
    nextCategoryId: number,
    nextTagIds: number[],
  ) => {
    if (!user) return null

    const response = await fetch("/api/notes", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: user.id,
        noteId: note.id,
        note: {
          categoryId: nextCategoryId,
          tagIds: nextTagIds,
          description: note.description ?? "",
          timeDue: note.timeDue,
          timeRemind: note.timeRemind,
        },
      }),
    })
    const data = await readJson<{ note: NoteRecord }>(response)
    await refreshResults(user.id)
    return data.note
  }

  const handleMoveNoteCategory = async (note: NoteRecord, categoryLabel: string) => {
    if (!user) return
    clearMessages()
    setNotePending(true)
    try {
      const category = await resolveCategoryForSidebarMove(categoryLabel)
      if (!category) return
      if (category.id === note.category.id) return

      const updatedNote = await patchNoteFromSidebar(
        note,
        category.id,
        note.tags.map((tag) => tag.id),
      )
      if (updatedNote && editingNoteId === note.id) {
        const nextForm = noteToFormState(updatedNote)
        noteFormRef.current = nextForm
        lastSavedNoteDraftRef.current = serializeNoteDraft(note.id, nextForm)
        setPendingTagLabels([])
        setNoteForm(nextForm)
      }
      setStatusMessage(`Note moved to “${category.label}”.`)
    } catch (error) {
      setErrorMessage(getErrorMessage(error))
    } finally {
      setNotePending(false)
    }
  }

  const handleMoveNoteTag = async (note: NoteRecord, fromTagId: number, tagLabel: string) => {
    if (!user) return
    clearMessages()
    setNotePending(true)
    try {
      const tag = await resolveTagForSidebarMove(tagLabel)
      if (!tag) return

      const nextTagIds = note.tags
        .filter((noteTag) => noteTag.id !== fromTagId && noteTag.id !== tag.id)
        .map((noteTag) => noteTag.id)
      nextTagIds.push(tag.id)

      const updatedNote = await patchNoteFromSidebar(note, note.category.id, nextTagIds)
      if (updatedNote && editingNoteId === note.id) {
        const nextForm = noteToFormState(updatedNote)
        noteFormRef.current = nextForm
        lastSavedNoteDraftRef.current = serializeNoteDraft(note.id, nextForm)
        setPendingTagLabels([])
        setNoteForm(nextForm)
      }
      setStatusMessage(`Note tag changed to “${tag.label}”.`)
    } catch (error) {
      setErrorMessage(getErrorMessage(error))
    } finally {
      setNotePending(false)
    }
  }

  const openEditCategory = (category: CategoryRecord) => {
    clearMessages()
    setEditingCategory(category)
    setEditCategoryLabel(category.label)
  }

  const closeEditCategory = () => {
    setEditingCategory(null)
    setEditCategoryLabel("")
  }

  const handleSaveCategory = async () => {
    if (!user || !editingCategory) return
    const label = editCategoryLabel.trim()
    if (label === "" || label === editingCategory.label) {
      closeEditCategory()
      return
    }
    clearMessages()
    setEditCategoryPending(true)
    try {
      const response = await fetch("/api/categories", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: user.id,
          categoryId: editingCategory.id,
          label,
        }),
      })
      const data = await readJson<UpdateCategoryResponse>(response)
      setCategories((prev) =>
        prev
          .map((category) => (category.id === data.category.id ? data.category : category))
          .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" })),
      )
      await loadNotes(user.id)
      setStatusMessage(`Category renamed to “${data.category.label}”.`)
      closeEditCategory()
    } catch (error) {
      setErrorMessage(getErrorMessage(error))
    } finally {
      setEditCategoryPending(false)
    }
  }

  const performDeleteCategory = async (category: CategoryRecord) => {
    if (!user) return
    clearMessages()
    setDeleteCategoryPending(true)
    try {
      const response = await fetch("/api/categories", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: user.id,
          categoryId: category.id,
        }),
      })
      await readJson<DeleteCategoryResponse>(response)
      await refreshResults(user.id)
      setStatusMessage(`Category “${category.label}” deleted.`)
      setDeletingCategory(null)
    } catch (error) {
      setErrorMessage(getErrorMessage(error))
    } finally {
      setDeleteCategoryPending(false)
    }
  }

  const openDeleteCategory = (category: CategoryRecord) => {
    clearMessages()
    if (categories.length <= 1) {
      setErrorMessage("Create another category before deleting the last one.")
      return
    }
    if (category.id === fallbackCategoryId) {
      setErrorMessage("The default category cannot be deleted.")
      return
    }
    if (category.noteCount === 0) {
      void performDeleteCategory(category)
      return
    }
    setDeletingCategory(category)
  }

  const closeDeleteCategory = () => {
    setDeletingCategory(null)
  }

  const handleConfirmDeleteCategory = async () => {
    if (!deletingCategory) return
    await performDeleteCategory(deletingCategory)
  }

  const openEditTag = (tag: TagRecord) => {
    clearMessages()
    setEditingTag(tag)
    setEditTagLabel(tag.label)
  }

  const closeEditTag = () => {
    setEditingTag(null)
    setEditTagLabel("")
  }

  const handleSaveTag = async () => {
    if (!user || !editingTag) return
    const label = editTagLabel.trim()
    if (label === "" || label === editingTag.label) {
      closeEditTag()
      return
    }
    clearMessages()
    setEditTagPending(true)
    try {
      const response = await fetch("/api/tags", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: user.id,
          tagId: editingTag.id,
          label,
        }),
      })
      const data = await readJson<UpdateTagResponse>(response)
      setTags((prev) =>
        prev
          .map((c) => (c.id === data.tag.id ? data.tag : c))
          .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" })),
      )
      await loadNotes(user.id)
      setStatusMessage(`Tag renamed to “${data.tag.label}”.`)
      closeEditTag()
    } catch (error) {
      setErrorMessage(getErrorMessage(error))
    } finally {
      setEditTagPending(false)
    }
  }

  const performDeleteTag = async (tag: TagRecord) => {
    if (!user) return
    clearMessages()
    setDeleteTagPending(true)
    try {
      const response = await fetch("/api/tags", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: user.id,
          tagId: tag.id,
        }),
      })
      const data = await readJson<DeleteTagResponse>(response)
      setTags((prev) => prev.filter((c) => c.id !== tag.id))
      if (selectedTagId === tag.id) {
        setSelectedTagId(null)
      }
      await refreshResults(user.id)
      setStatusMessage(
        data.deletedLinks === 0
          ? `Tag “${tag.label}” deleted.`
          : `Tag “${tag.label}” deleted (removed from ${data.deletedLinks} ${
              data.deletedLinks === 1 ? "note" : "notes"
            }).`,
      )
      setDeletingTag(null)
    } catch (error) {
      setErrorMessage(getErrorMessage(error))
    } finally {
      setDeleteTagPending(false)
    }
  }

  const openDeleteTag = (tag: TagRecord) => {
    clearMessages()
    if (tag.noteCount === 0) {
      void performDeleteTag(tag)
    } else {
      setDeletingTag(tag)
    }
  }

  const closeDeleteTag = () => {
    setDeletingTag(null)
  }

  const handleConfirmDeleteTag = async () => {
    if (!deletingTag) return
    await performDeleteTag(deletingTag)
  }

  const handleDeleteNote = async (noteId: number) => {
    if (!user) return
    clearMessages()
    setDeletingNoteId(noteId)
    try {
      const response = await fetch("/api/notes", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.id, noteId }),
      })
      await readJson<{ ok: true }>(response)
      const { latestNotes, latestCategories } = await refreshResults(user.id)
      if (editingNoteId === noteId) {
        resetNoteForm({ categoryList: latestCategories })
      }
      setStatusMessage("Note deleted.")
    } catch (error) {
      setErrorMessage(getErrorMessage(error))
    } finally {
      setDeletingNoteId(null)
    }
  }

  if (sessionLoading) {
    return (
      <div className={styles.page}>
        <Text variant="body-1" color="secondary">
          Restoring session…
        </Text>
      </div>
    )
  }

  if (!user) {
    return (
      <LoginForm
        identifier={identifier}
        onIdentifierChange={setIdentifier}
        onSubmit={handleLogin}
        pending={authPending}
        errorMessage={errorMessage}
        onDismissError={() => setErrorMessage(null)}
      />
    )
  }

  return (
    <div className={styles.page}>
      <FeedbackNotifications
        statusMessage={statusMessage}
        errorMessage={errorMessage}
        searchErrorMessage={searchErrorMessage}
        onDismissStatus={() => setStatusMessage(null)}
        onDismissError={() => setErrorMessage(null)}
        onDismissSearchError={() => setSearchErrorMessage(null)}
      />

      <div className={styles.content} ref={contentRef}>
        <NoteForm
          form={noteForm}
          setForm={setNoteForm}
          editingNoteId={editingNoteId}
          notePending={notePending}
          deletingNoteId={deletingNoteId}
          userPresent={Boolean(user)}
          categories={categories}
          tags={tags}
          pendingTagLabels={pendingTagLabels}
          descriptionEditorSessionId={descriptionEditorSessionId}
          markdownEditorMode={preferredMarkdownEditorMode}
          categoryInputValue={categoryInputValue}
          onCategoryInputValueChange={setCategoryInputValue}
          createCategoryPending={createCategoryPending}
          createTagPending={createTagPending}
          onSelectCategoryId={handleSelectCategory}
          onCreateCategory={handleCreateCategory}
          onTagValuesChange={handleTagValuesChange}
          onSubmit={handleSaveNote}
          onDeleteNote={(noteId) => void handleDeleteNote(noteId)}
          onCancelEdit={handleCancelEdit}
          // onMarkdownEditorModeChange={handleMarkdownEditorModeChange}
          header={
            <div className={`${styles.header} ${styles.headerLeft}`}>
              <NotesHeader
                user={user}
                notesLoading={notesLoading}
                resultsListVisible={resultsListVisible}
                onRefresh={() => void handleRefreshNotes()}
                onLogout={handleLogout}
                embeddingMaintenancePending={embeddingMaintenancePending}
                onRunEmbeddingMaintenance={(mode) => void handleRunEmbeddingMaintenance(mode)}
              />
            </div>
          }
        />

        {mobileResultsOverlayMounted && (
          <button
            type="button"
            className={`${styles.mobileResultsOverlay} ${
              resultsListVisible ? "" : styles.mobileResultsOverlayClosing
            }`}
            aria-label="Hide notes list"
            onClick={handleMobileResultsOverlayClick}
          />
        )}

        <button
          type="button"
          className={`${styles.resizeHandle} ${
            resultsListVisible ? "" : styles.resizeHandleCollapsed
          }`}
          aria-label={resultsListVisible ? "Hide notes list" : "Show notes list"}
          aria-pressed={!resultsListVisible}
          title={
            resultsListVisible ? "Drag to resize notes list; click to hide" : "Show notes list"
          }
          onPointerDown={handleResizePointerDown}
          onPointerMove={handleResizePointerMove}
          onPointerUp={handleResizePointerUp}
          onPointerCancel={handleResizePointerCancel}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault()
              setResultsListVisible((visible) => !visible)
            }
          }}
        />

        <ResultsColumn
          visible={resultsListVisible}
          columnStyle={resultsColumnStyle}
          tags={tags}
          notesCount={notes.length}
          notesLoading={notesLoading}
          categories={categories}
          fallbackCategoryId={fallbackCategoryId}
          selectedTag={selectedTag}
          searchMode={searchMode}
          searchItems={searchItems}
          searchLoading={searchLoading}
          allCategoryItems={allCategoryItems}
          allCategoriesNoteCount={allCategoriesNoteCount}
          categoryNoteGroups={categoryNoteGroups}
          allTagItems={allNoteItems}
          tagNoteGroups={tagNoteGroups}
          activeNoteId={editingNoteId}
          activeCategoryId={noteForm.selectedCategoryId}
          activeTagIds={noteForm.selectedTagIds}
          onEditNote={handleOpenNoteFromResults}
          onAddNoteForCategory={handleAddNoteForCategory}
          onAddNoteForTag={handleAddNoteForTag}
          onMoveNoteCategory={handleMoveNoteCategory}
          onMoveNoteTag={handleMoveNoteTag}
          onEditCategory={openEditCategory}
          onDeleteCategory={openDeleteCategory}
          onEditTag={openEditTag}
          onDeleteTag={openDeleteTag}
          onClose={handleMobileResultsOverlayClick}
        />
      </div>

      <EditCategoryModal
        category={editingCategory}
        label={editCategoryLabel}
        onLabelChange={setEditCategoryLabel}
        onClose={closeEditCategory}
        onSave={() => void handleSaveCategory()}
        pending={editCategoryPending}
      />

      <DeleteCategoryModal
        category={deletingCategory}
        onClose={closeDeleteCategory}
        onConfirm={() => void handleConfirmDeleteCategory()}
        pending={deleteCategoryPending}
      />

      <EditTagModal
        tag={editingTag}
        label={editTagLabel}
        onLabelChange={setEditTagLabel}
        onClose={closeEditTag}
        onSave={() => void handleSaveTag()}
        pending={editTagPending}
      />

      <DeleteTagModal
        tag={deletingTag}
        onClose={closeDeleteTag}
        onConfirm={() => void handleConfirmDeleteTag()}
        pending={deleteTagPending}
      />
    </div>
  )
}
