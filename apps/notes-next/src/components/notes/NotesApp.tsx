"use client"

import type {
  CategoriesResponse,
  CategoryRecord,
  CreateCategoryResponse,
  DeleteCategoryResponse,
  DeleteCategoryWithNotesResponse,
  TagsResponse,
  TagRecord,
  CreateTagResponse,
  DeleteTagResponse,
  EmbeddingMaintenanceResponse,
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
import { signIn, signOut, useSession } from "next-auth/react"
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
import {
  clearNotesCache,
  readNotesCache,
  updateNotesCacheList,
  updateNotesCacheUser,
  writeNotesCache,
} from "@/lib/notesCache"
import { useNotesAppStore } from "@/stores/notesAppStore"
import { FeedbackNotifications } from "./FeedbackNotifications"
import { NoteForm } from "./NoteForm"
import type { DisplayNoteItem } from "./NoteResultsList"
import { NotesHeader, type SignupFields } from "./NotesHeader"
import { ResultsColumn, type CategoryNoteGroup, type TagNoteGroup } from "./ResultsColumn"
import { DeleteCategoryModal, type DeleteCategoryAction } from "./modals/DeleteCategoryModal"
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
const NOTE_URL_ID_PARAM = "id"
const NOTE_URL_CATEGORY_PARAM = "category"
const NOTE_URL_TAGS_PARAM = "tags"

// A signed, short-lived token captured while the browser is still an anonymous
// session. It is stashed here across the sign-in transition (including an OAuth
// redirect) so the single post-login loader can merge the anonymous account.
const PENDING_MERGE_TOKEN_KEY = "notes-pending-merge-token"

const readPendingMergeToken = (): string | null => {
  if (typeof window === "undefined") return null
  try {
    return window.sessionStorage.getItem(PENDING_MERGE_TOKEN_KEY)
  } catch {
    return null
  }
}

const writePendingMergeToken = (token: string): void => {
  if (typeof window === "undefined") return
  try {
    window.sessionStorage.setItem(PENDING_MERGE_TOKEN_KEY, token)
  } catch {
    // Best-effort; if sessionStorage is unavailable the merge is simply skipped.
  }
}

const clearPendingMergeToken = (): void => {
  if (typeof window === "undefined") return
  try {
    window.sessionStorage.removeItem(PENDING_MERGE_TOKEN_KEY)
  } catch {
    // ignore
  }
}

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

const getDefaultCategoryId = (categoryList: CategoryRecord[]) =>
  categoryList.length > 0 ? categoryList.reduce((a, b) => (a.id < b.id ? a : b)).id : null

const getDefaultTagId = (tagList: TagRecord[]) =>
  tagList.length > 0 ? tagList.reduce((a, b) => (a.id < b.id ? a : b)).id : null

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

/**
 * How a save was triggered.
 *
 * - `manual`   — explicit submit; shows pending UI and resets to a fresh draft.
 * - `autosave` — debounced background save while the note stays open.
 * - `flush`    — forced save of the current note right before the editor is
 *   about to be replaced (navigating to another note, starting a new note,
 *   browser back/forward, leaving the page). Behaves silently like autosave but
 *   is awaited by the caller so the outgoing note is persisted before its draft
 *   is discarded.
 */
type NoteSaveMode = "manual" | "autosave" | "flush"

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

export default function NotesApp() {
  const { data: authSession, status: authStatus } = useSession()
  const [identifier, setIdentifier] = useState("")
  const [password, setPassword] = useState("")
  const [user, setUser] = useState<UserSummary | null>(null)
  const [userPreferences, setUserPreferences] = useState<UserPreferences>({})
  const [notes, setNotes] = useState<NoteRecord[]>([])
  const [categories, setCategories] = useState<CategoryRecord[]>([])
  const [tags, setTags] = useState<TagRecord[]>([])
  const fallbackCategoryId = getDefaultCategoryId(categories)
  const fallbackTagId = getDefaultTagId(tags)
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
    setNoteSaveStatus,
    descriptionEditorSessionId,
    bumpDescriptionEditorSessionId,
    pendingTagLabels,
    setPendingTagLabels,
    categoryInputValue,
    setCategoryInputValue,
    editorAutofocus,
    setEditorAutofocus,
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
  const [deleteCategoryPendingAction, setDeleteCategoryPendingAction] =
    useState<DeleteCategoryAction | null>(null)
  const [editingTag, setEditingTag] = useState<TagRecord | null>(null)
  const [editTagLabel, setEditTagLabel] = useState("")
  const [editTagPending, setEditTagPending] = useState(false)
  const [deletingTag, setDeletingTag] = useState<TagRecord | null>(null)
  const [deleteTagPending, setDeleteTagPending] = useState(false)
  const [preferredResultsColumnWidth, setPreferredResultsColumnWidth] = useState(
    RESULTS_COLUMN_DEFAULT_WIDTH,
  )
  const [editorRevealText, setEditorRevealText] = useState<string | null>(null)
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
  const noteSaveInFlightRef = useRef(false)
  // Guards the anonymous→real merge so a re-render mid-request cannot fire it
  // twice. The sessionStorage token removal is the primary idempotency guard;
  // this ref covers the in-flight window before that removal is observed.
  const mergeInFlightRef = useRef(false)
  const lastSavedNoteDraftRef = useRef<string | null>(null)
  // Stable handle to the latest flush implementation so handlers declared
  // before it (e.g. handleCancelEdit) can trigger a save without dependency or
  // declaration-order gymnastics.
  const flushPendingNoteSaveRef = useRef<() => Promise<void>>(() => Promise.resolve())
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
      const normalizedUser: UserSummary = { ...nextUser, preferences: nextPreferences }
      lastSavedPreferencesRef.current = serializeUserPreferences(nextPreferences)
      setUser(normalizedUser)
      setUserPreferences(nextPreferences)
      setPreferredResultsColumnWidth(nextPreferredResultsColumnWidth)
      setResultsColumnWidth(clampResultsColumnWidth(nextPreferredResultsColumnWidth))
      updateNotesCacheUser(normalizedUser.id, normalizedUser)
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
      setEditorAutofocus(true)
      bumpDescriptionEditorSessionId()
      setPendingTagLabels([])
    },
    [
      bumpDescriptionEditorSessionId,
      categories,
      setEditorAutofocus,
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
            setEditorAutofocus(true)
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
      setEditorAutofocus(true)
      bumpDescriptionEditorSessionId()
      setPendingTagLabels([])
      setNoteForm(nextForm)
      setCategoryInputValue(categoryLabel)
      setNotesUrlSelectionReady(true)
    },
    [
      bumpDescriptionEditorSessionId,
      setCategoryInputValue,
      setEditorAutofocus,
      setEditingNoteId,
      setNoteForm,
      setNotesUrlSelectionReady,
      setPendingTagLabels,
    ],
  )

  const handleCancelEdit = useCallback(async () => {
    // Leaving the current draft (header "+", "jot.new", or the cancel button)
    // must persist any unsaved edits before the editor is reset.
    await flushPendingNoteSaveRef.current()
    resetNoteForm({ selectedCategoryId: noteFormRef.current.selectedCategoryId })
  }, [resetNoteForm])

  const loadNotes = useCallback(async (userId: number) => {
    // Only show the blocking "Loading…" indicator on the cold path, when we
    // have nothing to display yet. Background refreshes (post-CRUD and the
    // stale-while-revalidate startup) should keep showing the existing data.
    const showLoadingIndicator = notesRef.current.length === 0
    if (showLoadingIndicator) setNotesLoading(true)
    try {
      const response = await fetch(`/api/notes?userId=${userId}`, { cache: "no-store" })
      const data = await readJson<NotesResponse>(response)
      setNotes(data.notes)
      updateNotesCacheList(userId, "notes", data.notes)
      return data.notes
    } finally {
      if (showLoadingIndicator) setNotesLoading(false)
    }
  }, [])

  const loadCategories = useCallback(async (userId: number) => {
    const response = await fetch(`/api/categories?userId=${userId}`, { cache: "no-store" })
    const data = await readJson<CategoriesResponse>(response)
    setCategories(data.categories)
    updateNotesCacheList(userId, "categories", data.categories)
    return data.categories
  }, [])

  const loadTags = useCallback(async (userId: number) => {
    const response = await fetch(`/api/tags?userId=${userId}`, { cache: "no-store" })
    const data = await readJson<TagsResponse>(response)
    setTags(data.tags)
    updateNotesCacheList(userId, "tags", data.tags)
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

    const fetchFreshSession = async (
      userId: string | number,
      { applyUser }: { applyUser: boolean },
    ) => {
      const sessionResponse = await fetch(`/api/session?userId=${userId}`, {
        cache: "no-store",
      })
      const sessionData = await readJson<SessionResponse>(sessionResponse)

      if (applyUser) {
        applyLoadedUser(sessionData.user)
      } else if (userRef.current?.id === sessionData.user.id) {
        // Background refresh path: keep the in-memory user/preferences so we
        // don't clobber any change the user just made before the debounce
        // saves it. We still refresh the cached snapshot below so the next
        // launch sees the latest server-side preferences (if no local edits
        // happen first).
        updateNotesCacheUser(sessionData.user.id, sessionData.user)
      }

      const [loadedNotes, loadedCategories, loadedTags] = await Promise.all([
        loadNotes(sessionData.user.id),
        loadCategories(sessionData.user.id),
        loadTags(sessionData.user.id),
      ])

      writeNotesCache({
        userId: sessionData.user.id,
        user: sessionData.user,
        notes: loadedNotes,
        categories: loadedCategories,
        tags: loadedTags,
      })

      return { sessionData, loadedNotes, loadedCategories, loadedTags }
    }

    const restoreSession = async () => {
      if (authStatus === "loading") {
        return
      }

      if (authStatus !== "authenticated" || !authSession?.user?.notesUserId) {
        window.localStorage.removeItem(STORAGE_KEY)
        setSessionLoading(false)
        return
      }

      const storedUserId = String(authSession.user.notesUserId)
      window.localStorage.setItem(STORAGE_KEY, storedUserId)
      const numericUserId = Number.parseInt(storedUserId, 10)

      // If the user just signed in from an anonymous session, merge that
      // visitor data into the real account *before* loading anything. Running
      // the merge here — inside the single post-login loader — guarantees the
      // data loaded below is always post-merge, so there is no window where a
      // stale pre-merge fetch can win a race.
      const pendingMergeToken =
        !authSession.user.isAnonymous && !mergeInFlightRef.current
          ? readPendingMergeToken()
          : null

      if (pendingMergeToken) {
        mergeInFlightRef.current = true
        clearPendingMergeToken()
        try {
          const mergeResponse = await fetch("/api/anon-session/merge", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mergeToken: pendingMergeToken }),
          })
          if (!mergeResponse.ok) {
            throw new Error(`Merge failed with status ${mergeResponse.status}`)
          }
        } catch {
          // The real sign-in stays successful; the visitor data remains on the
          // anonymous row for the cleanup script. Surface a recoverable warning
          // rather than failing silently.
          if (active) {
            setErrorMessage(
              "Signed in, but we couldn't move your visitor notes. They're still saved — try signing in again.",
            )
          }
        } finally {
          mergeInFlightRef.current = false
        }
      }

      // Skip the stale-while-revalidate cache paint when a merge just ran: the
      // cached snapshot predates the merge, so we load fresh post-merge data in
      // a single pass instead.
      const cachedSnapshot =
        !pendingMergeToken && Number.isInteger(numericUserId)
          ? readNotesCache(numericUserId)
          : null

      // Stale-while-revalidate. If we have a recent local snapshot for this
      // user, render the app immediately from cache and refresh in the
      // background. This is what removes the "Restoring session…" wait on the
      // PWA homescreen launch when the user has opened the app before.
      if (cachedSnapshot) {
        applyLoadedUser(cachedSnapshot.user)
        setNotes(cachedSnapshot.notes)
        setCategories(cachedSnapshot.categories)
        setTags(cachedSnapshot.tags)
        applyNotesUrlSelection({
          categoryList: cachedSnapshot.categories,
          noteList: cachedSnapshot.notes,
          tagList: cachedSnapshot.tags,
        })
        setSessionLoading(false)

        try {
          await fetchFreshSession(cachedSnapshot.userId, { applyUser: false })
        } catch {
          // Background refresh failure - user keeps the cached view. We do
          // NOT sign them out here, because the cause is most often a flaky
          // mobile connection rather than an invalid session. Subsequent
          // mutations will surface a real error if the session truly expired.
        }
        return
      }

      try {
        const result = await fetchFreshSession(storedUserId, { applyUser: true })
        if (!active) return

        applyNotesUrlSelection({
          categoryList: result.loadedCategories,
          noteList: result.loadedNotes,
          tagList: result.loadedTags,
        })
      } catch (error) {
        if (!active) return
        window.localStorage.removeItem(STORAGE_KEY)
        clearNotesCache()
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
    authSession?.user?.notesUserId,
    authSession?.user?.isAnonymous,
    authStatus,
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
          lastSavedPreferencesRef.current = serializeUserPreferences(nextPreferences)
          setUser({ ...data.user, preferences: nextPreferences })
          setUserPreferences(nextPreferences)
          setPreferredResultsColumnWidth(nextPreferredResultsColumnWidth)
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
      // Back/forward navigation swaps the open note via the URL, so flush the
      // current draft before the selection is applied.
      void flushPendingNoteSaveRef.current().finally(() => {
        applyNotesUrlSelection()
      })
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
      // Snapshot the editor *before* awaiting anything. Navigation flushes call
      // this synchronously right before they replace the editor state, so the
      // snapshot has to capture the outgoing note rather than whatever the refs
      // hold once control returns from an await.
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

      if (mode !== "manual") {
        // Nothing worth persisting, or the snapshot already matches the server.
        if (formSnapshot.description.trim() === "") return
        if (draftSignature === lastSavedNoteDraftRef.current) return
      }

      // Serialize saves. A `flush` must wait for the in-flight save and then run
      // (its captured snapshot may be newer); a background `autosave` can simply
      // mark itself queued and let the in-flight save re-trigger it on completion.
      if (noteSavePromiseRef.current) {
        if (mode === "autosave") {
          queuedAutosaveRef.current = true
          return
        }

        await noteSavePromiseRef.current.catch(() => undefined)

        // The in-flight save may have already persisted this exact snapshot.
        if (mode === "flush" && draftSignature === lastSavedNoteDraftRef.current) return
      }

      if (mode === "manual") {
        clearMessages()
        setNotePending(true)
      }

      noteSaveInFlightRef.current = true
      setNoteSaveStatus("saving")

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

        const { latestCategories } = await refreshResults(currentUser.id)

        const savedNoteId = data.note.id

        if (mode === "manual") {
          lastSavedNoteDraftRef.current = serializeNoteDraft(savedNoteId, formSnapshot)
          resetNoteForm({ categoryList: latestCategories })
          setStatusMessage(noteId === null ? "Note created." : "Note updated.")
          return
        }

        // Autosave / flush. Only touch the live editor state when it still
        // refers to the note we just saved — a flush may have run while the user
        // was already moving on to a different note.
        const stillEditingSavedNote =
          editingNoteIdRef.current === noteId ||
          (noteId === null && editingNoteIdRef.current === null)

        if (stillEditingSavedNote) {
          lastSavedNoteDraftRef.current = serializeNoteDraft(savedNoteId, formSnapshot)

          const currentForm = noteFormRef.current
          if (
            noteId === null &&
            editingNoteIdRef.current === null &&
            currentForm.description.trim() !== ""
          ) {
            editingNoteIdRef.current = savedNoteId
            setEditingNoteId(savedNoteId)
          }
        }
      })()

      noteSavePromiseRef.current = savePromise

      try {
        await savePromise
        if (userRef.current?.id === currentUser.id) {
          // Reflect whatever the editor holds now: typing during the request may
          // have made it dirty again (a queued autosave will follow).
          const liveSignature = serializeNoteDraft(editingNoteIdRef.current, noteFormRef.current)
          setNoteSaveStatus(liveSignature === lastSavedNoteDraftRef.current ? "saved" : "unsaved")
        }
      } catch (error) {
        if (userRef.current?.id === currentUser.id) {
          setErrorMessage(getErrorMessage(error))
          setNoteSaveStatus("error")
        }
      } finally {
        if (noteSavePromiseRef.current === savePromise) {
          noteSavePromiseRef.current = null
          noteSaveInFlightRef.current = false
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
    [clearMessages, refreshResults, resetNoteForm, setEditingNoteId, setNoteSaveStatus],
  )

  // Persist the current note immediately, used right before the editor is about
  // to be replaced. Resolves once the outgoing note is safely saved (or there
  // was nothing to save), so callers can await it before swapping in new state.
  const flushPendingNoteSave = useCallback(async () => {
    await saveCurrentNote("flush")
  }, [saveCurrentNote])

  flushPendingNoteSaveRef.current = flushPendingNoteSave

  // Debounced background autosave while the note stays open. Trailing debounce:
  // it only fires once the user pauses for NOTE_AUTOSAVE_DEBOUNCE_MS, and the
  // signature check below skips the request entirely when nothing changed.
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

  // Keep the save indicator in sync with the editor whenever a save is not
  // actively running (the save routine owns the status while in flight).
  useEffect(() => {
    if (!user) return
    if (noteSaveInFlightRef.current) return

    if (noteForm.description.trim() === "" && editingNoteId === null) {
      setNoteSaveStatus("idle")
      return
    }

    const draftSignature = serializeNoteDraft(editingNoteId, noteForm)
    setNoteSaveStatus(draftSignature === lastSavedNoteDraftRef.current ? "saved" : "unsaved")
  }, [editingNoteId, noteForm, setNoteSaveStatus, user])

  // Best-effort save when the tab is being hidden or torn down. The awaited
  // flushes above cannot run during an unload, so we fire a keepalive request
  // (which the browser allows to outlive the page) for any unsaved draft. This
  // closes the gap where an abrupt close happens inside the autosave debounce.
  useEffect(() => {
    if (!user) return

    const flushOnExit = () => {
      const currentUser = userRef.current
      if (!currentUser) return

      const form = noteFormRef.current
      if (form.description.trim() === "") return
      if (form.selectedCategoryId === null) return

      const noteId = editingNoteIdRef.current
      const draftSignature = serializeNoteDraft(noteId, form)
      if (draftSignature === lastSavedNoteDraftRef.current) return

      // Mark as persisted optimistically so we don't fire duplicate requests if
      // multiple exit events fire in a row.
      lastSavedNoteDraftRef.current = draftSignature
      const requestBody =
        noteId === null
          ? { userId: currentUser.id, note: noteRequestBody(form) }
          : { userId: currentUser.id, noteId, note: noteRequestBody(form) }

      try {
        void fetch("/api/notes", {
          method: noteId === null ? "POST" : "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestBody),
          keepalive: true,
        }).catch(() => undefined)
      } catch {
        // Ignore — this is a best-effort save during teardown.
      }
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        flushOnExit()
      }
    }

    window.addEventListener("pagehide", flushOnExit)
    document.addEventListener("visibilitychange", handleVisibilityChange)
    return () => {
      window.removeEventListener("pagehide", flushOnExit)
      document.removeEventListener("visibilitychange", handleVisibilityChange)
    }
  }, [user])

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
      // Persist any unsaved edits to the anonymous account before the session
      // changes, otherwise the outgoing draft never reaches the DB and the
      // merge below cannot move it.
      await flushPendingNoteSave()

      // While still anonymous, capture a signed merge token and stash it across
      // the sign-in transition. The single post-login loader (restoreSession)
      // performs the merge and the reload, so there is exactly one writer of
      // session data — no race.
      if (authSession?.user?.isAnonymous && authSession.user.notesUserId) {
        try {
          const tokenResponse = await fetch("/api/anon-session/merge-token", {
            method: "POST",
          })
          if (tokenResponse.ok) {
            const tokenData = (await tokenResponse.json()) as { mergeToken: string }
            writePendingMergeToken(tokenData.mergeToken)
          }
        } catch {
          // Continue with sign-in even if merge-token capture fails.
        }
      }

      const result = await signIn("credentials", {
        identifier,
        password,
        redirect: false,
      })

      if (result?.error) {
        // Sign-in failed; the session is still anonymous. Drop the stashed
        // token so it is not applied on a later unrelated render.
        clearPendingMergeToken()
        setErrorMessage("Unable to sign in. Check your identifier and password.")
        return
      }

      // A successful sign-in flips authSession to the real user, which re-runs
      // restoreSession. Show the loading state so the merge + single reload is
      // not interleaved with a flash of the outgoing anonymous data.
      setSessionLoading(true)
      setIdentifier("")
      setPassword("")
    } catch (error) {
      setErrorMessage(getErrorMessage(error))
    } finally {
      setAuthPending(false)
    }
  }

  const handleSignup = async (fields: SignupFields) => {
    clearMessages()
    setAuthPending(true)
    try {
      // Persist any unsaved edits before the claim. The data stays on the same
      // user row, but the debounced autosave must not fire mid-transition.
      await flushPendingNoteSave()

      // Claim the anonymous row in place: same user_id, identity + password set,
      // is_anonymous flipped to false. Nothing moves between users, so there is
      // no merge token and no race in this path.
      const claimResponse = await fetch("/api/anon-session/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: fields.username,
          email: fields.email.trim() === "" ? undefined : fields.email,
          password: fields.password,
        }),
      })

      if (!claimResponse.ok) {
        if (claimResponse.status === 409) {
          setErrorMessage(
            "That username or email is already taken — sign in instead to keep your notes.",
          )
        } else {
          const body = (await claimResponse.json().catch(() => null)) as
            | { error?: string }
            | null
          setErrorMessage(body?.error ?? "Unable to create the account. Try again.")
        }
        return
      }

      // Apply the claimed identity to state and the local cache now. The
      // restoreSession re-run below takes the cache-first branch (same user id,
      // no merge token) and its background refresh keeps the in-memory user, so
      // without this the header would show the old anon-* username until a
      // full reload.
      const claimData = (await claimResponse.json()) as SessionResponse
      applyLoadedUser(claimData.user)

      // Re-mint the JWT for the same user id so isAnonymous flips to false.
      const result = await signIn("credentials", {
        identifier: fields.username,
        password: fields.password,
        redirect: false,
      })

      if (result?.error) {
        // The account is already claimed; only the session refresh failed.
        setErrorMessage(
          "Account created — sign in with your new username and password.",
        )
        return
      }

      // restoreSession re-fires (isAnonymous flipped) and refreshes the same
      // account's data. No merge token is pending, so it is a plain reload.
      setStatusMessage("Account created. Your notes are saved to it.")
    } catch (error) {
      setErrorMessage(getErrorMessage(error))
    } finally {
      setAuthPending(false)
    }
  }

  const handleLogout = async () => {
    // Persist any unsaved edits for the current user before tearing down the
    // session.
    await flushPendingNoteSave()
    await signOut({ redirect: false })
    window.localStorage.removeItem(STORAGE_KEY)
    clearNotesCache()
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
    setEditorRevealText(null)
    setResultsColumnWidth(RESULTS_COLUMN_DEFAULT_WIDTH)
    resetNoteForm({ categoryList: [] })
    clearMessages()
  }

  const handleStartEdit = async (note: NoteRecord) => {
    // Opening a different note replaces the editor, so persist the outgoing
    // note's unsaved edits first.
    if (editingNoteIdRef.current !== note.id) {
      await flushPendingNoteSave()
    }
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
    setEditorAutofocus(!isMobileResultsLayout())
    setEditorRevealText(searchMode ? trimmedSearchQuery : null)
    void handleStartEdit(note)
    closeResultsListOnMobile()
  }

  const handleAddNoteForCategory = async (category: CategoryRecord) => {
    await flushPendingNoteSave()
    clearMessages()
    resetNoteForm({ selectedCategoryId: category.id })
    setCategoryInputValue(category.label)
    closeResultsListOnMobile()
  }

  const handleAddNoteForTag = async (tag: TagRecord) => {
    await flushPendingNoteSave()
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

  const performDeleteCategoryKeepUncategorized = async (category: CategoryRecord) => {
    if (!user) return
    clearMessages()
    setDeleteCategoryPendingAction("keep-uncategorized")
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
      setDeleteCategoryPendingAction(null)
    }
  }

  const performDeleteCategoryWithNotes = async (category: CategoryRecord) => {
    if (!user) return
    clearMessages()
    setDeleteCategoryPendingAction("delete-notes")
    try {
      const response = await fetch("/api/categories/with-notes", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: user.id,
          categoryId: category.id,
        }),
      })
      const result = await readJson<DeleteCategoryWithNotesResponse>(response)
      await refreshResults(user.id)
      const deletedNotes = result.deletedNotes
      setStatusMessage(
        deletedNotes > 0
          ? `Category “${category.label}” and ${deletedNotes} ${deletedNotes === 1 ? "note" : "notes"} deleted.`
          : `Category “${category.label}” deleted.`,
      )
      setDeletingCategory(null)
    } catch (error) {
      setErrorMessage(getErrorMessage(error))
    } finally {
      setDeleteCategoryPendingAction(null)
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
    setDeletingCategory(category)
  }

  const closeDeleteCategory = () => {
    if (deleteCategoryPendingAction !== null) return
    setDeletingCategory(null)
  }

  const handleDeleteCategoryWithNotes = async () => {
    if (!deletingCategory) return
    await performDeleteCategoryWithNotes(deletingCategory)
  }

  const handleDeleteCategoryKeepUncategorized = async () => {
    if (!deletingCategory) return
    await performDeleteCategoryKeepUncategorized(deletingCategory)
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
    if (tag.id === fallbackTagId) {
      setErrorMessage("The default tag cannot be deleted.")
      return
    }
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
      // Use the ref so we read the live editor note after the async delete, not the
      // stale closure value from when delete started (user may have switched notes).
      if (editingNoteIdRef.current === noteId) {
        resetNoteForm({
          categoryList: latestCategories,
          selectedCategoryId: noteFormRef.current.selectedCategoryId,
        })
      }
      setStatusMessage("Note deleted.")
    } catch (error) {
      setErrorMessage(getErrorMessage(error))
    } finally {
      setDeletingNoteId(null)
    }
  }

  // Auto-create anonymous session if unauthenticated
  useEffect(() => {
    if (authStatus === "unauthenticated") {
      void signIn("anonymous", { redirect: false })
    }
  }, [authStatus])

  if (authStatus === "loading" || sessionLoading || !user) {
    return (
      <div className={styles.page}>
        <Text variant="body-1" color="secondary">
          Loading…
        </Text>
      </div>
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
          userPresent={Boolean(user)}
          categories={categories}
          tags={tags}
          pendingTagLabels={pendingTagLabels}
          descriptionEditorSessionId={descriptionEditorSessionId}
          editorAutofocus={editorAutofocus}
          editorRevealText={editorRevealText}
          categoryInputValue={categoryInputValue}
          onCategoryInputValueChange={setCategoryInputValue}
          createCategoryPending={createCategoryPending}
          createTagPending={createTagPending}
          onSelectCategoryId={handleSelectCategory}
          onCreateCategory={handleCreateCategory}
          onTagValuesChange={handleTagValuesChange}
          onSubmit={handleSaveNote}
          onCancelEdit={handleCancelEdit}
          onDeleteEditingNote={() => {
            if (editingNoteId !== null) {
              void handleDeleteNote(editingNoteId)
            }
          }}
          header={
            <div className={`${styles.header} ${styles.headerLeft}`}>
              <NotesHeader
                user={user}
                isAnonymous={authSession?.user?.isAnonymous ?? false}
                resultsListVisible={resultsListVisible}
                onAddNote={handleCancelEdit}
                onLogout={handleLogout}
                embeddingMaintenancePending={embeddingMaintenancePending}
                onRunEmbeddingMaintenance={(mode) => void handleRunEmbeddingMaintenance(mode)}
                identifier={identifier}
                password={password}
                onIdentifierChange={setIdentifier}
                onPasswordChange={setPassword}
                onLoginSubmit={handleLogin}
                onSignupSubmit={(fields) => void handleSignup(fields)}
                authPending={authPending}
                loginErrorMessage={authPending ? null : errorMessage}
                onDismissLoginError={() => setErrorMessage(null)}
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
          fallbackTagId={fallbackTagId}
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
          onDeleteNote={(noteId) => void handleDeleteNote(noteId)}
          deletingNoteId={deletingNoteId}
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
        onDeleteWithNotes={() => void handleDeleteCategoryWithNotes()}
        onKeepUncategorized={() => void handleDeleteCategoryKeepUncategorized()}
        pendingAction={deleteCategoryPendingAction}
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
