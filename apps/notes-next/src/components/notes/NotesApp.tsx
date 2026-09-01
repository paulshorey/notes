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
} from "@lib/db-notes"
import { NOTES_APP_SEARCH_MAX_RESULTS } from "@lib/db-notes/notes-search-constants"
import {
  type CSSProperties,
  type Dispatch,
  type FormEvent,
  type PointerEvent,
  type SetStateAction,
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
import { useOpenNotesAutosave } from "@/hooks/useOpenNotesAutosave"
import {
  isSaveableForm,
  noteRequestBody,
  serializeNoteDraft,
  snapshotNoteForm,
} from "@/lib/noteDraft"
import {
  clearNotesCache,
  readNotesCache,
  updateNotesCacheList,
  updateNotesCacheUser,
  writeNotesCache,
} from "@/lib/notesCache"
import {
  clearOpenNotesSnapshot,
  readOpenNotesSnapshot,
  readOpenNotesSnapshotForAnyUser,
  reconcileOpenNotes,
  writeOpenNotesSnapshot,
} from "@/lib/openNotesStorage"
import {
  clampMaxOpenNotes,
  MAX_OPEN_NOTES_DEFAULT,
  noteEntryKey,
  type OpenNoteEntry,
  type OpenNoteKey,
} from "@/stores/openNotes"
import { selectActiveEntry, useNotesAppStore } from "@/stores/notesAppStore"
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
const PREFERENCES_SAVE_DEBOUNCE_MS = 500
const OPEN_NOTES_PERSIST_DEBOUNCE_MS = 1000
const TAXONOMY_REFRESH_DEBOUNCE_MS = 4000
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

const getPasteUrlAsMarkdownPreference = (preferences: UserPreferences) => {
  const notesAppPreferences = preferences.notesApp
  if (!isPreferencesObject(notesAppPreferences)) return false

  return notesAppPreferences.pasteUrlAsMarkdown === true
}

const withPasteUrlAsMarkdownPreference = (
  preferences: UserPreferences,
  enabled: boolean,
): UserPreferences => ({
  ...preferences,
  notesApp: {
    ...(isPreferencesObject(preferences.notesApp) ? preferences.notesApp : {}),
    pasteUrlAsMarkdown: enabled,
  },
})

const getMaxOpenNotesPreference = (preferences: UserPreferences) => {
  const notesAppPreferences = preferences.notesApp
  if (!isPreferencesObject(notesAppPreferences)) return MAX_OPEN_NOTES_DEFAULT

  const value = notesAppPreferences.maxOpenNotes
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return MAX_OPEN_NOTES_DEFAULT
  }

  return clampMaxOpenNotes(value)
}

const withMaxOpenNotesPreference = (
  preferences: UserPreferences,
  value: number,
): UserPreferences => ({
  ...preferences,
  notesApp: {
    ...(isPreferencesObject(preferences.notesApp) ? preferences.notesApp : {}),
    maxOpenNotes: clampMaxOpenNotes(value),
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

/**
 * How a save was triggered. All three are silent — the editor has no submit
 * control, so every save is a background save.
 *
 * - `autosave` — debounced background save while the note stays open.
 * - `flush`    — forced save awaited by the caller, used before the session
 *   is torn down (sign-in, sign-up, sign-out) so nothing is lost in transit.
 * - `detached` — save of an entry that has already left the ring, by eviction,
 *   close, or a lowered cap. Never touches store state, since there is no
 *   longer a slot to write back to.
 */
type NoteSaveMode = "autosave" | "flush" | "detached"

/**
 * A dirty entry that left the ring but whose text still has to reach the
 * server. `savedSignature` tracks what has already landed for it, because a
 * save that completes after the entry is gone has no store slot to write to.
 */
interface DetachedSave {
  noteId: number | null
  form: NoteFormState
  savedSignature: string | null
}

const entrySignature = (entry: OpenNoteEntry) => serializeNoteDraft(entry.noteId, entry.form)

// Stable identities so an empty ring does not remount the editor every render.
const EMPTY_NOTE_FORM: NoteFormState = createDefaultNoteForm()
const EMPTY_PENDING_TAG_LABELS: string[] = []

const isEntryDirty = (entry: OpenNoteEntry) => entrySignature(entry) !== entry.savedSignature

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
  // Selector subscriptions rather than a bulk destructure: with a ring of open
  // notes, subscribing to the whole store would re-render the entire app —
  // editor included — on every keystroke in any entry.
  const resultsListVisible = useNotesAppStore((state) => state.resultsListVisible)
  const setResultsListVisible = useNotesAppStore((state) => state.setResultsListVisible)
  const selectedTagId = useNotesAppStore((state) => state.selectedTagId)
  const setSelectedTagId = useNotesAppStore((state) => state.setSelectedTagId)
  const searchQuery = useNotesAppStore((state) => state.searchQuery)
  const setSearchQuery = useNotesAppStore((state) => state.setSearchQuery)
  const openNotes = useNotesAppStore((state) => state.openNotes)
  const activeKey = useNotesAppStore((state) => state.activeKey)
  const activeEntry = useNotesAppStore(selectActiveEntry)
  const maxOpenNotes = useNotesAppStore((state) => state.maxOpenNotes)
  const setMaxOpenNotesInStore = useNotesAppStore((state) => state.setMaxOpenNotes)
  const openExistingNoteInStore = useNotesAppStore((state) => state.openExistingNote)
  const openNewDraftInStore = useNotesAppStore((state) => state.openNewDraft)
  const activateEntryInStore = useNotesAppStore((state) => state.activateEntry)
  const closeEntryInStore = useNotesAppStore((state) => state.closeEntry)
  const closeEntriesForNoteInStore = useNotesAppStore((state) => state.closeEntriesForNote)
  const patchEntry = useNotesAppStore((state) => state.patchEntry)
  const patchEntryForm = useNotesAppStore((state) => state.patchEntryForm)
  const patchEveryEntry = useNotesAppStore((state) => state.patchEveryEntry)
  const replaceOpenNotes = useNotesAppStore((state) => state.replaceOpenNotes)
  const resetNotesAppStore = useNotesAppStore((state) => state.resetDefaultState)
  const [searchResults, setSearchResults] = useState<SearchResponse["results"]>([])
  const [sessionLoading, setSessionLoading] = useState(true)
  const [notesUrlSelectionReady, setNotesUrlSelectionReady] = useState(false)
  const [notesLoading, setNotesLoading] = useState(false)
  const [searchLoading, setSearchLoading] = useState(false)
  const [authPending, setAuthPending] = useState(false)
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
  const [resultsColumnWidth, setResultsColumnWidth] = useState(RESULTS_COLUMN_DEFAULT_WIDTH)
  const [mobileResultsOverlayMounted, setMobileResultsOverlayMounted] = useState(false)
  const contentRef = useRef<HTMLDivElement | null>(null)
  const userRef = useRef<UserSummary | null>(null)
  const userPreferencesRef = useRef<UserPreferences>({})
  const notesRef = useRef<NoteRecord[]>(notes)
  const categoriesRef = useRef<CategoryRecord[]>(categories)
  const tagsRef = useRef<TagRecord[]>(tags)
  // Saves are keyed by entry, so two notes can be in flight at once while a
  // second save of the *same* note still queues behind the first.
  const saveInFlightRef = useRef(new Map<OpenNoteKey, Promise<void>>())
  const queuedAutosaveKeysRef = useRef(new Set<OpenNoteKey>())
  // Entries that left the ring while dirty. Their request still has to land,
  // and the exit keepalive has to know about them.
  const detachedSavesRef = useRef(new Map<OpenNoteKey, DetachedSave>())
  // Guards the anonymous→real merge so a re-render mid-request cannot fire it
  // twice. The sessionStorage token removal is the primary idempotency guard;
  // this ref covers the in-flight window before that removal is observed.
  const mergeInFlightRef = useRef(false)
  const didRehydrateOpenNotesRef = useRef(false)
  const openNotesPersistTimeoutRef = useRef<number | null>(null)
  const taxonomyRefreshTimeoutRef = useRef<number | null>(null)
  // Stable handle to the latest flush implementation so handlers declared
  // before it can trigger a save without declaration-order gymnastics.
  const flushAllPendingSavesRef = useRef<() => Promise<boolean>>(() => Promise.resolve(true))
  const saveEntryRef = useRef<(key: OpenNoteKey, mode: NoteSaveMode) => Promise<boolean>>(() =>
    Promise.resolve(true),
  )
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

  const pasteUrlAsMarkdown = getPasteUrlAsMarkdownPreference(userPreferences)
  const preferredMaxOpenNotes = getMaxOpenNotesPreference(userPreferences)

  // Mirror the saved preference into the store so the ring actions can enforce
  // it without it being threaded through every call site.
  useEffect(() => {
    if (preferredMaxOpenNotes === useNotesAppStore.getState().maxOpenNotes) return
    detachRemovedEntriesRef.current(setMaxOpenNotesInStore(preferredMaxOpenNotes))
  }, [preferredMaxOpenNotes, setMaxOpenNotesInStore])

  const handlePasteUrlAsMarkdownChange = useCallback((enabled: boolean) => {
    setUserPreferences((current) =>
      getPasteUrlAsMarkdownPreference(current) === enabled
        ? current
        : withPasteUrlAsMarkdownPreference(current, enabled),
    )
  }, [])

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
    userPreferencesRef.current = userPreferences
  }, [userPreferences])

  useEffect(() => {
    const handleWindowResize = () => {
      setResultsColumnWidth(clampResultsColumnWidth(preferredResultsColumnWidth))
    }

    window.addEventListener("resize", handleWindowResize)
    return () => window.removeEventListener("resize", handleWindowResize)
  }, [clampResultsColumnWidth, preferredResultsColumnWidth])

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

  /**
   * Send a dirty entry that has left the ring off to the server anyway. Used by
   * eviction, explicit close, and a lowered cap — the three ways a draft can
   * stop being visible while still holding unsaved text.
   */
  const detachRemovedEntries = useCallback<(removed: OpenNoteEntry[]) => void>((removed) => {
    for (const entry of removed) {
      if (!isEntryDirty(entry) || !isSaveableForm(entry.form)) continue

      detachedSavesRef.current.set(entry.key, {
        noteId: entry.noteId,
        form: snapshotNoteForm(entry.form),
        savedSignature: entry.savedSignature,
      })
      void saveEntryRef.current(entry.key, "detached")
    }
  }, [])

  const detachRemovedEntriesRef = useRef(detachRemovedEntries)
  detachRemovedEntriesRef.current = detachRemovedEntries

  const openNoteEntry = useCallback(
    (note: NoteRecord) => {
      // A detached record for this key means the note was evicted while dirty
      // and its save has not landed. The record holds newer text than the
      // server copy `note` carries, so the reopened entry must adopt it —
      // otherwise the editor shows stale text and the next keystroke saves
      // over what the user wrote.
      const key = noteEntryKey(note.id)
      const detached = detachedSavesRef.current.get(key)

      detachRemovedEntries(openExistingNoteInStore(note))

      if (!detached) return

      // Ownership returns to the ring. Any still in-flight save is keyed the
      // same way, so it writes its result back into this entry.
      detachedSavesRef.current.delete(key)
      patchEntry(key, {
        form: detached.form,
        savedSignature: detached.savedSignature,
      })
    },
    [detachRemovedEntries, openExistingNoteInStore, patchEntry],
  )

  const openDraftEntry = useCallback(
    (options: { categoryId?: number | null; tagIds?: number[]; categoryLabel?: string } = {}) => {
      detachRemovedEntries(openNewDraftInStore(options))
    },
    [detachRemovedEntries, openNewDraftInStore],
  )

  /**
   * Rebuild the ring from the persisted snapshot, reconciled against the notes
   * that actually exist. Safe to run twice — see the two-pass call in
   * `restoreSession`.
   */
  const rehydrateOpenNotes = useCallback(
    (
      userId: number,
      {
        noteList,
        categoryList,
        tagList,
        pendingMerge,
        force = false,
      }: {
        noteList: NoteRecord[]
        categoryList: CategoryRecord[]
        tagList: TagRecord[]
        pendingMerge: boolean
        force?: boolean
      },
    ) => {
      if (didRehydrateOpenNotesRef.current && !force) return

      const snapshot = readOpenNotesSnapshot(userId)

      // A merge changes the acting user id, so the snapshot is keyed to the old
      // anonymous account. Note rows are reparented and keep their ids, but
      // categories and tags are dedup-remapped, so re-key the snapshot and let
      // reconciliation repair the references. `handleLogin` already flushed
      // everything, so nothing here is unsaved.
      const usable =
        snapshot ?? (pendingMerge ? readOpenNotesSnapshotForAnyUser(userId) : null)

      didRehydrateOpenNotesRef.current = true

      if (!usable) return

      const notesById = new Map(noteList.map((note) => [note.id, note]))
      const categoryIds = new Set(categoryList.map((category) => category.id))
      const tagIds = new Set(tagList.map((tag) => tag.id))

      const { state, orphanedDraftCount } = reconcileOpenNotes(
        usable,
        (noteId) => notesById.get(noteId),
        {
          categoryExists: (categoryId) => categoryIds.has(categoryId),
          tagExists: (tagId) => tagIds.has(tagId),
          fallbackCategoryId: getDefaultCategoryId(categoryList),
        },
      )

      if (state.openNotes.length === 0) return

      replaceOpenNotes(state)

      if (orphanedDraftCount > 0) {
        setStatusMessage(
          orphanedDraftCount === 1
            ? "A note you were editing was deleted elsewhere. Your unsaved text was kept as a new note."
            : `${orphanedDraftCount} notes you were editing were deleted elsewhere. Your unsaved text was kept as new notes.`,
        )
      }
    },
    [replaceOpenNotes],
  )

  /**
   * Apply `?id=`, `?category=`, and `?tags=` on top of whatever the ring
   * already holds. The URL decides which entry is *active*; it never replaces
   * an entry's content, so a restored draft survives a reload that names it.
   */
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
      const store = useNotesAppStore.getState()

      if (selection.noteId !== null) {
        const note = noteList.find((item) => item.id === selection.noteId)
        if (note) {
          // openExistingNote keeps the in-memory draft when the note is already
          // open, so this activates without clobbering unsaved text.
          openNoteEntry(note)
          setNotesUrlSelectionReady(true)
          return
        }
      }

      if (store.activeKey !== null) {
        setNotesUrlSelectionReady(true)
        return
      }

      const validTagIds = selection.tagIds.filter((tagId) =>
        tagList.some((tag) => tag.id === tagId),
      )
      const categoryId =
        selection.categoryId !== null &&
        categoryList.some((category) => category.id === selection.categoryId)
          ? selection.categoryId
          : getDefaultCategoryId(categoryList)

      openDraftEntry({
        categoryId,
        tagIds: validTagIds,
        categoryLabel:
          categoryId === null
            ? ""
            : (categoryList.find((category) => category.id === categoryId)?.label ?? ""),
      })
      setNotesUrlSelectionReady(true)
    },
    [openDraftEntry, openNoteEntry],
  )

  const handleCancelEdit = useCallback(() => {
    // Adds a draft alongside the open notes rather than replacing one. The
    // outgoing entry keeps autosaving in the background, so there is nothing
    // to await here.
    clearMessages()
    openDraftEntry({
      categoryId:
        useNotesAppStore.getState().openNotes.find((entry) => entry.key === activeKey)?.form
          .selectedCategoryId ?? getDefaultCategoryId(categoriesRef.current),
    })
  }, [activeKey, clearMessages, openDraftEntry])

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

      // On the cache-first path the in-memory preferences came from a snapshot
      // that can be arbitrarily old. Whether the fresh server copy may replace
      // them turns on one question: has the user changed a preference that the
      // debounced PATCH has not saved yet?
      const hasUnsavedPreferenceEdit =
        serializeUserPreferences(userPreferencesRef.current) !==
        lastSavedPreferencesRef.current

      let userForCache = sessionData.user

      if (applyUser) {
        applyLoadedUser(sessionData.user)
      } else if (userRef.current?.id === sessionData.user.id) {
        if (hasUnsavedPreferenceEdit) {
          // Keep the local edit and cache it, so a reload before the PATCH
          // lands does not silently undo what the user just set.
          userForCache = { ...sessionData.user, preferences: userPreferencesRef.current }
        } else {
          // Nothing local to protect, so adopt the server copy now. Without
          // this the stale cached preferences survive the whole session and a
          // change made in another tab (or just before the last reload) takes
          // two reloads to appear.
          applyLoadedUser(sessionData.user)
        }
        updateNotesCacheUser(sessionData.user.id, userForCache)
      }

      const [loadedNotes, loadedCategories, loadedTags] = await Promise.all([
        loadNotes(sessionData.user.id),
        loadCategories(sessionData.user.id),
        loadTags(sessionData.user.id),
      ])

      writeNotesCache({
        userId: sessionData.user.id,
        user: userForCache,
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
        !authSession.user.isAnonymous && !mergeInFlightRef.current ? readPendingMergeToken() : null

      if (pendingMergeToken) {
        mergeInFlightRef.current = true
        clearPendingMergeToken()
        try {
          let mergeResponse: Response | null = null
          try {
            mergeResponse = await fetch("/api/anon-session/merge", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ mergeToken: pendingMergeToken }),
            })
          } catch {
            // Network failure — handled as retryable below.
          }

          if (!mergeResponse || !mergeResponse.ok) {
            // The real sign-in stays successful; the visitor data remains on
            // the anonymous row for the cleanup script. Surface a warning
            // rather than failing silently — and make retry actually work
            // where it can: transient failures (network, 5xx) re-stash the
            // token so the next restoreSession run (e.g. a page reload,
            // within the token's 10-minute TTL) retries the merge. A 4xx
            // means the token or the anonymous row is no longer valid, so a
            // retry cannot succeed and the token stays cleared.
            const retryable = !mergeResponse || mergeResponse.status >= 500
            if (retryable) {
              writePendingMergeToken(pendingMergeToken)
            }
            if (active) {
              setErrorMessage(
                retryable
                  ? "Signed in, but we couldn't move your visitor notes yet. Reload the page to try again."
                  : "Signed in, but your visitor notes couldn't be transferred to this account.",
              )
            }
          }
        } finally {
          mergeInFlightRef.current = false
        }
      }

      // Skip the stale-while-revalidate cache paint when a merge just ran: the
      // cached snapshot predates the merge, so we load fresh post-merge data in
      // a single pass instead.
      const cachedSnapshot =
        !pendingMergeToken && Number.isInteger(numericUserId) ? readNotesCache(numericUserId) : null

      // Stale-while-revalidate. If we have a recent local snapshot for this
      // user, render the app immediately from cache and refresh in the
      // background. This is what removes the "Restoring session…" wait on the
      // PWA homescreen launch when the user has opened the app before.
      if (cachedSnapshot) {
        applyLoadedUser(cachedSnapshot.user)
        setNotes(cachedSnapshot.notes)
        setCategories(cachedSnapshot.categories)
        setTags(cachedSnapshot.tags)
        // Reconcile against the cached list so the ring paints immediately…
        rehydrateOpenNotes(cachedSnapshot.userId, {
          noteList: cachedSnapshot.notes,
          categoryList: cachedSnapshot.categories,
          tagList: cachedSnapshot.tags,
          pendingMerge: Boolean(pendingMergeToken),
        })
        applyNotesUrlSelection({
          categoryList: cachedSnapshot.categories,
          noteList: cachedSnapshot.notes,
          tagList: cachedSnapshot.tags,
        })
        setSessionLoading(false)

        try {
          const refreshed = await fetchFreshSession(cachedSnapshot.userId, { applyUser: false })
          if (!active) return
          // …then again once the real data lands. The cached list can be up to
          // two weeks old, so it cannot be trusted to say whether a note still
          // exists. Reconciling is idempotent and never touches a dirty entry,
          // so the second pass only corrects clean ones.
          rehydrateOpenNotes(cachedSnapshot.userId, {
            noteList: refreshed.loadedNotes,
            categoryList: refreshed.loadedCategories,
            tagList: refreshed.loadedTags,
            pendingMerge: false,
            force: true,
          })
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

        rehydrateOpenNotes(result.sessionData.user.id, {
          noteList: result.loadedNotes,
          categoryList: result.loadedCategories,
          tagList: result.loadedTags,
          pendingMerge: Boolean(pendingMergeToken),
        })
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
        clearOpenNotesSnapshot()
        detachedSavesRef.current.clear()
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
    rehydrateOpenNotes,
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
          // Also refresh the cached snapshot. The next launch paints from that
          // cache and its background refresh runs with applyUser: false, so a
          // stale copy here would show the old preference for a whole session.
          updateNotesCacheUser(data.user.id, { ...data.user, preferences: nextPreferences })
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

    // Mirrors the *active* entry so the address bar stays copy-pasteable.
    writeNotesUrlSelection({
      noteId: activeEntry?.noteId ?? null,
      categoryId: activeEntry?.form.selectedCategoryId ?? null,
      tagIds: activeEntry?.form.selectedTagIds ?? [],
    })
  }, [
    activeEntry?.noteId,
    activeEntry?.form.selectedCategoryId,
    activeEntry?.form.selectedTagIds,
    notesUrlSelectionReady,
    user,
  ])

  useEffect(() => {
    if (!user) return

    const handlePopState = () => {
      // No flush needed: the target note is already in memory with its own
      // draft, so applying the URL selection is non-destructive.
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

  /**
   * Point every open entry at a category that still exists. Runs where
   * categories actually change rather than on the save path.
   *
   * A change made here is not a user edit, so a clean entry has to stay clean:
   * its signature moves with the form, otherwise autosave would immediately
   * push the remap back to the server as if the user had made it.
   */
  const remapEntriesAfterCategoryChange = useCallback(
    (categoryList: CategoryRecord[]) => {
      const fallback = getDefaultCategoryId(categoryList)

      patchEveryEntry((entry) => {
        const categoryId = entry.form.selectedCategoryId
        if (categoryId !== null && categoryList.some((category) => category.id === categoryId)) {
          return {}
        }

        const form = { ...entry.form, selectedCategoryId: fallback }
        return {
          form,
          savedSignature: isEntryDirty(entry)
            ? entry.savedSignature
            : serializeNoteDraft(entry.noteId, form),
          categoryInputValue:
            categoryList.find((category) => category.id === fallback)?.label ?? "",
        }
      })
    },
    [patchEveryEntry],
  )

  /**
   * Adopt a server-side change to a note into its open entry, if it has one.
   * Used by the sidebar move actions, which change a note the user may not be
   * looking at. The signature moves with the form so the entry does not read as
   * dirty and autosave the change straight back.
   */
  const applyServerNoteToEntry = useCallback(
    (note: NoteRecord) => {
      const entry = useNotesAppStore
        .getState()
        .openNotes.find((item) => item.noteId === note.id)
      if (!entry) return

      const form = noteToFormState(note)
      patchEntry(entry.key, {
        form,
        baseTimeModified: note.timeModified,
        savedSignature: serializeNoteDraft(note.id, form),
        categoryInputValue: note.category.label,
        pendingTagLabels: [],
      })
    },
    [patchEntry],
  )

  /**
   * The active entry's form, or a stable empty draft while the ring is still
   * being built, so `NoteForm` never has to handle a null form.
   */
  const activeForm = activeEntry?.form ?? EMPTY_NOTE_FORM

  // Derived here rather than through a store selector: a selector that builds a
  // new array each call gives useSyncExternalStore a different snapshot every
  // time and spins forever.
  const openNoteIds = useMemo(
    () => openNotes.flatMap((entry) => (entry.noteId === null ? [] : [entry.noteId])),
    [openNotes],
  )

  const setActiveForm = useCallback<Dispatch<SetStateAction<NoteFormState>>>(
    (value) => {
      const key = useNotesAppStore.getState().activeKey
      if (key === null) return
      patchEntryForm(key, (current) =>
        typeof value === "function" ? (value as (f: NoteFormState) => NoteFormState)(current) : value,
      )
    },
    [patchEntryForm],
  )

  const categoryLabelById = useCallback(
    (categoryId: number | null) =>
      categoryId === null
        ? "uncategorized"
        : (categories.find((category) => category.id === categoryId)?.label ?? "uncategorized"),
    [categories],
  )

  /** Closing is not discarding: a dirty entry still finishes its save. */
  const handleCloseOpenNote = useCallback(
    (key: OpenNoteKey) => {
      detachRemovedEntries(closeEntryInStore(key))
    },
    [closeEntryInStore, detachRemovedEntries],
  )

  const handleMaxOpenNotesChange = useCallback(
    (value: number) => {
      const next = clampMaxOpenNotes(value)
      // Lowering the cap evicts right away rather than waiting for the next
      // note to be opened, and the dropped entries still get saved.
      detachRemovedEntries(setMaxOpenNotesInStore(next))
      setUserPreferences((current) =>
        getMaxOpenNotesPreference(current) === next
          ? current
          : withMaxOpenNotesPreference(current, next),
      )
    },
    [detachRemovedEntries, setMaxOpenNotesInStore],
  )

  const handleCategoryInputValueChange = useCallback(
    (value: string) => {
      const key = useNotesAppStore.getState().activeKey
      if (key === null) return
      patchEntry(key, { categoryInputValue: value })
    },
    [patchEntry],
  )

  /**
   * Refresh category and tag records after saves, coalesced across all of them
   * so a burst of autosaves costs one round-trip rather than one each.
   *
   * These carry `noteCount`, which is not only sidebar decoration: `openDeleteTag`
   * skips the confirmation dialog when a tag reads zero notes. Leaving counts
   * stale after a save would let a tag that was just applied to a note be
   * deleted without the warning that it will be removed from it.
   */
  const scheduleTaxonomyRefresh = useCallback(
    (userId: number) => {
      if (taxonomyRefreshTimeoutRef.current !== null) {
        window.clearTimeout(taxonomyRefreshTimeoutRef.current)
      }
      taxonomyRefreshTimeoutRef.current = window.setTimeout(() => {
        taxonomyRefreshTimeoutRef.current = null
        void Promise.all([loadCategories(userId), loadTags(userId)]).catch(() => undefined)
      }, TAXONOMY_REFRESH_DEBOUNCE_MS)
    },
    [loadCategories, loadTags],
  )

  /** Merge a saved record into the lists in place, instead of refetching them. */
  const mergeSavedNote = useCallback((userId: number, note: NoteRecord) => {
    setNotes((prev) => {
      const next = [...prev.filter((item) => item.id !== note.id), note]
      updateNotesCacheList(userId, "notes", next)
      return next
    })
    // The search effect only re-runs when `notes.length` changes, so an edit to
    // an already-listed note would otherwise leave stale text in the results.
    setSearchResults((prev) =>
      prev.some((result) => result.note.id === note.id)
        ? prev.map((result) => (result.note.id === note.id ? { ...result, note } : result))
        : prev,
    )
  }, [])

  const refreshResults = useCallback(
    async (userId: number) => {
      const [latestNotes, latestCategories, latestTags] = await Promise.all([
        loadNotes(userId),
        loadCategories(userId),
        loadTags(userId),
      ])
      remapEntriesAfterCategoryChange(latestCategories)
      if (trimmedSearchQuery) {
        await runSearch(userId, trimmedSearchQuery, NOTES_APP_SEARCH_MAX_RESULTS)
      }
      return { latestNotes, latestCategories, latestTags }
    },
    [
      loadCategories,
      loadTags,
      loadNotes,
      remapEntriesAfterCategoryChange,
      runSearch,
      trimmedSearchQuery,
    ],
  )

  /**
   * Persist one entry. Saves for different entries run concurrently; saves for
   * the same entry stay serialized, so a note can never race itself into two
   * rows.
   */
  const saveEntry = useCallback(
    async function saveEntry(key: OpenNoteKey, mode: NoteSaveMode): Promise<boolean> {
      const currentUser = userRef.current
      // No session to save into. Not a failure the caller can act on, but not
      // a success either — a sign-in flush must not read this as "all stored".
      if (!currentUser) return false

      // Snapshot before awaiting anything. For a detached entry the snapshot is
      // all that is left of it; for a live one this pins the version being sent
      // so later keystrokes belong to the next save, not this one.
      const detached = detachedSavesRef.current.get(key)
      const entry = useNotesAppStore.getState().openNotes.find((item) => item.key === key)

      const source = detached ?? entry
      // Nothing left to save: the entry was closed and its work already landed.
      if (!source) return true

      const formSnapshot = snapshotNoteForm(source.form)
      let noteId = source.noteId
      let draftSignature = serializeNoteDraft(noteId, formSnapshot)

      if (!isSaveableForm(formSnapshot)) return false
      if (entry && !detached && draftSignature === entry.savedSignature) return true

      const inFlight = saveInFlightRef.current.get(key)
      if (inFlight) {
        if (mode === "autosave") {
          queuedAutosaveKeysRef.current.add(key)
          return true
        }

        // A second POST for a never-saved entry would create a second note, so
        // even a detached save has to wait for the in-flight one — which is
        // also the save that learns the new note id.
        await inFlight.catch(() => undefined)

        // Re-read the address afterwards. If that save created the row, this
        // one has to PATCH it; carrying the original `noteId: null` through
        // would POST a second copy. The detached record is checked first
        // because an evicted entry has no store slot to have been written to.
        const settled =
          detachedSavesRef.current.get(key) ??
          useNotesAppStore.getState().openNotes.find((item) => item.key === key)
        if (!settled) return true

        noteId = settled.noteId
        draftSignature = serializeNoteDraft(noteId, formSnapshot)
        if (draftSignature === settled.savedSignature) return true
      }

      if (!detached) patchEntry(key, { saveStatus: "saving" })

      const savePromise = (async () => {
        const requestBody =
          noteId === null
            ? { userId: currentUser.id, note: noteRequestBody(formSnapshot) }
            : { userId: currentUser.id, noteId, note: noteRequestBody(formSnapshot) }

        const response = await fetch("/api/notes", {
          method: noteId === null ? "POST" : "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestBody),
        })
        const data = await readJson<{ note: NoteRecord }>(response)

        if (userRef.current?.id !== currentUser.id) return

        mergeSavedNote(currentUser.id, data.note)
        scheduleTaxonomyRefresh(currentUser.id)

        // Write back by key. The old "is this still the note on screen" guard
        // existed only because there was one editor slot; with per-entry state
        // this is correct whether or not the user has moved on.
        const landedSignature = serializeNoteDraft(data.note.id, formSnapshot)
        patchEntry(key, {
          noteId: data.note.id,
          baseTimeModified: data.note.timeModified,
          savedSignature: landedSignature,
        })

        // Keep any detached record for this key in step. Without this, an entry
        // evicted mid-create keeps `noteId: null` and the next detached save or
        // exit keepalive POSTs a second copy of the same note.
        const pendingDetached = detachedSavesRef.current.get(key)
        if (pendingDetached) {
          detachedSavesRef.current.set(key, {
            ...pendingDetached,
            noteId: data.note.id,
            savedSignature: landedSignature,
          })
        }
      })()

      saveInFlightRef.current.set(key, savePromise)

      let persisted = false

      try {
        await savePromise
        persisted = true
        if (userRef.current?.id === currentUser.id && !detached) {
          const live = useNotesAppStore.getState().openNotes.find((item) => item.key === key)
          if (live) {
            patchEntry(key, { saveStatus: isEntryDirty(live) ? "unsaved" : "saved" })
          }
        }
      } catch (error) {
        if (userRef.current?.id === currentUser.id) {
          setErrorMessage(getErrorMessage(error))
          if (!detached) patchEntry(key, { saveStatus: "error" })
        }
      } finally {
        if (saveInFlightRef.current.get(key) === savePromise) {
          saveInFlightRef.current.delete(key)
        }
        // Drop the detached record only once its text is actually stored.
        // Keeping it on failure is what lets the exit keepalive and the
        // pre-sign-out flush still find the words that left the ring.
        if (persisted) detachedSavesRef.current.delete(key)
      }

      if (queuedAutosaveKeysRef.current.delete(key)) {
        const latest = useNotesAppStore.getState().openNotes.find((item) => item.key === key)
        if (latest && isSaveableForm(latest.form) && isEntryDirty(latest)) {
          void saveEntry(key, "autosave")
        }
      }

      return persisted
    },
    [mergeSavedNote, patchEntry, scheduleTaxonomyRefresh],
  )

  saveEntryRef.current = saveEntry

  /**
   * Persist every dirty entry and wait for all of them. Used only where the
   * session itself is about to change — sign-in, sign-up, sign-out — since
   * ordinary note switching no longer needs to block on a save.
   */
  const flushAllPendingSaves = useCallback(async () => {
    const entries = useNotesAppStore.getState().openNotes.filter(isEntryDirty)
    // Detached work counts too: text that left the ring is exactly the text
    // nobody is looking at, so it is the easiest to lose in a session change.
    const detachedKeys = [...detachedSavesRef.current.keys()]

    const results = await Promise.allSettled([
      ...entries.map((entry) => saveEntry(entry.key, "flush")),
      ...detachedKeys.map((key) => saveEntry(key, "detached")),
    ])

    // Reports failure rather than swallowing it. Callers are about to tear down
    // or replace the session, so proceeding past a failed save destroys the
    // draft it was carrying.
    return results.every((result) => result.status === "fulfilled" && result.value)
  }, [saveEntry])

  flushAllPendingSavesRef.current = flushAllPendingSaves

  useOpenNotesAutosave({
    entries: openNotes,
    enabled: Boolean(user),
    saveEntry,
  })

  // Keep each entry's indicator in sync whenever a save is not running for it
  // (the save routine owns the status while its request is in flight).
  useEffect(() => {
    if (!user) return

    for (const entry of openNotes) {
      if (saveInFlightRef.current.has(entry.key)) continue

      const next =
        entry.form.description.trim() === "" && entry.noteId === null
          ? "idle"
          : isEntryDirty(entry)
            ? "unsaved"
            : "saved"

      if (entry.saveStatus !== next) patchEntry(entry.key, { saveStatus: next })
    }
  }, [openNotes, patchEntry, user])

  // Best-effort save when the tab is being hidden or torn down. The awaited
  // flushes cannot run during an unload, so fire keepalive requests (which the
  // browser allows to outlive the page) for every unsaved entry — including
  // ones that already left the ring but whose request never landed.
  useEffect(() => {
    if (!user) return

    const flushOnExit = () => {
      const currentUser = userRef.current
      // No session to save into. Not a failure the caller can act on, but not
      // a success either — a sign-in flush must not read this as "all stored".
      if (!currentUser) return false

      const store = useNotesAppStore.getState()

      const pending: { key: OpenNoteKey; noteId: number | null; form: NoteFormState }[] = [
        ...store.openNotes
          .filter((entry) => isSaveableForm(entry.form) && isEntryDirty(entry))
          .map((entry) => ({ key: entry.key, noteId: entry.noteId, form: entry.form })),
        ...[...detachedSavesRef.current.entries()].map(([key, save]) => ({
          key,
          noteId: save.noteId,
          form: save.form,
        })),
      ]

      for (const { key, noteId, form } of pending) {
        // Mark as persisted optimistically so repeated exit events (pagehide
        // after visibilitychange) do not fire the same write twice.
        patchEntry(key, { savedSignature: serializeNoteDraft(noteId, form) })
        detachedSavesRef.current.delete(key)

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

      persistOpenNotesRef.current()
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
  }, [patchEntry, user])

  // Persist the ring so a reload keeps the open notes and their unsaved text.
  // Debounced: this must never run on a keystroke, since JSON.stringify plus a
  // synchronous localStorage write on the main thread is exactly the jank this
  // whole change exists to remove.
  const persistOpenNotes = useCallback(() => {
    const currentUser = userRef.current
    if (!currentUser) return

    const ok = writeOpenNotesSnapshot(
      currentUser.id,
      useNotesAppStore.getState(),
      isEntryDirty,
    )
    if (!ok) {
      setErrorMessage("Running low on browser storage — some unsaved notes may not survive a reload.")
    }
  }, [])

  const persistOpenNotesRef = useRef(persistOpenNotes)
  persistOpenNotesRef.current = persistOpenNotes

  useEffect(() => {
    if (!user) return
    if (!didRehydrateOpenNotesRef.current) return

    if (openNotesPersistTimeoutRef.current !== null) {
      window.clearTimeout(openNotesPersistTimeoutRef.current)
    }

    openNotesPersistTimeoutRef.current = window.setTimeout(() => {
      openNotesPersistTimeoutRef.current = null
      persistOpenNotes()
    }, OPEN_NOTES_PERSIST_DEBOUNCE_MS)

    return () => {
      if (openNotesPersistTimeoutRef.current === null) return
      window.clearTimeout(openNotesPersistTimeoutRef.current)
      openNotesPersistTimeoutRef.current = null
    }
  }, [activeKey, openNotes, persistOpenNotes, user])

  // The reveal highlight is a one-shot: the editor consumes it at mount, so
  // clear it once handed over. Otherwise coming back to a note opened from a
  // search result would re-scroll and re-highlight every time.
  useEffect(() => {
    if (!activeEntry?.revealText) return
    patchEntry(activeEntry.key, { revealText: null })
  }, [activeEntry?.key, activeEntry?.revealText, patchEntry])

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

    if (activeKey === null) return

    patchEntry(activeKey, (entry) => ({
      form: { ...entry.form, selectedTagIds: nextSelectedTagIds },
      pendingTagLabels: nextPendingLabels,
    }))
    nextPendingLabels.forEach((label) => {
      void handleCreateTag(label, activeKey)
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

  const handleLogin = async (event: FormEvent<HTMLFormElement>): Promise<boolean> => {
    event.preventDefault()
    clearMessages()
    setAuthPending(true)
    try {
      // Persist every unsaved entry to the anonymous account before the
      // session changes, otherwise those drafts never reach the DB and the
      // merge below cannot move them. Aborting on failure mirrors the
      // merge-token rule below: stay anonymous and retry rather than sign in
      // and strand the notes on a row nobody will look at again.
      if (!(await flushAllPendingSaves())) {
        setErrorMessage(
          "Couldn't save all your notes before signing in. Check your connection and try again.",
        )
        return false
      }

      // While still anonymous, capture a signed merge token and stash it across
      // the sign-in transition. The single post-login loader (restoreSession)
      // performs the merge and the reload, so there is exactly one writer of
      // session data — no race.
      if (authSession?.user?.isAnonymous && authSession.user.notesUserId) {
        let mergeTokenCaptured = false
        try {
          const tokenResponse = await fetch("/api/anon-session/merge-token", {
            method: "POST",
          })
          if (tokenResponse.ok) {
            const tokenData = (await tokenResponse.json()) as { mergeToken: string }
            writePendingMergeToken(tokenData.mergeToken)
            mergeTokenCaptured = true
          }
        } catch {
          // Handled below — treated the same as a non-OK response.
        }

        // Without a token the merge can never run, and after sign-in the
        // anonymous session is gone, stranding the visitor's notes. When
        // there is anything to lose, abort while the user is still anonymous
        // so they can simply retry. An empty visitor session has nothing to
        // merge, so it proceeds without a token.
        if (!mergeTokenCaptured && notesRef.current.length > 0) {
          setErrorMessage(
            "Couldn't prepare your notes to transfer to the account. Check your connection and try again.",
          )
          return false
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
        return false
      }

      // A successful sign-in flips authSession to the real user, which re-runs
      // restoreSession. Show the loading state so the merge + single reload is
      // not interleaved with a flash of the outgoing anonymous data.
      setSessionLoading(true)
      setIdentifier("")
      setPassword("")
      return true
    } catch (error) {
      setErrorMessage(getErrorMessage(error))
      return false
    } finally {
      setAuthPending(false)
    }
  }

  const handleSignup = async (fields: SignupFields): Promise<boolean> => {
    clearMessages()

    const username = fields.username.trim()
    const email = fields.email.trim()
    if (username === "") {
      setErrorMessage("Username is required.")
      return false
    }
    if (fields.password.length < 8) {
      setErrorMessage("Password must be at least 8 characters.")
      return false
    }
    if (email !== "" && !email.includes("@")) {
      setErrorMessage("Email must be a valid email address.")
      return false
    }

    setAuthPending(true)
    try {
      // Persist every unsaved entry before the claim. The data stays on the
      // same user row, but the debounced autosaves must not fire mid-transition.
      if (!(await flushAllPendingSaves())) {
        setErrorMessage(
          "Couldn't save all your notes before creating the account. Check your connection and try again.",
        )
        return false
      }

      // Claim the anonymous row in place: same user_id, identity + password set,
      // is_anonymous flipped to false. Nothing moves between users, so there is
      // no merge token and no race in this path.
      const claimResponse = await fetch("/api/anon-session/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username,
          email: email === "" ? undefined : email,
          password: fields.password,
        }),
      })

      if (!claimResponse.ok) {
        if (claimResponse.status === 409) {
          setErrorMessage(
            "That username or email is already taken — sign in instead to keep your notes.",
          )
        } else {
          const body = (await claimResponse.json().catch(() => null)) as { error?: string } | null
          setErrorMessage(body?.error ?? "Unable to create the account. Try again.")
        }
        return false
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
        identifier: username,
        password: fields.password,
        redirect: false,
      })

      if (result?.error) {
        // The account is already claimed; only the session refresh failed.
        setErrorMessage("Account created — sign in with your new username and password.")
        return false
      }

      // restoreSession re-fires (isAnonymous flipped) and refreshes the same
      // account's data. No merge token is pending, so it is a plain reload.
      setStatusMessage("Account created. Your notes are saved to it.")
      return true
    } catch (error) {
      setErrorMessage(getErrorMessage(error))
      return false
    } finally {
      setAuthPending(false)
    }
  }

  const handleLogout = async () => {
    // Signing out clears the ring and the local snapshot, so an unsaved note
    // that failed to persist would be gone for good. Refuse rather than
    // destroy it; the user can retry once the network recovers.
    if (!(await flushAllPendingSaves())) {
      setErrorMessage(
        "Couldn't save all your notes, so you're still signed in. Check your connection and try again.",
      )
      return
    }
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
    clearOpenNotesSnapshot()
    detachedSavesRef.current.clear()
    didRehydrateOpenNotesRef.current = false
    resetNotesAppStore()
    setResultsListVisible(!isMobileResultsLayout())
    setPreferredResultsColumnWidth(RESULTS_COLUMN_DEFAULT_WIDTH)
    setResultsColumnWidth(RESULTS_COLUMN_DEFAULT_WIDTH)
    clearMessages()
  }

  const closeResultsListOnMobile = () => {
    if (isMobileResultsLayout()) {
      setResultsListVisible(false)
    }
  }

  /**
   * Opening a note no longer waits for anything. The outgoing entry keeps its
   * draft in memory and its own autosave, so there is nothing to lose by
   * switching immediately.
   */
  const handleOpenNoteFromResults = (note: NoteRecord) => {
    clearMessages()
    openNoteEntry(note)

    const key = noteEntryKey(note.id)
    patchEntry(key, {
      autofocus: !isMobileResultsLayout(),
      revealText: searchMode ? trimmedSearchQuery : null,
    })
    closeResultsListOnMobile()
  }

  const handleAddNoteForCategory = (category: CategoryRecord) => {
    clearMessages()
    openDraftEntry({ categoryId: category.id, categoryLabel: category.label })
    closeResultsListOnMobile()
  }

  const handleAddNoteForTag = (tag: TagRecord) => {
    clearMessages()
    const currentCategoryId = activeEntry?.form.selectedCategoryId ?? null
    const selectedCategoryId =
      currentCategoryId !== null && categories.some((category) => category.id === currentCategoryId)
        ? currentCategoryId
        : getDefaultCategoryId(categories)

    openDraftEntry({
      categoryId: selectedCategoryId,
      tagIds: [tag.id],
      categoryLabel:
        selectedCategoryId === null
          ? ""
          : (categories.find((category) => category.id === selectedCategoryId)?.label ?? ""),
    })
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
    if (activeKey === null) return
    patchEntry(activeKey, (entry) => ({
      form: { ...entry.form, selectedCategoryId: category.id },
      categoryInputValue: category.label,
    }))
  }

  // `targetKey` is captured by the caller before this awaits. Without it, a tag
  // created in one note would land on whichever note happens to be active when
  // the request returns — which is now a different note, since switching no
  // longer blocks.
  const handleCreateTag = async (rawLabel: string, targetKey: OpenNoteKey | null = activeKey) => {
    if (!user) {
      setErrorMessage("Sign in before adding tags.")
      return
    }
    const label = rawLabel.trim()
    if (label === "" || targetKey === null) {
      return
    }

    const dropPendingLabel = (normalized: string) =>
      patchEntry(targetKey, (entry) => ({
        pendingTagLabels: entry.pendingTagLabels.filter(
          (item) => normalizeLabel(item) !== normalized,
        ),
      }))

    const selectTag = (tagId: number) =>
      patchEntry(targetKey, (entry) => ({
        form: {
          ...entry.form,
          selectedTagIds: entry.form.selectedTagIds.includes(tagId)
            ? entry.form.selectedTagIds
            : [...entry.form.selectedTagIds, tagId],
        },
      }))

    const normalizedLabel = normalizeLabel(label)
    const existingTag = tags.find((tag) => normalizeLabel(tag.label) === normalizedLabel)
    if (existingTag) {
      dropPendingLabel(normalizedLabel)
      selectTag(existingTag.id)
      return
    }
    // Deliberately global: two entries asking for the same new label should
    // still only create one tag.
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
      const shouldKeepSelected = useNotesAppStore
        .getState()
        .openNotes.find((entry) => entry.key === targetKey)
        ?.pendingTagLabels.some((item) => normalizeLabel(item) === normalizedLabel)

      dropPendingLabel(normalizedLabel)
      if (shouldKeepSelected) selectTag(data.tag.id)
      setStatusMessage(`Tag “${data.tag.label}” added.`)
    } catch (error) {
      dropPendingLabel(normalizedLabel)
      setErrorMessage(getErrorMessage(error))
    } finally {
      creatingTagLabelsRef.current.delete(normalizedLabel)
      setCreateTagPending(false)
    }
  }

  const handleCreateCategory = async (
    rawLabel: string,
    targetKey: OpenNoteKey | null = activeKey,
  ) => {
    if (!user) {
      setErrorMessage("Sign in before adding categories.")
      return
    }
    const label = rawLabel.trim()
    if (label === "" || targetKey === null) {
      return
    }
    const existingCategory = categories.find(
      (category) => normalizeLabel(category.label) === normalizeLabel(label),
    )
    if (existingCategory) {
      patchEntry(targetKey, (entry) => ({
        form: { ...entry.form, selectedCategoryId: existingCategory.id },
        categoryInputValue: existingCategory.label,
      }))
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
      patchEntry(targetKey, (entry) => ({
        form: { ...entry.form, selectedCategoryId: data.category.id },
        categoryInputValue: data.category.label,
      }))
      setStatusMessage(`Category “${data.category.label}” added.`)
    } catch (error) {
      setErrorMessage(getErrorMessage(error))
    } finally {
      setCreateCategoryPending(false)
    }
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

    const request = (async () => {
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
      return readJson<{ note: NoteRecord }>(response)
    })()

    // Register under the entry's key so an autosave for the same note queues
    // behind this write instead of racing it. Without this, moving an open,
    // dirty note from the sidebar could land in either order.
    const openKey = useNotesAppStore
      .getState()
      .openNotes.find((entry) => entry.noteId === note.id)?.key
    if (openKey) {
      saveInFlightRef.current.set(
        openKey,
        request.then(
          () => undefined,
          () => undefined,
        ),
      )
    }

    let data: { note: NoteRecord }
    try {
      data = await request
    } finally {
      if (openKey && saveInFlightRef.current.has(openKey)) {
        saveInFlightRef.current.delete(openKey)
      }
    }
    await refreshResults(user.id)
    return data.note
  }

  const handleMoveNoteCategory = async (note: NoteRecord, categoryLabel: string) => {
    if (!user) return
    clearMessages()
    try {
      const category = await resolveCategoryForSidebarMove(categoryLabel)
      if (!category) return
      if (category.id === note.category.id) return

      const updatedNote = await patchNoteFromSidebar(
        note,
        category.id,
        note.tags.map((tag) => tag.id),
      )
      if (updatedNote) applyServerNoteToEntry(updatedNote)
      setStatusMessage(`Note moved to “${category.label}”.`)
    } catch (error) {
      setErrorMessage(getErrorMessage(error))
    }
  }

  const handleMoveNoteTag = async (note: NoteRecord, fromTagId: number, tagLabel: string) => {
    if (!user) return
    clearMessages()
    try {
      const tag = await resolveTagForSidebarMove(tagLabel)
      if (!tag) return

      const nextTagIds = note.tags
        .filter((noteTag) => noteTag.id !== fromTagId && noteTag.id !== tag.id)
        .map((noteTag) => noteTag.id)
      nextTagIds.push(tag.id)

      const updatedNote = await patchNoteFromSidebar(note, note.category.id, nextTagIds)
      if (updatedNote) applyServerNoteToEntry(updatedNote)
      setStatusMessage(`Note tag changed to “${tag.label}”.`)
    } catch (error) {
      setErrorMessage(getErrorMessage(error))
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

      // Every note in the category is gone server-side. Any that were open
      // would otherwise stay in the ring pointing at dead ids, so the user
      // could keep typing into a zombie entry whose next autosave 404s. These
      // are the one removal that must NOT route through a detached save — the
      // rows they would write to no longer exist.
      const deletedNoteIds = new Set(
        notesRef.current
          .filter((note) => note.category.id === category.id)
          .map((note) => note.id),
      )
      for (const entry of useNotesAppStore.getState().openNotes) {
        if (entry.noteId === null || !deletedNoteIds.has(entry.noteId)) continue
        detachedSavesRef.current.delete(entry.key)
        closeEntryInStore(entry.key)
      }

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
      await refreshResults(user.id)
      // Close the entry wherever it sits, not only when it happens to be the
      // one on screen — otherwise a deleted note lingers in the recent list.
      // Its text is gone by the user's own request, so this removal is the one
      // that does not route through a detached save.
      closeEntriesForNoteInStore(noteId)
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

      <div className={styles.header}>
        <NotesHeader
          user={user}
          isAnonymous={authSession?.user?.isAnonymous ?? false}
          resultsListVisible={resultsListVisible}
          pasteUrlAsMarkdown={pasteUrlAsMarkdown}
          onPasteUrlAsMarkdownChange={handlePasteUrlAsMarkdownChange}
          onAddNote={handleCancelEdit}
          onLogout={handleLogout}
          maxOpenNotes={maxOpenNotes}
          onMaxOpenNotesChange={handleMaxOpenNotesChange}
          categoryLabelById={categoryLabelById}
          onSelectOpenNote={activateEntryInStore}
          onCloseOpenNote={handleCloseOpenNote}
          embeddingMaintenancePending={embeddingMaintenancePending}
          onRunEmbeddingMaintenance={(mode) => void handleRunEmbeddingMaintenance(mode)}
          identifier={identifier}
          password={password}
          onIdentifierChange={setIdentifier}
          onPasswordChange={setPassword}
          onLoginSubmit={handleLogin}
          onSignupSubmit={handleSignup}
          authPending={authPending}
          loginErrorMessage={authPending ? null : errorMessage}
          onDismissLoginError={() => setErrorMessage(null)}
        />
      </div>

      <div className={styles.content} ref={contentRef}>
        <NoteForm
          form={activeForm}
          setForm={setActiveForm}
          editingNoteId={activeEntry?.noteId ?? null}
          userPresent={Boolean(user)}
          pasteUrlAsMarkdown={pasteUrlAsMarkdown}
          categories={categories}
          tags={tags}
          pendingTagLabels={activeEntry?.pendingTagLabels ?? EMPTY_PENDING_TAG_LABELS}
          // Keying the editor on the entry as well as the session id is what
          // makes switching notes swap documents: same entry, same document.
          descriptionEditorSessionId={`${activeEntry?.key ?? "none"}:${activeEntry?.editorSessionId ?? 0}`}
          editorAutofocus={activeEntry?.autofocus ?? false}
          editorRevealText={activeEntry?.revealText ?? null}
          categoryInputValue={activeEntry?.categoryInputValue ?? ""}
          onCategoryInputValueChange={handleCategoryInputValueChange}
          createCategoryPending={createCategoryPending}
          createTagPending={createTagPending}
          onSelectCategoryId={handleSelectCategory}
          onCreateCategory={handleCreateCategory}
          onTagValuesChange={handleTagValuesChange}
          onCancelEdit={handleCancelEdit}
          onAddNote={handleCancelEdit}
          onDeleteEditingNote={() => {
            if (activeEntry?.noteId != null) {
              void handleDeleteNote(activeEntry.noteId)
            }
          }}
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
          activeNoteId={activeEntry?.noteId ?? null}
          openNoteIds={openNoteIds}
          activeCategoryId={activeForm.selectedCategoryId}
          activeTagIds={activeForm.selectedTagIds}
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
