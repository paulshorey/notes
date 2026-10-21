"use client"

import { isTextItem } from "@lib/db-items/contracts/item-content"

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
  ItemsResponse,
  ItemRecord,
  SearchResponse,
  SessionResponse,
  UpdateCategoryResponse,
  UpdateTagResponse,
  UserPreferences,
  UserSummary,
  BootstrapResponse,
  StatusRecord,
  WorkspaceRecord,
} from "@lib/db-items"
import type { RestoreBackupResponse } from "@lib/db-items/contracts/items-app"
import { getCategoryNameError } from "@lib/db-items/contracts/category-name"
import { ITEMS_APP_SEARCH_MAX_RESULTS } from "@lib/db-items/item-search-constants"
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
import { Button, Text } from "@gravity-ui/uikit"
import { signIn, signOut, useSession } from "next-auth/react"
import { SIDEBAR_OVERLAY_MEDIA_QUERY, STORAGE_KEY } from "@/constants/items"
import { fetchWithTimeout, getErrorMessage, itemsFetch, readJson, RequestError } from "@/lib/api"
import { recoverExpiredSession } from "@/lib/sessionRecovery"
import { normalizeLabel } from "@/lib/strings"
import {
  createDefaultTextCaptureForm,
  itemToFormState,
  type EmbeddingMaintenanceMode,
  type TextCaptureFormState,
} from "@/types/items"
import { useAutoDismissStatus } from "@/hooks/useAutoDismissStatus"
import { useSidebarDrawer } from "@/hooks/useSidebarDrawer"
import { useOpenItemsAutosave } from "@/hooks/useOpenItemsAutosave"
import {
  isSaveableForm,
  itemRequestBody,
  serializeItemDraft,
  snapshotTextCaptureForm,
} from "@/lib/itemDraft"
import {
  clearItemsCache,
  readItemsCache,
  updateItemsCacheList,
  updateItemsCacheUser,
  writeItemsCache,
} from "@/lib/itemsCache"
import {
  collectExitFlushItems,
  collectSessionFlushEntries,
  selectKeepaliveExitItems,
  stateWithDetachedSaves,
} from "@/lib/openItemsExit"
import {
  clearOpenItemsSnapshot,
  readOpenItemsSnapshot,
  readOpenItemsSnapshotForAnyUser,
  reconcileOpenItems,
  writeOpenItemsSnapshot,
} from "@/lib/openItemsStorage"
import {
  clampMaxOpenItems,
  MAX_OPEN_ITEMS_DEFAULT,
  itemEntryKey,
  type OpenItemEntry,
  type OpenItemKey,
} from "@/stores/openItems"
import { selectActiveEntry, useItemsAppStore } from "@/stores/itemsAppStore"
import { FeedbackNotifications } from "./FeedbackNotifications"
import { TextCaptureForm } from "./TextCaptureForm"
import {
  buildCategoryItemGroups,
  getGroupSortTime,
  getItemSortTime,
  type DisplayItemItem,
} from "@/lib/itemGroups"
import { WorkspaceHeader, type SignupFields } from "./WorkspaceHeader"
import { ResultsColumn, type StatusItemGroup, type TagItemGroup } from "./ResultsColumn"
import { DeleteCategoryModal } from "./modals/DeleteCategoryModal"
import { DeleteTagModal } from "./modals/DeleteTagModal"
import { EditCategoryModal } from "./modals/EditCategoryModal"
import { EditTagModal } from "./modals/EditTagModal"
import styles from "./ItemsApp.module.css"

const RESULTS_COLUMN_MIN_WIDTH = 222
const RESULTS_COLUMN_DEFAULT_WIDTH = RESULTS_COLUMN_MIN_WIDTH
const RESULTS_COLUMN_MAX_WIDTH = 720
const FORM_COLUMN_MIN_WIDTH = 333
const RESIZE_HANDLE_WIDTH = 8
const RESIZE_DRAG_THRESHOLD = 4
const RESULTS_DRAWER_TRANSITION_MS = 400
const PREFERENCES_SAVE_DEBOUNCE_MS = 500
const OPEN_ITEMS_PERSIST_DEBOUNCE_MS = 1000
const TAXONOMY_REFRESH_DEBOUNCE_MS = 4000
const ITEM_URL_ID_PARAM = "id"
const ITEM_URL_CATEGORY_PARAM = "category"
const ITEM_URL_TAGS_PARAM = "tags"

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

interface ItemsUrlSelection {
  hasState: boolean
  itemId: number | null
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

const isResultsDrawerLayout = () =>
  typeof window !== "undefined" && window.matchMedia(SIDEBAR_OVERLAY_MEDIA_QUERY).matches

const parsePositiveInteger = (value: string | null) => {
  if (value === null || value.trim() === "") return null

  const parsed = Number.parseInt(value, 10)
  return Number.isInteger(parsed) && parsed > 0 && String(parsed) === value.trim() ? parsed : null
}

const readItemsUrlSelection = (): ItemsUrlSelection => {
  if (typeof window === "undefined") {
    return { hasState: false, itemId: null, categoryId: null, tagIds: [] }
  }

  const params = new URLSearchParams(window.location.search)
  const rawTags = params.get(ITEM_URL_TAGS_PARAM)
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
      params.has(ITEM_URL_ID_PARAM) ||
      params.has(ITEM_URL_CATEGORY_PARAM) ||
      params.has(ITEM_URL_TAGS_PARAM),
    itemId: parsePositiveInteger(params.get(ITEM_URL_ID_PARAM)),
    categoryId: parsePositiveInteger(params.get(ITEM_URL_CATEGORY_PARAM)),
    tagIds,
  }
}

const writeItemsUrlSelection = ({
  itemId,
  categoryId,
  tagIds,
}: Omit<ItemsUrlSelection, "hasState">) => {
  if (typeof window === "undefined") {
    return
  }

  const url = new URL(window.location.href)
  if (itemId === null) {
    url.searchParams.delete(ITEM_URL_ID_PARAM)
  } else {
    url.searchParams.set(ITEM_URL_ID_PARAM, String(itemId))
  }

  if (categoryId === null) {
    url.searchParams.delete(ITEM_URL_CATEGORY_PARAM)
  } else {
    url.searchParams.set(ITEM_URL_CATEGORY_PARAM, String(categoryId))
  }

  const nextTagIds = Array.from(new Set(tagIds)).filter((id) => Number.isInteger(id) && id > 0)
  if (nextTagIds.length === 0) {
    url.searchParams.delete(ITEM_URL_TAGS_PARAM)
  } else {
    url.searchParams.set(ITEM_URL_TAGS_PARAM, nextTagIds.join(","))
  }

  const nextPath = `${url.pathname}${url.search}${url.hash}`
  const currentPath = `${window.location.pathname}${window.location.search}${window.location.hash}`
  if (nextPath !== currentPath) {
    window.history.replaceState(window.history.state, "", nextPath)
  }
}

const getStoredResultsColumnWidth = (preferences: UserPreferences) => {
  const itemsAppPreferences = preferences.notesApp
  if (!isPreferencesObject(itemsAppPreferences)) return null

  const width = itemsAppPreferences.resultsColumnWidth
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
  const itemsAppPreferences = preferences.notesApp
  if (!isPreferencesObject(itemsAppPreferences)) return false

  return itemsAppPreferences.pasteUrlAsMarkdown === true
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

const getMaxOpenItemsPreference = (preferences: UserPreferences) => {
  const itemsAppPreferences = preferences.notesApp
  if (!isPreferencesObject(itemsAppPreferences)) return MAX_OPEN_ITEMS_DEFAULT

  const value = itemsAppPreferences.maxOpenNotes
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return MAX_OPEN_ITEMS_DEFAULT
  }

  return clampMaxOpenItems(value)
}

const withMaxOpenItemsPreference = (
  preferences: UserPreferences,
  value: number,
): UserPreferences => ({
  ...preferences,
  notesApp: {
    ...(isPreferencesObject(preferences.notesApp) ? preferences.notesApp : {}),
    maxOpenNotes: clampMaxOpenItems(value),
  },
})

const getDefaultTagId = (tagList: TagRecord[]) =>
  tagList.length > 0 ? tagList.reduce((a, b) => (a.id < b.id ? a : b)).id : null

type ItemGroupSortRecord = CategoryRecord | TagRecord

const compareItemGroups = <
  T extends { sortTime: number } & (
    | { category: ItemGroupSortRecord }
    | { tag: ItemGroupSortRecord }
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
type ItemSaveMode = "autosave" | "flush" | "detached"

/**
 * A dirty entry that left the ring but whose text still has to reach the
 * server. `savedSignature` tracks what has already landed for it, because a
 * save that completes after the entry is gone has no store slot to write to.
 */
interface DetachedSave {
  itemId: number | null
  form: TextCaptureFormState
  savedSignature: string | null
}

const entrySignature = (entry: OpenItemEntry) => serializeItemDraft(entry.itemId, entry.form)

// Stable identities so an empty ring does not remount the editor every render.
const EMPTY_ITEM_FORM: TextCaptureFormState = createDefaultTextCaptureForm()
const EMPTY_PENDING_TAG_LABELS: string[] = []

const isEntryDirty = (entry: OpenItemEntry) => entrySignature(entry) !== entry.savedSignature

export default function ItemsApp() {
  const { data: authSession, status: authStatus } = useSession()
  const [identifier, setIdentifier] = useState("")
  const [password, setPassword] = useState("")
  const backupOperation = useItemsAppStore((s) => s.backupOperation)
  const [user, setUser] = useState<UserSummary | null>(null)
  const [userPreferences, setUserPreferences] = useState<UserPreferences>({})
  const [items, setItems] = useState<ItemRecord[]>([])
  const [categories, setCategories] = useState<CategoryRecord[]>([])
  const [statuses, setStatuses] = useState<StatusRecord[]>([])
  const [tags, setTags] = useState<TagRecord[]>([])
  const [workspaces, setWorkspaces] = useState<WorkspaceRecord[]>([])
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<number | null>(null)
  const fallbackTagId = getDefaultTagId(tags)
  // Selector subscriptions rather than a bulk destructure: with a ring of open
  // notes, subscribing to the whole store would re-render the entire app —
  // editor included — on every keystroke in any entry.
  const resultsListVisible = useItemsAppStore((state) => state.resultsListVisible)
  const { drawerMode, closeIfDrawer } = useSidebarDrawer()
  const setResultsListVisible = useItemsAppStore((state) => state.setResultsListVisible)
  const selectedTagId = useItemsAppStore((state) => state.selectedTagId)
  const setSelectedTagId = useItemsAppStore((state) => state.setSelectedTagId)
  const searchQuery = useItemsAppStore((state) => state.searchQuery)
  const setSearchQuery = useItemsAppStore((state) => state.setSearchQuery)
  const openItems = useItemsAppStore((state) => state.openItems)
  const activeKey = useItemsAppStore((state) => state.activeKey)
  const activeEntry = useItemsAppStore(selectActiveEntry)
  const maxOpenItems = useItemsAppStore((state) => state.maxOpenItems)
  const setMaxOpenItemsInStore = useItemsAppStore((state) => state.setMaxOpenItems)
  const openExistingItemInStore = useItemsAppStore((state) => state.openExistingItem)
  const openNewDraftInStore = useItemsAppStore((state) => state.openNewDraft)
  const activateEntryInStore = useItemsAppStore((state) => state.activateEntry)
  const closeEntryInStore = useItemsAppStore((state) => state.closeEntry)
  const closeEntriesForItemInStore = useItemsAppStore((state) => state.closeEntriesForItem)
  const patchEntry = useItemsAppStore((state) => state.patchEntry)
  const patchEntryForm = useItemsAppStore((state) => state.patchEntryForm)
  const patchEveryEntry = useItemsAppStore((state) => state.patchEveryEntry)
  const replaceOpenItems = useItemsAppStore((state) => state.replaceOpenItems)
  const resetItemsAppStore = useItemsAppStore((state) => state.resetDefaultState)
  const [searchResults, setSearchResults] = useState<SearchResponse["results"]>([])
  const [sessionLoading, setSessionLoading] = useState(true)
  const [startupErrorMessage, setStartupErrorMessage] = useState<string | null>(null)
  const [startupRetryKey, setStartupRetryKey] = useState(0)
  const [anonymousSignInPending, setAnonymousSignInPending] = useState(false)
  const [itemsUrlSelectionReady, setItemsUrlSelectionReady] = useState(false)
  const [itemsLoading, setItemsLoading] = useState(false)
  const [searchLoading, setSearchLoading] = useState(false)
  const [authPending, setAuthPending] = useState(false)
  const [embeddingMaintenancePending, setEmbeddingMaintenancePending] =
    useState<EmbeddingMaintenanceMode | null>(null)
  const [createCategoryPending, setCreateCategoryPending] = useState(false)
  const [createStatusPending, setCreateStatusPending] = useState(false)
  const [createTagPending, setCreateTagPending] = useState(false)
  const [deletingItemId, setDeletingItemId] = useState<number | null>(null)
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
  const [resultsColumnWidth, setResultsColumnWidth] = useState(RESULTS_COLUMN_DEFAULT_WIDTH)
  const [resultsOverlayMounted, setResultsOverlayMounted] = useState(false)
  const contentRef = useRef<HTMLDivElement | null>(null)
  const userRef = useRef<UserSummary | null>(null)
  const userPreferencesRef = useRef<UserPreferences>({})
  const itemsRef = useRef<ItemRecord[]>(items)
  const categoriesRef = useRef<CategoryRecord[]>(categories)
  const tagsRef = useRef<TagRecord[]>(tags)
  const activeWorkspaceIdRef = useRef<number | null>(activeWorkspaceId)
  // Saves are keyed by entry, so two notes can be in flight at once while a
  // second save of the *same* note still queues behind the first.
  const saveInFlightRef = useRef(new Map<OpenItemKey, Promise<void>>())
  const queuedAutosaveKeysRef = useRef(new Set<OpenItemKey>())
  // Entries that left the ring while dirty. Their request still has to land,
  // and the exit keepalive has to know about them.
  const detachedSavesRef = useRef(new Map<OpenItemKey, DetachedSave>())
  // Guards the anonymous→real merge so a re-render mid-request cannot fire it
  // twice. The sessionStorage token removal is the primary idempotency guard;
  // this ref covers the in-flight window before that removal is observed.
  const mergeInFlightRef = useRef(false)
  const anonymousSignInInFlightRef = useRef(false)
  const didRehydrateOpenItemsRef = useRef(false)
  const openItemsPersistTimeoutRef = useRef<number | null>(null)
  const taxonomyRefreshTimeoutRef = useRef<number | null>(null)
  // Stable handle to the latest flush implementation so handlers declared
  // before it can trigger a save without declaration-order gymnastics.
  const flushAllPendingSavesRef = useRef<() => Promise<boolean>>(() => Promise.resolve(true))
  const persistOpenItemsRef = useRef<() => void>(() => undefined)
  const saveEntryRef = useRef<(key: OpenItemKey, mode: ItemSaveMode) => Promise<boolean>>(() =>
    Promise.resolve(true),
  )
  // Keys already sent a keepalive PATCH during this hide/exit, so pagehide
  // after visibilitychange does not fire the same write twice. Cleared when
  // the tab is visible again.
  const exitKeepaliveKeysRef = useRef(new Set<OpenItemKey>())
  const creatingTagLabelsRef = useRef(new Set<string>())
  const preferenceSavesInFlightRef = useRef(new Set<Promise<void>>())
  const lastSavedPreferencesRef = useRef(serializeUserPreferences({}))
  const preferenceSaveRequestIdRef = useRef(0)
  const resultsOverlayTimeoutRef = useRef<number | null>(null)
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
  const preferredMaxOpenItems = getMaxOpenItemsPreference(userPreferences)

  // Mirror the saved preference into the store so the ring actions can enforce
  // it without it being threaded through every call site.
  useEffect(() => {
    if (preferredMaxOpenItems === useItemsAppStore.getState().maxOpenItems) return
    detachRemovedEntriesRef.current(setMaxOpenItemsInStore(preferredMaxOpenItems))
  }, [preferredMaxOpenItems, setMaxOpenItemsInStore])

  const handlePasteUrlAsMarkdownChange = useCallback((enabled: boolean) => {
    setUserPreferences((current) =>
      getPasteUrlAsMarkdownPreference(current) === enabled
        ? current
        : withPasteUrlAsMarkdownPreference(current, enabled),
    )
  }, [])

  const clearResultsOverlayTimeout = useCallback(() => {
    if (resultsOverlayTimeoutRef.current === null) return

    window.clearTimeout(resultsOverlayTimeoutRef.current)
    resultsOverlayTimeoutRef.current = null
  }, [])

  const updateResultsColumnWidth = (width: number) => {
    const nextPreferredWidth = clampStoredResultsColumnWidth(width)
    setResultsListVisible(true)
    setPreferredResultsColumnWidth(nextPreferredWidth)
    setResultsColumnWidth(clampResultsColumnWidth(nextPreferredWidth))
    setUserPreferences((current) =>
      getStoredResultsColumnWidth(current) === nextPreferredWidth
        ? current
        : withResultsColumnWidthPreference(current, nextPreferredWidth),
    )
  }

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
    if (isResultsDrawerLayout()) return

    const resizeState = resizeStateRef.current
    if (!resizeState || resizeState.pointerId !== event.pointerId) return

    const delta = resizeState.startX - event.clientX
    if (!resizeState.dragged && Math.abs(delta) < RESIZE_DRAG_THRESHOLD) return

    resizeState.dragged = true
    updateResultsColumnWidth(resizeState.startWidth + delta)
  }

  const handleResizePointerUp = (event: PointerEvent<HTMLButtonElement>) => {
    const resizeState = resizeStateRef.current
    if (!resizeState || resizeState.pointerId !== event.pointerId) return

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

  const handleResultsOverlayClick = useCallback(() => {
    setResultsListVisible(false)
  }, [setResultsListVisible])

  useEffect(() => {
    if (resultsListVisible) {
      clearResultsOverlayTimeout()
      setResultsOverlayMounted(drawerMode)
      return
    }

    if (!resultsOverlayMounted) return

    clearResultsOverlayTimeout()
    resultsOverlayTimeoutRef.current = window.setTimeout(() => {
      resultsOverlayTimeoutRef.current = null
      setResultsOverlayMounted(false)
    }, RESULTS_DRAWER_TRANSITION_MS)

    return clearResultsOverlayTimeout
  }, [clearResultsOverlayTimeout, drawerMode, resultsOverlayMounted, resultsListVisible])

  useEffect(() => clearResultsOverlayTimeout, [clearResultsOverlayTimeout])

  useEffect(() => {
    if (!resultsListVisible) return

    const handleDocumentKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape" && isResultsDrawerLayout()) {
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
    itemsRef.current = items
  }, [items])

  useEffect(() => {
    categoriesRef.current = categories
  }, [categories])

  useEffect(() => {
    tagsRef.current = tags
  }, [tags])
  useEffect(() => {
    activeWorkspaceIdRef.current = activeWorkspaceId
  }, [activeWorkspaceId])

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
      updateItemsCacheUser(normalizedUser.id, normalizedUser)
    },
    [clampResultsColumnWidth],
  )

  /**
   * Send a dirty entry that has left the ring off to the server anyway. Used by
   * eviction, explicit close, and a lowered cap — the three ways a draft can
   * stop being visible while still holding unsaved text.
   */
  const detachRemovedEntries = useCallback<(removed: OpenItemEntry[]) => void>((removed) => {
    for (const entry of removed) {
      if (!isEntryDirty(entry)) continue

      // Text the server will not accept — today that means a note with no
      // category. Dropping it here would destroy it silently, which is exactly
      // what the ring makes easy to miss, since an unsaved note looks no
      // different from a saved one until it is evicted.
      if (!isSaveableForm(entry.form)) {
        if (entry.form.description.trim() !== "") {
          setErrorMessage(
            "A note was closed before it could be saved because it has no category. Reopen it from the list and choose one.",
          )
        }
        continue
      }

      detachedSavesRef.current.set(entry.key, {
        itemId: entry.itemId,
        form: snapshotTextCaptureForm(entry.form),
        savedSignature: entry.savedSignature,
      })
      void saveEntryRef.current(entry.key, "detached")
    }
    if (removed.some((entry) => isEntryDirty(entry))) {
      persistOpenItemsRef.current()
    }
  }, [])

  const detachRemovedEntriesRef = useRef(detachRemovedEntries)
  detachRemovedEntriesRef.current = detachRemovedEntries

  const openItemEntry = useCallback(
    (item: ItemRecord) => {
      // A detached record for this key means the note was evicted while dirty
      // and its save has not landed. The record holds newer text than the
      // server copy `note` carries, so the reopened entry must adopt it —
      // otherwise the editor shows stale text and the next keystroke saves
      // over what the user wrote.
      const key = itemEntryKey(item.id)
      const detached = detachedSavesRef.current.get(key)

      detachRemovedEntries(openExistingItemInStore(item))

      if (!detached) return

      // Ownership returns to the ring. Any still in-flight save is keyed the
      // same way, so it writes its result back into this entry.
      detachedSavesRef.current.delete(key)
      patchEntry(key, {
        form: detached.form,
        savedSignature: detached.savedSignature,
      })
    },
    [detachRemovedEntries, openExistingItemInStore, patchEntry],
  )

  const openDraftEntry = useCallback(
    (
      options: {
        categoryIds?: number[]
        statusId?: number | null
        tagIds?: number[]
        categoryLabel?: string
      } = {},
    ) => {
      detachRemovedEntries(openNewDraftInStore(options))
    },
    [detachRemovedEntries, openNewDraftInStore],
  )

  /**
   * Rebuild the ring from the persisted snapshot, reconciled against the notes
   * that actually exist. Safe to run twice — see the two-pass call in
   * `restoreSession`.
   */
  const rehydrateOpenItems = useCallback(
    (
      userId: number,
      {
        workspaceId,
        itemList,
        categoryList,
        statusList,
        tagList,
        pendingMerge,
        force = false,
      }: {
        workspaceId: number
        itemList: ItemRecord[]
        categoryList: CategoryRecord[]
        statusList: StatusRecord[]
        tagList: TagRecord[]
        pendingMerge: boolean
        force?: boolean
      },
    ) => {
      if (didRehydrateOpenItemsRef.current && !force) return

      const snapshot = readOpenItemsSnapshot(userId, workspaceId)

      // A merge changes the acting user id, so the snapshot is keyed to the old
      // anonymous account. Note rows are reparented and keep their ids, but
      // categories and tags are dedup-remapped, so re-key the snapshot and let
      // reconciliation repair the references. `handleLogin` already flushed
      // everything, so nothing here is unsaved.
      const usable =
        snapshot ?? (pendingMerge ? readOpenItemsSnapshotForAnyUser(userId, workspaceId) : null)

      didRehydrateOpenItemsRef.current = true

      if (!usable) return

      const itemsById = new Map(itemList.map((item) => [item.id, item]))
      const categoryIds = new Set(categoryList.map((category) => category.id))
      const statusIds = new Set(statusList.map((status) => status.id))
      const tagIds = new Set(tagList.map((tag) => tag.id))

      const { state, orphanedDraftCount } = reconcileOpenItems(
        usable,
        (itemId) => itemsById.get(itemId),
        {
          categoryExists: (categoryId) => categoryIds.has(categoryId),
          statusExists: (statusId) => statusIds.has(statusId),
          tagExists: (tagId) => tagIds.has(tagId),
        },
      )

      if (state.openItems.length === 0) return

      replaceOpenItems(state)

      if (orphanedDraftCount > 0) {
        setStatusMessage(
          orphanedDraftCount === 1
            ? "A note you were editing was deleted elsewhere. Your unsaved text was kept as a new note."
            : `${orphanedDraftCount} notes you were editing were deleted elsewhere. Your unsaved text was kept as new notes.`,
        )
      }
    },
    [replaceOpenItems],
  )

  /**
   * Apply `?id=`, `?category=`, and `?tags=` on top of whatever the ring
   * already holds. The URL decides which entry is *active*; it never replaces
   * an entry's content, so a restored draft survives a reload that names it.
   */
  const applyItemsUrlSelection = useCallback(
    ({
      categoryList = categoriesRef.current,
      itemList = itemsRef.current,
      tagList = tagsRef.current,
    }: {
      categoryList?: CategoryRecord[]
      itemList?: ItemRecord[]
      tagList?: TagRecord[]
    } = {}) => {
      const selection = readItemsUrlSelection()
      const store = useItemsAppStore.getState()

      if (selection.itemId !== null) {
        const item = itemList.find((item) => item.id === selection.itemId)
        if (item) {
          // openExistingItem keeps the in-memory draft when the note is already
          // open, so this activates without clobbering unsaved text.
          openItemEntry(item)
          setItemsUrlSelectionReady(true)
          return
        }
      }

      if (store.activeKey !== null) {
        setItemsUrlSelectionReady(true)
        return
      }

      const validTagIds = selection.tagIds.filter((tagId) =>
        tagList.some((tag) => tag.id === tagId),
      )
      const categoryId =
        selection.categoryId !== null &&
        categoryList.some((category) => category.id === selection.categoryId)
          ? selection.categoryId
          : null

      openDraftEntry({
        categoryIds: categoryId === null ? [] : [categoryId],
        tagIds: validTagIds,
        categoryLabel:
          categoryId === null
            ? ""
            : (categoryList.find((category) => category.id === categoryId)?.label ?? ""),
      })
      setItemsUrlSelectionReady(true)
    },
    [openDraftEntry, openItemEntry],
  )

  const handleCancelEdit = useCallback(() => {
    // Adds a draft alongside the open notes rather than replacing one. The
    // outgoing entry keeps autosaving in the background, so there is nothing
    // to await here.
    clearMessages()
    openDraftEntry()
  }, [clearMessages, openDraftEntry])

  const handleAddItemInCategory = useCallback(() => {
    clearMessages()
    const categoryIds =
      useItemsAppStore.getState().openItems.find((entry) => entry.key === activeKey)?.form
        .selectedCategoryIds ?? []
    openDraftEntry({
      categoryIds: categoryIds.filter((id) => categoriesRef.current.some((c) => c.id === id)),
    })
  }, [activeKey, clearMessages, openDraftEntry])

  const loadItems = useCallback(
    async (userId: number, workspaceId = activeWorkspaceIdRef.current) => {
      if (workspaceId === null) return []
      // Only show the blocking "Loading…" indicator on the cold path, when we
      // have nothing to display yet. Background refreshes (post-CRUD and the
      // stale-while-revalidate startup) should keep showing the existing data.
      const showLoadingIndicator = itemsRef.current.length === 0
      if (showLoadingIndicator) setItemsLoading(true)
      try {
        const response = await itemsFetch(`/api/items?workspaceId=${workspaceId}`, {
          cache: "no-store",
        })
        const data = await readJson<ItemsResponse>(response)
        if (activeWorkspaceIdRef.current !== workspaceId) return data.items
        setItems(data.items.filter(isTextItem))
        updateItemsCacheList(userId, workspaceId, "items", data.items)
        return data.items
      } finally {
        if (showLoadingIndicator) setItemsLoading(false)
      }
    },
    [],
  )

  const loadCategories = useCallback(
    async (userId: number, workspaceId = activeWorkspaceIdRef.current) => {
      if (workspaceId === null) return []
      const response = await itemsFetch(`/api/categories?workspaceId=${workspaceId}`, {
        cache: "no-store",
      })
      const data = await readJson<CategoriesResponse>(response)
      if (activeWorkspaceIdRef.current !== workspaceId) return data.categories
      setCategories(data.categories)
      updateItemsCacheList(userId, workspaceId, "categories", data.categories)
      return data.categories
    },
    [],
  )

  const loadTags = useCallback(
    async (userId: number, workspaceId = activeWorkspaceIdRef.current) => {
      if (workspaceId === null) return []
      const response = await itemsFetch(`/api/tags?workspaceId=${workspaceId}`, {
        cache: "no-store",
      })
      const data = await readJson<TagsResponse>(response)
      if (activeWorkspaceIdRef.current !== workspaceId) return data.tags
      setTags(data.tags)
      updateItemsCacheList(userId, workspaceId, "tags", data.tags)
      return data.tags
    },
    [],
  )

  const runSearch = useCallback(async (userId: number, query: string, limit: number) => {
    const workspaceId = activeWorkspaceIdRef.current
    if (workspaceId === null) return []
    const response = await itemsFetch("/api/items/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId,
        workspaceId,
        query,
        limit: Math.min(Math.max(limit, 1), ITEMS_APP_SEARCH_MAX_RESULTS),
      }),
    })
    const data = await readJson<SearchResponse>(response)
    if (activeWorkspaceIdRef.current !== workspaceId) return data.results
    setSearchResults(data.results.filter(({ item }) => isTextItem(item)))
    return data.results
  }, [])

  useEffect(() => {
    let active = true

    setStartupErrorMessage(null)
    setSessionLoading(true)

    const fetchFreshSession = async (
      userId: string | number,
      {
        applyUser,
        workspaceId,
      }: {
        applyUser: boolean
        workspaceId?: number
      },
    ) => {
      const bootstrapResponse = await fetchWithTimeout(
        workspaceId === undefined ? "/api/bootstrap" : `/api/bootstrap?workspaceId=${workspaceId}`,
        {
          cache: "no-store",
        },
      )
      const bootstrapData = await readJson<BootstrapResponse>(bootstrapResponse)
      const expectedUserId = Number(userId)
      if (Number.isInteger(expectedUserId) && bootstrapData.user.id !== expectedUserId) {
        throw new RequestError("The active session changed during startup.", 401)
      }
      const sessionData: SessionResponse = {
        user: bootstrapData.user,
      }

      // On the cache-first path the in-memory preferences came from a snapshot
      // that can be arbitrarily old. Whether the fresh server copy may replace
      // them turns on one question: has the user changed a preference that the
      // debounced PATCH has not saved yet?
      const hasUnsavedPreferenceEdit =
        serializeUserPreferences(userPreferencesRef.current) !== lastSavedPreferencesRef.current

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
        updateItemsCacheUser(sessionData.user.id, userForCache)
      }

      const loadedItems = bootstrapData.items.filter(isTextItem)
      const loadedCategories = bootstrapData.categories
      const loadedStatuses = bootstrapData.statuses
      const loadedTags = bootstrapData.tags

      setItems(loadedItems)
      setCategories(loadedCategories)
      setStatuses(loadedStatuses)
      setTags(loadedTags)
      setWorkspaces(bootstrapData.workspaces)
      setActiveWorkspaceId(bootstrapData.activeWorkspaceId)

      writeItemsCache({
        userId: sessionData.user.id,
        user: userForCache,
        workspaces: bootstrapData.workspaces,
        activeWorkspaceId: bootstrapData.activeWorkspaceId,
        items: loadedItems,
        categories: loadedCategories,
        statuses: loadedStatuses,
        tags: loadedTags,
      })

      return {
        sessionData,
        activeWorkspaceId: bootstrapData.activeWorkspaceId,
        loadedItems,
        loadedCategories,
        loadedStatuses,
        loadedTags,
      }
    }

    const recoverSession = (error: unknown) =>
      recoverExpiredSession(error, {
        persistDrafts: () => persistOpenItemsRef.current(),
        resetSession: () => {
          setUser(null)
          setStartupErrorMessage("Your session expired. Starting a new visitor session…")
          window.localStorage.removeItem(STORAGE_KEY)
          clearItemsCache()
          preferenceSaveRequestIdRef.current += 1
          lastSavedPreferencesRef.current = serializeUserPreferences({})
          setUserPreferences({})
          setCategories([])
          setStatuses([])
          setTags([])
          setWorkspaces([])
          setActiveWorkspaceId(null)
          setItems([])
          detachedSavesRef.current.clear()
          didRehydrateOpenItemsRef.current = false
          resetItemsAppStore()
          setSearchResults([])
          setSearchErrorMessage(null)
          setResultsListVisible(!isResultsDrawerLayout())
          setPreferredResultsColumnWidth(RESULTS_COLUMN_DEFAULT_WIDTH)
          setResultsColumnWidth(RESULTS_COLUMN_DEFAULT_WIDTH)
        },
        signOut: () => signOut({ redirect: false }),
      })

    const restoreSession = async () => {
      if (authStatus === "loading") {
        return
      }

      if (authStatus !== "authenticated" || !authSession?.user?.itemsUserId) {
        window.localStorage.removeItem(STORAGE_KEY)
        setSessionLoading(false)
        return
      }

      const storedUserId = String(authSession.user.itemsUserId)
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
            mergeResponse = await itemsFetch("/api/anon-session/merge", {
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
        !pendingMergeToken && Number.isInteger(numericUserId) ? readItemsCache(numericUserId) : null

      // Stale-while-revalidate. If we have a recent local snapshot for this
      // user, render the app immediately from cache and refresh in the
      // background. This is what removes the "Restoring session…" wait on the
      // PWA homescreen launch when the user has opened the app before.
      if (cachedSnapshot) {
        applyLoadedUser(cachedSnapshot.user)
        setItems(cachedSnapshot.items.filter(isTextItem))
        setCategories(cachedSnapshot.categories)
        setStatuses(cachedSnapshot.statuses)
        setTags(cachedSnapshot.tags)
        setWorkspaces(cachedSnapshot.workspaces)
        setActiveWorkspaceId(cachedSnapshot.activeWorkspaceId)
        // Reconcile against the cached list so the ring paints immediately…
        rehydrateOpenItems(cachedSnapshot.userId, {
          workspaceId: cachedSnapshot.activeWorkspaceId,
          itemList: cachedSnapshot.items,
          categoryList: cachedSnapshot.categories,
          statusList: cachedSnapshot.statuses,
          tagList: cachedSnapshot.tags,
          pendingMerge: Boolean(pendingMergeToken),
        })
        applyItemsUrlSelection({
          categoryList: cachedSnapshot.categories,
          itemList: cachedSnapshot.items,
          tagList: cachedSnapshot.tags,
        })
        setSessionLoading(false)

        try {
          const refreshed = await fetchFreshSession(cachedSnapshot.userId, {
            applyUser: false,
            workspaceId: cachedSnapshot.activeWorkspaceId,
          })
          if (!active) return
          // …then again once the real data lands. The cached list can be up to
          // two weeks old, so it cannot be trusted to say whether a note still
          // exists. Reconciling is idempotent and never touches a dirty entry,
          // so the second pass only corrects clean ones.
          rehydrateOpenItems(cachedSnapshot.userId, {
            workspaceId: refreshed.activeWorkspaceId,
            itemList: refreshed.loadedItems,
            categoryList: refreshed.loadedCategories,
            statusList: refreshed.loadedStatuses,
            tagList: refreshed.loadedTags,
            pendingMerge: false,
            force: true,
          })
        } catch (error) {
          if (!active) return
          try {
            await recoverSession(error)
          } catch (recoveryError) {
            setStartupErrorMessage(getErrorMessage(recoveryError))
          }
          // Network and server failures keep the cached view and its drafts.
          // A confirmed 401 ends the stale session on this path too.
        }
        return
      }

      try {
        const result = await fetchFreshSession(storedUserId, { applyUser: true })
        if (!active) return

        rehydrateOpenItems(result.sessionData.user.id, {
          workspaceId: result.activeWorkspaceId,
          itemList: result.loadedItems,
          categoryList: result.loadedCategories,
          statusList: result.loadedStatuses,
          tagList: result.loadedTags,
          pendingMerge: Boolean(pendingMergeToken),
        })
        applyItemsUrlSelection({
          categoryList: result.loadedCategories,
          itemList: result.loadedItems,
          tagList: result.loadedTags,
        })
      } catch (error) {
        if (!active) return
        try {
          if (await recoverSession(error)) return
        } catch (recoveryError) {
          setUser(null)
          setStartupErrorMessage(getErrorMessage(recoveryError))
          return
        }

        // An outage is not evidence that the session or persisted drafts are
        // invalid. Keep them intact and offer an explicit retry.
        setUser(null)
        setStartupErrorMessage(getErrorMessage(error))
      } finally {
        if (active) setSessionLoading(false)
      }
    }

    void restoreSession()
    return () => {
      active = false
    }
  }, [
    authSession?.user?.itemsUserId,
    authSession?.user?.isAnonymous,
    authStatus,
    startupRetryKey,
    applyLoadedUser,
    loadCategories,
    loadTags,
    loadItems,
    applyItemsUrlSelection,
    rehydrateOpenItems,
    resetItemsAppStore,
    setResultsListVisible,
  ])

  useEffect(() => {
    if (!user || backupOperation !== null) return

    const serializedPreferences = serializeUserPreferences(userPreferences)
    if (serializedPreferences === lastSavedPreferencesRef.current) return

    const requestId = preferenceSaveRequestIdRef.current + 1
    preferenceSaveRequestIdRef.current = requestId

    const timeoutId = window.setTimeout(() => {
      if (useItemsAppStore.getState().backupOperation !== null) return
      const pendingSave = itemsFetch("/api/session", {
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
          updateItemsCacheUser(data.user.id, { ...data.user, preferences: nextPreferences })
          setPreferredResultsColumnWidth(nextPreferredResultsColumnWidth)
          setResultsColumnWidth(clampResultsColumnWidth(nextPreferredResultsColumnWidth))
        })
        .catch((error: unknown) => {
          if (preferenceSaveRequestIdRef.current !== requestId) return
          setErrorMessage(getErrorMessage(error))
        })
        .finally(() => preferenceSavesInFlightRef.current.delete(pendingSave))
      preferenceSavesInFlightRef.current.add(pendingSave)
    }, PREFERENCES_SAVE_DEBOUNCE_MS)

    return () => window.clearTimeout(timeoutId)
  }, [backupOperation, clampResultsColumnWidth, user, userPreferences])

  useEffect(() => {
    if (!user) return
    if (!itemsUrlSelectionReady) return

    // Mirrors the *active* entry so the address bar stays copy-pasteable.
    writeItemsUrlSelection({
      itemId: activeEntry?.itemId ?? null,
      categoryId: activeEntry?.form.selectedCategoryIds[0] ?? null,
      tagIds: activeEntry?.form.selectedTagIds ?? [],
    })
  }, [
    activeEntry?.itemId,
    activeEntry?.form.selectedCategoryIds,
    activeEntry?.form.selectedTagIds,
    itemsUrlSelectionReady,
    user,
  ])

  useEffect(() => {
    if (!user) return

    const handlePopState = () => {
      // No flush needed: the target note is already in memory with its own
      // draft, so applying the URL selection is non-destructive.
      applyItemsUrlSelection()
    }

    window.addEventListener("popstate", handlePopState)
    return () => {
      window.removeEventListener("popstate", handlePopState)
    }
  }, [applyItemsUrlSelection, user])

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

      void itemsFetch("/api/items/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: user.id,
          workspaceId: activeWorkspaceId,
          query: trimmedSearchQuery,
          limit: ITEMS_APP_SEARCH_MAX_RESULTS,
        }),
        signal: controller.signal,
      })
        .then((response) => readJson<SearchResponse>(response))
        .then((data) => {
          setSearchResults(data.results.filter(({ item }) => isTextItem(item)))
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
  }, [activeWorkspaceId, items.length, trimmedSearchQuery, user])

  /**
   * Point every open entry at a category that still exists. Runs where
   * categories actually change rather than on the save path.
   *
   * A change made here is not a user edit, so a clean entry has to stay clean:
   * its signature moves with the form, otherwise autosave would immediately
   * push the remap back to the server as if the user had made it.
   */
  const remapEntriesAfterCategoryChange = useCallback(
    (
      itemList: ItemRecord[],
      categoryList: CategoryRecord[],
      statusList: StatusRecord[],
      tagList: TagRecord[],
    ) => {
      patchEveryEntry((entry) => {
        const serverItem =
          entry.itemId === null ? undefined : itemList.find((item) => item.id === entry.itemId)
        if (serverItem && !isEntryDirty(entry)) {
          const form = itemToFormState(serverItem)
          return {
            form,
            baseTimeModified: serverItem.timeModified,
            savedSignature: serializeItemDraft(serverItem.id, form),
            categoryInputValue: serverItem.categories.map((category) => category.label).join(", "),
            pendingTagLabels: [],
          }
        }

        const validIds = entry.form.selectedCategoryIds.filter((id) =>
          categoryList.some((category) => category.id === id),
        )
        const validStatusId =
          entry.form.selectedStatusId === null ||
          statusList.some((status) => status.id === entry.form.selectedStatusId)
            ? entry.form.selectedStatusId
            : null
        const validTagIds = entry.form.selectedTagIds.filter((id) =>
          tagList.some((tag) => tag.id === id),
        )
        if (
          validIds.length === entry.form.selectedCategoryIds.length &&
          validStatusId === entry.form.selectedStatusId &&
          validTagIds.length === entry.form.selectedTagIds.length
        ) {
          return {}
        }

        const form = {
          ...entry.form,
          selectedCategoryIds: validIds,
          selectedStatusId: validStatusId,
          selectedTagIds: validTagIds,
        }
        return {
          form,
          savedSignature: isEntryDirty(entry)
            ? entry.savedSignature
            : serializeItemDraft(entry.itemId, form),
          categoryInputValue: form.selectedCategoryIds
            .map((id) => categoryList.find((category) => category.id === id)?.label)
            .filter(Boolean)
            .join(", "),
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
  const applyServerItemToEntry = useCallback(
    (item: ItemRecord) => {
      const entry = useItemsAppStore.getState().openItems.find((entry) => entry.itemId === item.id)
      if (!entry) return

      const form = itemToFormState(item)
      patchEntry(entry.key, {
        form,
        baseTimeModified: item.timeModified,
        savedSignature: serializeItemDraft(item.id, form),
        categoryInputValue: item.categories.map((category) => category.label).join(", "),
        pendingTagLabels: [],
      })
    },
    [patchEntry],
  )

  /**
   * The active entry's form, or a stable empty draft while the ring is still
   * being built, so `TextCaptureForm` never has to handle a null form.
   */
  const activeForm = activeEntry?.form ?? EMPTY_ITEM_FORM

  // Derived here rather than through a store selector: a selector that builds a
  // new array each call gives useSyncExternalStore a different snapshot every
  // time and spins forever.
  const openItemIds = useMemo(
    () => openItems.flatMap((entry) => (entry.itemId === null ? [] : [entry.itemId])),
    [openItems],
  )

  const setActiveForm = useCallback<Dispatch<SetStateAction<TextCaptureFormState>>>(
    (value) => {
      const key = useItemsAppStore.getState().activeKey
      if (key === null) return
      patchEntryForm(key, (current) =>
        typeof value === "function"
          ? (value as (f: TextCaptureFormState) => TextCaptureFormState)(current)
          : value,
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
  const handleCloseOpenItem = useCallback(
    (key: OpenItemKey) => {
      detachRemovedEntries(closeEntryInStore(key))
    },
    [closeEntryInStore, detachRemovedEntries],
  )

  const handleMaxOpenItemsChange = useCallback(
    (value: number) => {
      const next = clampMaxOpenItems(value)
      // Lowering the cap evicts right away rather than waiting for the next
      // note to be opened, and the dropped entries still get saved.
      detachRemovedEntries(setMaxOpenItemsInStore(next))
      setUserPreferences((current) =>
        getMaxOpenItemsPreference(current) === next
          ? current
          : withMaxOpenItemsPreference(current, next),
      )
    },
    [detachRemovedEntries, setMaxOpenItemsInStore],
  )

  /**
   * Refresh category and tag records after saves, coalesced across all of them
   * so a burst of autosaves costs one round-trip rather than one each.
   *
   * These carry `itemCount`, which is not only sidebar decoration: `openDeleteTag`
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
        const workspaceId = activeWorkspaceIdRef.current
        if (workspaceId !== null)
          void Promise.all([
            loadCategories(userId, workspaceId),
            loadTags(userId, workspaceId),
            itemsFetch(`/api/statuses?workspaceId=${workspaceId}`, { cache: "no-store" })
              .then(readJson<import("@lib/db-items").StatusesResponse>)
              .then((data) => {
                if (activeWorkspaceIdRef.current !== workspaceId) return
                setStatuses(data.statuses)
                updateItemsCacheList(userId, workspaceId, "statuses", data.statuses)
              }),
          ]).catch(() => undefined)
      }, TAXONOMY_REFRESH_DEBOUNCE_MS)
    },
    [loadCategories, loadTags],
  )

  /** Merge a saved record into the lists in place, instead of refetching them. */
  const mergeSavedItem = useCallback((userId: number, item: ItemRecord) => {
    if (activeWorkspaceIdRef.current !== item.workspaceId) return
    setItems((prev) => {
      const next = [...prev.filter((existing) => existing.id !== item.id), item]
      updateItemsCacheList(userId, item.workspaceId, "items", next)
      return next
    })
    // The search effect only re-runs when `items.length` changes, so an edit to
    // an already-listed note would otherwise leave stale text in the results.
    setSearchResults((prev) =>
      prev.some((result) => result.item.id === item.id)
        ? prev.map((result) => (result.item.id === item.id ? { ...result, item } : result))
        : prev,
    )
  }, [])

  const refreshResults = useCallback(
    async (userId: number) => {
      const workspaceId = activeWorkspaceIdRef.current
      if (workspaceId === null) return { latestItems: [], latestCategories: [], latestTags: [] }
      const [latestItems, latestCategories, latestTags, statusData] = await Promise.all([
        loadItems(userId),
        loadCategories(userId),
        loadTags(userId),
        itemsFetch(`/api/statuses?workspaceId=${workspaceId}`, { cache: "no-store" }).then(
          readJson<import("@lib/db-items").StatusesResponse>,
        ),
      ])
      if (activeWorkspaceIdRef.current !== workspaceId)
        return { latestItems: [], latestCategories: [], latestTags: [] }
      setStatuses(statusData.statuses)
      updateItemsCacheList(userId, workspaceId, "statuses", statusData.statuses)
      remapEntriesAfterCategoryChange(
        latestItems,
        latestCategories,
        statusData.statuses,
        latestTags,
      )
      if (trimmedSearchQuery) {
        await runSearch(userId, trimmedSearchQuery, ITEMS_APP_SEARCH_MAX_RESULTS)
      }
      return { latestItems, latestCategories, latestTags }
    },
    [
      loadCategories,
      loadTags,
      loadItems,
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
    async function saveEntry(key: OpenItemKey, mode: ItemSaveMode): Promise<boolean> {
      const currentUser = userRef.current
      const workspaceId = activeWorkspaceIdRef.current
      // No session to save into. Not a failure the caller can act on, but not
      // a success either — a sign-in flush must not read this as "all stored".
      if (!currentUser || workspaceId === null) return false

      // Snapshot before awaiting anything. For a detached entry the snapshot is
      // all that is left of it; for a live one this pins the version being sent
      // so later keystrokes belong to the next save, not this one.
      const detached = detachedSavesRef.current.get(key)
      const entry = useItemsAppStore.getState().openItems.find((item) => item.key === key)

      const source = detached ?? entry
      // Nothing left to save: the entry was closed and its work already landed.
      if (!source) return true

      const formSnapshot = snapshotTextCaptureForm(source.form)
      let itemId = source.itemId
      let draftSignature = serializeItemDraft(itemId, formSnapshot)

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
        // one has to PATCH it; carrying the original `itemId: null` through
        // would POST a second copy. The detached record is checked first
        // because an evicted entry has no store slot to have been written to.
        const settled =
          detachedSavesRef.current.get(key) ??
          useItemsAppStore.getState().openItems.find((item) => item.key === key)
        if (!settled) return true

        itemId = settled.itemId
        draftSignature = serializeItemDraft(itemId, formSnapshot)
        if (draftSignature === settled.savedSignature) return true
      }

      if (!detached) patchEntry(key, { saveStatus: "saving" })

      const savePromise = (async () => {
        const requestBody =
          itemId === null
            ? { userId: currentUser.id, item: itemRequestBody(formSnapshot, workspaceId) }
            : { userId: currentUser.id, itemId, item: itemRequestBody(formSnapshot, workspaceId) }

        const response = await itemsFetch("/api/items", {
          method: itemId === null ? "POST" : "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestBody),
        })
        const data = await readJson<{ item: ItemRecord }>(response)

        if (userRef.current?.id !== currentUser.id) return

        mergeSavedItem(currentUser.id, data.item)
        scheduleTaxonomyRefresh(currentUser.id)

        // Write back by key. The old "is this still the note on screen" guard
        // existed only because there was one editor slot; with per-entry state
        // this is correct whether or not the user has moved on.
        const landedSignature = serializeItemDraft(data.item.id, formSnapshot)
        patchEntry(key, {
          itemId: data.item.id,
          baseTimeModified: data.item.timeModified,
          savedSignature: landedSignature,
        })

        // Keep any detached record for this key in step. Without this, an entry
        // evicted mid-create keeps `itemId: null` and the next detached save or
        // exit keepalive POSTs a second copy of the same note.
        const pendingDetached = detachedSavesRef.current.get(key)
        if (pendingDetached) {
          detachedSavesRef.current.set(key, {
            ...pendingDetached,
            itemId: data.item.id,
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
          const live = useItemsAppStore.getState().openItems.find((item) => item.key === key)
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
        if (persisted) {
          detachedSavesRef.current.delete(key)
          // Evicted notes live in the snapshot until this lands. Drop them now
          // so a reload does not reopen a note the user already closed.
          if (detached) persistOpenItemsRef.current()
        }
      }

      if (queuedAutosaveKeysRef.current.delete(key)) {
        const latest = useItemsAppStore.getState().openItems.find((item) => item.key === key)
        if (latest && isSaveableForm(latest.form) && isEntryDirty(latest)) {
          void saveEntry(key, "autosave")
        }
      }

      return persisted
    },
    [mergeSavedItem, patchEntry, scheduleTaxonomyRefresh],
  )

  saveEntryRef.current = saveEntry

  /**
   * Persist every non-empty dirty entry and wait for all of them. Used only
   * where the session itself is about to change — sign-in, sign-up, sign-out —
   * since ordinary note switching no longer needs to block on a save. The
   * savedSignature can leave an untouched new slot technically dirty, but there is
   * no content to save and it must not block the session change.
   */
  const flushAllPendingSaves = useCallback(async () => {
    const entries = collectSessionFlushEntries(useItemsAppStore.getState().openItems, isEntryDirty)
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

  useOpenItemsAutosave({
    entries: openItems,
    enabled: Boolean(user),
    saveEntry,
  })

  // Keep each entry's indicator in sync whenever a save is not running for it
  // (the save routine owns the status while its request is in flight).
  useEffect(() => {
    if (!user) return

    for (const entry of openItems) {
      if (saveInFlightRef.current.has(entry.key)) continue

      const next =
        entry.form.description.trim() === "" && entry.itemId === null
          ? "idle"
          : isEntryDirty(entry)
            ? "unsaved"
            : "saved"

      if (entry.saveStatus !== next) patchEntry(entry.key, { saveStatus: next })
    }
  }, [openItems, patchEntry, user])

  // Best-effort save when the tab is being hidden or torn down. Keepalive
  // bodies share a browser quota, so the durable guarantee is the local
  // snapshot — written first, while entries are still dirty — not the fan-out.
  useEffect(() => {
    if (!user) return

    const flushOnExit = () => {
      const currentUser = userRef.current
      const workspaceId = activeWorkspaceIdRef.current
      if (!currentUser || workspaceId === null) return

      persistOpenItemsRef.current()

      const store = useItemsAppStore.getState()
      const pending = collectExitFlushItems(
        store.openItems,
        detachedSavesRef.current,
        isEntryDirty,
        isSaveableForm,
      )
      const keepalive = selectKeepaliveExitItems(pending, exitKeepaliveKeysRef.current)

      for (const { key, itemId, form } of keepalive) {
        exitKeepaliveKeysRef.current.add(key)

        const requestBody = {
          userId: currentUser.id,
          itemId,
          item: itemRequestBody(form, workspaceId),
        }

        try {
          void itemsFetch("/api/items", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(requestBody),
            keepalive: true,
          }).catch(() => undefined)
        } catch {
          // Ignore — this is a best-effort save during teardown.
        }
      }
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        flushOnExit()
        return
      }
      exitKeepaliveKeysRef.current.clear()
    }

    window.addEventListener("pagehide", flushOnExit)
    document.addEventListener("visibilitychange", handleVisibilityChange)
    return () => {
      window.removeEventListener("pagehide", flushOnExit)
      document.removeEventListener("visibilitychange", handleVisibilityChange)
    }
  }, [user])

  // Persist the ring so a reload keeps the open notes and their unsaved text.
  // Debounced: this must never run on a keystroke, since JSON.stringify plus a
  // synchronous localStorage write on the main thread is exactly the jank this
  // whole change exists to remove.
  const persistOpenItems = useCallback(() => {
    const currentUser = userRef.current
    const workspaceId = activeWorkspaceIdRef.current
    if (!currentUser || workspaceId === null) return

    const ok = writeOpenItemsSnapshot(
      currentUser.id,
      workspaceId,
      stateWithDetachedSaves(useItemsAppStore.getState(), detachedSavesRef.current),
      isEntryDirty,
    )
    if (!ok) {
      setErrorMessage(
        "Running low on browser storage — some unsaved notes may not survive a reload.",
      )
    }
  }, [])

  persistOpenItemsRef.current = persistOpenItems

  useEffect(() => {
    if (!user) return
    if (!didRehydrateOpenItemsRef.current) return

    if (openItemsPersistTimeoutRef.current !== null) {
      window.clearTimeout(openItemsPersistTimeoutRef.current)
    }

    openItemsPersistTimeoutRef.current = window.setTimeout(() => {
      openItemsPersistTimeoutRef.current = null
      persistOpenItems()
    }, OPEN_ITEMS_PERSIST_DEBOUNCE_MS)

    return () => {
      if (openItemsPersistTimeoutRef.current === null) return
      window.clearTimeout(openItemsPersistTimeoutRef.current)
      openItemsPersistTimeoutRef.current = null
    }
  }, [activeKey, openItems, persistOpenItems, user])

  // The reveal highlight is a one-shot: the editor consumes it at mount, so
  // clear it once handed over. Otherwise coming back to a note opened from a
  // search result would re-scroll and re-highlight every time.
  useEffect(() => {
    if (!activeEntry?.revealText) return
    patchEntry(activeEntry.key, { revealText: null })
  }, [activeEntry?.key, activeEntry?.revealText, patchEntry])

  const matchesSelectedTag = useCallback(
    (item: ItemRecord) =>
      selectedTagId === null || item.tags.some((tag) => tag.id === selectedTagId),
    [selectedTagId],
  )

  const searchItems = useMemo<DisplayItemItem[]>(() => {
    if (!searchMode) {
      return []
    }

    return [...searchResults]
      .filter((result) => matchesSelectedTag(result.item))
      .sort((left, right) => right.similarity - left.similarity)
      .map((result) => ({
        item: result.item,
        relevance: result.similarity,
      }))
  }, [matchesSelectedTag, searchMode, searchResults])

  const allItemItems = useMemo<DisplayItemItem[]>(
    () =>
      [...items]
        .sort((left, right) => getItemSortTime(right) - getItemSortTime(left))
        .map((item) => ({ item })),
    [items],
  )

  const allCategoryItems = useMemo<DisplayItemItem[]>(
    () => allItemItems.filter(({ item }) => matchesSelectedTag(item)),
    [allItemItems, matchesSelectedTag],
  )

  const categoryItemGroups = useMemo(
    () => buildCategoryItemGroups(categories, allCategoryItems),
    [categories, allCategoryItems],
  )

  const tagItemGroups = useMemo<TagItemGroup[]>(() => {
    const itemsByTag = new Map<number, DisplayItemItem[]>()
    for (const tag of tags) {
      itemsByTag.set(tag.id, [])
    }

    for (const item of allItemItems) {
      for (const tag of item.item.tags) {
        itemsByTag.get(tag.id)?.push(item)
      }
    }

    return tags
      .map((tag) => {
        const items = itemsByTag.get(tag.id) ?? []

        return {
          tag,
          items,
          sortTime: getGroupSortTime(items),
        }
      })
      .sort(compareItemGroups)
  }, [allItemItems, tags])

  const statusItemGroups = useMemo<StatusItemGroup[]>(
    () =>
      statuses.map((status) => ({
        status,
        items: allItemItems.filter(({ item }) => item.status?.id === status.id),
      })),
    [allItemItems, statuses],
  )

  const noStatusItems = useMemo(
    () => allItemItems.filter(({ item }) => item.status === null),
    [allItemItems],
  )

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
      const response = await itemsFetch("/api/items/maintenance/embeddings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: user.id,
          workspaceId: activeWorkspaceId,
          mode,
          limit: Math.min(Math.max(items.length, 100), 500),
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
      if (authSession?.user?.isAnonymous && authSession.user.itemsUserId) {
        let mergeTokenCaptured = false
        try {
          const tokenResponse = await itemsFetch("/api/anon-session/merge-token", {
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
        if (!mergeTokenCaptured && itemsRef.current.length > 0) {
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
      const claimResponse = await itemsFetch("/api/anon-session/claim", {
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
    clearItemsCache()
    preferenceSaveRequestIdRef.current += 1
    lastSavedPreferencesRef.current = serializeUserPreferences({})
    setUser(null)
    setUserPreferences({})
    setCategories([])
    setStatuses([])
    setTags([])
    setWorkspaces([])
    setActiveWorkspaceId(null)
    setItems([])
    setSearchQuery("")
    setSearchResults([])
    setSearchErrorMessage(null)
    clearOpenItemsSnapshot()
    detachedSavesRef.current.clear()
    didRehydrateOpenItemsRef.current = false
    resetItemsAppStore()
    setResultsListVisible(!isResultsDrawerLayout())
    setPreferredResultsColumnWidth(RESULTS_COLUMN_DEFAULT_WIDTH)
    setResultsColumnWidth(RESULTS_COLUMN_DEFAULT_WIDTH)
    clearMessages()
  }

  const prepareDataTransfer = async () => {
    if (!user) throw new Error("Sign in before managing your data.")
    if (!(await flushAllPendingSaves())) {
      throw new Error("Couldn't save all your notes. Check your connection and try again.")
    }
    persistOpenItems()
    // A debounced preference PATCH must finish before export/restore, or it
    // could miss the backup or overwrite preferences imported moments later.
    preferenceSaveRequestIdRef.current++
    await Promise.all([...preferenceSavesInFlightRef.current])
    const preferences = userPreferencesRef.current
    if (serializeUserPreferences(preferences) !== lastSavedPreferencesRef.current) {
      const data = await readJson<SessionResponse>(
        await itemsFetch("/api/session", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ preferences }),
        }),
      )
      applyLoadedUser(data.user)
    }
  }

  const handleDownloadBackup = async () => {
    const store = useItemsAppStore.getState()
    if (store.backupOperation !== null) return
    store.setBackupOperation("download")
    try {
      await prepareDataTransfer()
      const response = await fetchWithTimeout("/api/backup", { cache: "no-store" }, 120_000)
      if (!response.ok) await readJson(response)
      const url = URL.createObjectURL(await response.blob())
      const link = document.createElement("a")
      link.href = url
      link.download = `jot-new-backup-${new Date().toISOString().slice(0, 10)}.json`
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
      setStatusMessage("Your backup download has started.")
    } catch (error) {
      setErrorMessage(getErrorMessage(error))
      throw error
    } finally {
      store.setBackupOperation(null)
    }
  }

  const handleRestoreBackup = async (file: File): Promise<RestoreBackupResponse> => {
    const store = useItemsAppStore.getState()
    if (store.backupOperation !== null) throw new Error("A backup operation is already running.")
    if (!user) throw new Error("Sign in before restoring a backup.")
    store.setBackupOperation("restore")
    try {
      await prepareDataTransfer()
      const result = await readJson<RestoreBackupResponse>(
        await fetchWithTimeout(
          "/api/backup",
          { method: "POST", headers: { "Content-Type": "application/json" }, body: file },
          120_000,
        ),
      )
      // Merge is additive, so keep the current workspace and every open editor
      // entry. Refresh server data and cache without tearing down draft storage.
      try {
        const data = await readJson<BootstrapResponse>(
          await itemsFetch(`/api/bootstrap?workspaceId=${activeWorkspaceIdRef.current}`, {
            cache: "no-store",
          }),
        )
        if (data.user.id !== user.id) throw new Error("The active account changed.")
        applyLoadedUser(data.user)
        setWorkspaces(data.workspaces)
        setItems(data.items.filter(isTextItem))
        setCategories(data.categories)
        setStatuses(data.statuses)
        setTags(data.tags)
        setSearchResults([])
        writeItemsCache({
          userId: user.id,
          user: data.user,
          workspaces: data.workspaces,
          activeWorkspaceId: data.activeWorkspaceId,
          items: data.items,
          categories: data.categories,
          statuses: data.statuses,
          tags: data.tags,
        })
      } catch {
        // The committed import succeeded. Show that result even if the refresh
        // failed; an explicit retry is safe because exact copies are skipped.
        setErrorMessage(
          "Your backup was restored, but the view couldn't refresh. Reload to see the imported data.",
        )
      }
      return result
    } finally {
      store.setBackupOperation(null)
    }
  }

  const handleSwitchWorkspace = async (workspaceId: number) => {
    if (!user || workspaceId === activeWorkspaceId) return
    if (!(await flushAllPendingSaves())) {
      setErrorMessage("Couldn't save all notes, so the workspace was not changed.")
      return
    }
    persistOpenItems()
    setItemsLoading(true)
    try {
      const response = await itemsFetch(`/api/bootstrap?workspaceId=${workspaceId}`, {
        cache: "no-store",
      })
      const data = await readJson<BootstrapResponse>(response)
      setWorkspaces(data.workspaces)
      setActiveWorkspaceId(data.activeWorkspaceId)
      setItems(data.items.filter(isTextItem))
      setCategories(data.categories)
      setStatuses(data.statuses)
      setTags(data.tags)
      const nextUserPreferences: UserPreferences = {
        ...userPreferencesRef.current,
        notesApp: {
          ...(isPreferencesObject(userPreferencesRef.current.notesApp)
            ? userPreferencesRef.current.notesApp
            : {}),
          currentWorkspaceId: data.activeWorkspaceId,
        },
      }
      writeItemsCache({
        userId: user.id,
        user: { ...user, preferences: nextUserPreferences },
        workspaces: data.workspaces,
        activeWorkspaceId: data.activeWorkspaceId,
        items: data.items,
        categories: data.categories,
        statuses: data.statuses,
        tags: data.tags,
      })
      detachedSavesRef.current.clear()
      resetItemsAppStore()
      didRehydrateOpenItemsRef.current = false
      rehydrateOpenItems(user.id, {
        workspaceId: data.activeWorkspaceId,
        itemList: data.items,
        categoryList: data.categories,
        statusList: data.statuses,
        tagList: data.tags,
        pendingMerge: false,
        force: true,
      })
      if (useItemsAppStore.getState().openItems.length === 0) {
        openDraftEntry()
      }
      setUserPreferences(nextUserPreferences)
      setSearchQuery("")
      setStatusMessage(
        `Switched to “${data.workspaces.find((w) => w.id === data.activeWorkspaceId)?.label ?? "workspace"}”.`,
      )
    } catch (error) {
      setErrorMessage(getErrorMessage(error))
    } finally {
      setItemsLoading(false)
    }
  }

  const handleCreateWorkspace = async (rawLabel: string) => {
    if (!user) return
    const label = rawLabel.trim().toLocaleLowerCase()
    if (!label) return
    try {
      const response = await itemsFetch("/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.id, label }),
      })
      const data = await readJson<import("@lib/db-items").WorkspaceResponse>(response)
      setWorkspaces((current) => [
        ...current.filter((w) => w.id !== data.workspace.id),
        data.workspace,
      ])
      await handleSwitchWorkspace(data.workspace.id)
    } catch (error) {
      setErrorMessage(getErrorMessage(error))
    }
  }

  const handleCreateStatus = async (
    rawLabel: string,
    targetKey: OpenItemKey | null = activeKey,
  ) => {
    if (!user || activeWorkspaceId === null || targetKey === null) return
    const label = rawLabel.trim().toLocaleLowerCase()
    if (!label) return
    const existingStatus = statuses.find(
      (status) => normalizeLabel(status.label) === normalizeLabel(label),
    )
    if (existingStatus) {
      patchEntryForm(targetKey, (form) => ({ ...form, selectedStatusId: existingStatus.id }))
      return
    }
    setCreateStatusPending(true)
    try {
      const response = await itemsFetch("/api/statuses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.id, workspaceId: activeWorkspaceId, label }),
      })
      const data = await readJson<import("@lib/db-items").StatusResponse>(response)
      setStatuses((current) =>
        [...current.filter((s) => s.id !== data.status.id), data.status].sort(
          (a, b) => a.position - b.position,
        ),
      )
      patchEntryForm(targetKey, (form) => ({ ...form, selectedStatusId: data.status.id }))
      setStatusMessage(`Status “${data.status.label}” added.`)
    } catch (error) {
      setErrorMessage(getErrorMessage(error))
    } finally {
      setCreateStatusPending(false)
    }
  }

  /**
   * Opening a note no longer waits for anything. The outgoing entry keeps its
   * draft in memory and its own autosave, so there is nothing to lose by
   * switching immediately.
   */
  const handleOpenItemFromResults = (item: ItemRecord) => {
    clearMessages()
    openItemEntry(item)

    const key = itemEntryKey(item.id)
    patchEntry(key, {
      autofocus: !isResultsDrawerLayout(),
      revealText: searchMode ? trimmedSearchQuery : null,
    })
    closeIfDrawer()
  }

  const handleAddItemForCategory = (category: CategoryRecord) => {
    clearMessages()
    openDraftEntry({ categoryIds: [category.id], categoryLabel: category.label })
    closeIfDrawer()
  }

  const handleAddItemForTag = (tag: TagRecord) => {
    clearMessages()
    openDraftEntry({ tagIds: [tag.id] })
    closeIfDrawer()
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
    patchEntry(activeKey, (entry) => {
      const alreadySoleSelection =
        entry.form.selectedCategoryIds.length === 1 &&
        entry.form.selectedCategoryIds[0] === category.id
      const next = alreadySoleSelection ? [] : [category.id]
      return {
        form: { ...entry.form, selectedCategoryIds: next },
        categoryInputValue: next
          .map((id) => categories.find((item) => item.id === id)?.label)
          .filter(Boolean)
          .join(", "),
      }
    })
  }

  const handleSelectStatus = (rawId: string) => {
    if (activeKey === null) return
    const id = rawId === "" ? null : Number.parseInt(rawId, 10)
    if (id !== null && !statuses.some((status) => status.id === id)) return
    patchEntryForm(activeKey, (form) => ({ ...form, selectedStatusId: id }))
  }

  // `targetKey` is captured by the caller before this awaits. Without it, a tag
  // created in one note would land on whichever note happens to be active when
  // the request returns — which is now a different note, since switching no
  // longer blocks.
  const handleCreateTag = async (rawLabel: string, targetKey: OpenItemKey | null = activeKey) => {
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
      const response = await itemsFetch("/api/tags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.id, workspaceId: activeWorkspaceId, label }),
      })
      const data = await readJson<CreateTagResponse>(response)
      setTags((prev) => {
        const without = prev.filter((c) => c.id !== data.tag.id)
        return [...without, data.tag].sort((a, b) =>
          a.label.localeCompare(b.label, undefined, { sensitivity: "base" }),
        )
      })
      const shouldKeepSelected = useItemsAppStore
        .getState()
        .openItems.find((entry) => entry.key === targetKey)
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
    targetKey: OpenItemKey | null = activeKey,
  ) => {
    if (!user) {
      setErrorMessage("Sign in before adding categories.")
      return
    }
    const label = rawLabel.trim()
    const nameError = getCategoryNameError(label)
    if (nameError) {
      setErrorMessage(nameError)
      return
    }
    if (label === "" || targetKey === null) {
      return
    }
    const existingCategory = categories.find(
      (category) => normalizeLabel(category.label) === normalizeLabel(label),
    )
    if (existingCategory) {
      patchEntry(targetKey, (entry) => ({
        form: {
          ...entry.form,
          selectedCategoryIds: [existingCategory.id],
        },
        categoryInputValue: existingCategory.label,
      }))
      return
    }
    clearMessages()
    setCreateCategoryPending(true)
    try {
      const response = await itemsFetch("/api/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.id, workspaceId: activeWorkspaceId, label }),
      })
      const data = await readJson<CreateCategoryResponse>(response)
      setCategories((prev) => {
        const without = prev.filter((category) => category.id !== data.category.id)
        return [...without, data.category].sort((a, b) =>
          a.label.localeCompare(b.label, undefined, { sensitivity: "base" }),
        )
      })
      patchEntry(targetKey, (entry) => ({
        form: {
          ...entry.form,
          selectedCategoryIds: [data.category.id],
        },
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
    const nameError = getCategoryNameError(label)
    if (nameError) {
      setErrorMessage(nameError)
      return null
    }
    if (label === "") {
      return null
    }
    const existingCategory = categories.find(
      (category) => normalizeLabel(category.label) === normalizeLabel(label),
    )
    if (existingCategory) {
      return existingCategory
    }

    const response = await itemsFetch("/api/categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: user.id, workspaceId: activeWorkspaceId, label }),
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

    const response = await itemsFetch("/api/tags", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: user.id, workspaceId: activeWorkspaceId, label }),
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

  const patchItemFromSidebar = async (
    item: ItemRecord,
    nextCategoryIds: number[],
    nextTagIds: number[],
  ) => {
    if (!user) return null

    const request = (async () => {
      const response = await itemsFetch("/api/items", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: user.id,
          itemId: item.id,
          item: {
            workspaceId: activeWorkspaceId,
            categoryIds: nextCategoryIds,
            statusId: item.status?.id ?? null,
            tagIds: nextTagIds,
            description: item.description ?? "",
            timeDue: item.timeDue,
            timeRemind: item.timeRemind,
          },
        }),
      })
      return readJson<{ item: ItemRecord }>(response)
    })()

    // Register under the entry's key so an autosave for the same note queues
    // behind this write instead of racing it. Without this, moving an open,
    // dirty note from the sidebar could land in either order.
    const openKey = useItemsAppStore
      .getState()
      .openItems.find((entry) => entry.itemId === item.id)?.key
    if (openKey) {
      saveInFlightRef.current.set(
        openKey,
        request.then(
          () => undefined,
          () => undefined,
        ),
      )
    }

    let data: { item: ItemRecord }
    try {
      data = await request
    } finally {
      if (openKey && saveInFlightRef.current.has(openKey)) {
        saveInFlightRef.current.delete(openKey)
      }
    }
    await refreshResults(user.id)
    return data.item
  }

  const handleMoveItemCategory = async (item: ItemRecord, categoryLabel: string) => {
    if (!user) return
    clearMessages()
    try {
      const category = await resolveCategoryForSidebarMove(categoryLabel)
      if (!category) return
      if (item.categories.some((item) => item.id === category.id)) return

      const updatedItem = await patchItemFromSidebar(
        item,
        [...item.categories.map((item) => item.id), category.id],
        item.tags.map((tag) => tag.id),
      )
      if (updatedItem) applyServerItemToEntry(updatedItem)
      setStatusMessage(`Note moved to “${category.label}”.`)
    } catch (error) {
      setErrorMessage(getErrorMessage(error))
    }
  }

  const handleMoveItemTag = async (item: ItemRecord, fromTagId: number, tagLabel: string) => {
    if (!user) return
    clearMessages()
    try {
      const tag = await resolveTagForSidebarMove(tagLabel)
      if (!tag) return

      const nextTagIds = item.tags
        .filter((itemTag) => itemTag.id !== fromTagId && itemTag.id !== tag.id)
        .map((itemTag) => itemTag.id)
      nextTagIds.push(tag.id)

      const updatedItem = await patchItemFromSidebar(
        item,
        item.categories.map((item) => item.id),
        nextTagIds,
      )
      if (updatedItem) applyServerItemToEntry(updatedItem)
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
    const nameError = getCategoryNameError(label)
    if (nameError) {
      setErrorMessage(nameError)
      return
    }
    if (label === "" || label === editingCategory.label) {
      closeEditCategory()
      return
    }
    clearMessages()
    setEditCategoryPending(true)
    try {
      const response = await itemsFetch("/api/categories", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: user.id,
          workspaceId: activeWorkspaceId,
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
      await loadItems(user.id)
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
      const response = await itemsFetch("/api/categories", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: user.id,
          workspaceId: activeWorkspaceId,
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
    setDeletingCategory(category)
  }

  const closeDeleteCategory = () => {
    if (deleteCategoryPending) return
    setDeletingCategory(null)
  }

  const handleDeleteCategory = async () => {
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
      const response = await itemsFetch("/api/tags", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: user.id,
          workspaceId: activeWorkspaceId,
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
      await loadItems(user.id)
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
      const response = await itemsFetch("/api/tags", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: user.id,
          workspaceId: activeWorkspaceId,
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
    if (tag.itemCount === 0) {
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

  const handleDeleteItem = async (itemId: number) => {
    if (!user) return
    clearMessages()
    setDeletingItemId(itemId)
    try {
      const response = await itemsFetch("/api/items", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.id, itemId }),
      })
      await readJson<{ ok: true }>(response)
      await refreshResults(user.id)
      // Close the entry wherever it sits, not only when it happens to be the
      // one on screen — otherwise a deleted note lingers in the recent list.
      // Its text is gone by the user's own request, so this removal is the one
      // that does not route through a detached save.
      closeEntriesForItemInStore(itemId)
      setStatusMessage("Note deleted.")
    } catch (error) {
      setErrorMessage(getErrorMessage(error))
    } finally {
      setDeletingItemId(null)
    }
  }

  // Auto-create anonymous session if unauthenticated
  useEffect(() => {
    if (authStatus !== "unauthenticated" || anonymousSignInInFlightRef.current) return

    let active = true
    anonymousSignInInFlightRef.current = true
    setAnonymousSignInPending(true)
    setStartupErrorMessage(null)

    void (async () => {
      try {
        const result = await signIn("anonymous", { redirect: false })
        if (!active) return

        const returnedError = result?.error
        const redirectError = (() => {
          if (!result?.url) return null
          try {
            return new URL(result.url).searchParams.get("error")
          } catch {
            return null
          }
        })()

        if (returnedError || redirectError || !result?.ok) {
          let message = "Notes could not create a visitor session."
          try {
            const healthResponse = await fetchWithTimeout("/api/health", {
              cache: "no-store",
            })
            if (healthResponse.status === 503) {
              message = "The Notes database is unavailable. Check the local connection and retry."
            }
          } catch {
            message = "Notes could not reach the server. Check the connection and retry."
          }
          if (active) setStartupErrorMessage(message)
        }
      } catch (error) {
        if (active) setStartupErrorMessage(getErrorMessage(error))
      } finally {
        anonymousSignInInFlightRef.current = false
        if (active) {
          setAnonymousSignInPending(false)
          setSessionLoading(false)
        }
      }
    })()

    return () => {
      active = false
    }
  }, [authStatus, startupRetryKey])

  if (authStatus === "loading" || sessionLoading || !user) {
    return (
      <div className={styles.page}>
        {startupErrorMessage ? (
          <div className={styles.startupState} role="alert">
            <Text variant="body-1" color="danger">
              {startupErrorMessage}
            </Text>
            <Button
              view="action"
              size="m"
              loading={anonymousSignInPending}
              onClick={() => setStartupRetryKey((key) => key + 1)}
            >
              Retry
            </Button>
          </div>
        ) : (
          <div className={styles.startupState} aria-live="polite">
            <Text variant="body-1" color="secondary">
              Loading…
            </Text>
          </div>
        )}
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

      <div className={styles.content} ref={contentRef} inert={backupOperation !== null}>
        <div className={styles.editorColumn}>
          <div className={styles.header}>
            <WorkspaceHeader
              onDownloadBackup={handleDownloadBackup}
              onRestoreBackup={handleRestoreBackup}
              user={user}
              isAnonymous={authSession?.user?.isAnonymous ?? false}
              resultsListVisible={resultsListVisible}
              pasteUrlAsMarkdown={pasteUrlAsMarkdown}
              onPasteUrlAsMarkdownChange={handlePasteUrlAsMarkdownChange}
              onAddItem={handleCancelEdit}
              workspaces={workspaces}
              activeWorkspaceId={activeWorkspaceId ?? workspaces[0]!.id}
              onWorkspaceChange={handleSwitchWorkspace}
              onCreateWorkspace={handleCreateWorkspace}
              onLogout={handleLogout}
              maxOpenItems={maxOpenItems}
              onMaxOpenItemsChange={handleMaxOpenItemsChange}
              categoryLabelById={categoryLabelById}
              onSelectOpenItem={activateEntryInStore}
              onCloseOpenItem={handleCloseOpenItem}
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

          <TextCaptureForm
            form={activeForm}
            setForm={setActiveForm}
            editingItemId={activeEntry?.itemId ?? null}
            userPresent={Boolean(user)}
            pasteUrlAsMarkdown={pasteUrlAsMarkdown}
            categories={categories}
            statuses={statuses}
            tags={tags}
            pendingTagLabels={activeEntry?.pendingTagLabels ?? EMPTY_PENDING_TAG_LABELS}
            // Keying the editor on the entry as well as the session id is what
            // makes switching notes swap documents: same entry, same document.
            descriptionEditorSessionId={`${activeEntry?.key ?? "none"}:${activeEntry?.editorSessionId ?? 0}`}
            editorAutofocus={activeEntry?.autofocus ?? false}
            editorRevealText={activeEntry?.revealText ?? null}
            createCategoryPending={createCategoryPending}
            createStatusPending={createStatusPending}
            createTagPending={createTagPending}
            onSelectCategoryId={handleSelectCategory}
            onSelectStatusId={handleSelectStatus}
            onCreateCategory={handleCreateCategory}
            onCreateStatus={handleCreateStatus}
            onTagValuesChange={handleTagValuesChange}
            onCancelEdit={handleCancelEdit}
            onAddItemInCategory={handleAddItemInCategory}
            onDeleteEditingItem={() => {
              if (activeEntry?.itemId != null) {
                void handleDeleteItem(activeEntry.itemId)
              }
            }}
          />
        </div>

        {resultsOverlayMounted && (
          <button
            type="button"
            className={`${styles.resultsOverlay} ${
              resultsListVisible ? "" : styles.resultsOverlayClosing
            }`}
            aria-label="Hide notes list"
            onClick={handleResultsOverlayClick}
          />
        )}

        <button
          type="button"
          className={styles.resizeHandle}
          aria-label="Resize notes list"
          title="Drag or use arrow keys to resize notes list"
          onPointerDown={handleResizePointerDown}
          onPointerMove={handleResizePointerMove}
          onPointerUp={handleResizePointerUp}
          onPointerCancel={handleResizePointerCancel}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
              event.preventDefault()
              updateResultsColumnWidth(
                preferredResultsColumnWidth + (event.key === "ArrowLeft" ? 16 : -16),
              )
            }
          }}
        />

        <ResultsColumn
          visible={resultsListVisible}
          columnStyle={resultsColumnStyle}
          tags={tags}
          itemsLoading={itemsLoading}
          categories={categories}
          statuses={statuses}
          statusItemGroups={statusItemGroups}
          activeStatusId={activeForm.selectedStatusId}
          fallbackTagId={fallbackTagId}
          selectedTag={selectedTag}
          searchMode={searchMode}
          searchItems={searchItems}
          searchLoading={searchLoading}
          categoryItemGroups={categoryItemGroups}
          noStatusItems={noStatusItems}
          tagItemGroups={tagItemGroups}
          activeItemId={activeEntry?.itemId ?? null}
          openItemIds={openItemIds}
          activeKey={activeKey}
          activeCategoryIds={activeForm.selectedCategoryIds}
          activeTagIds={activeForm.selectedTagIds}
          onEditItem={handleOpenItemFromResults}
          onAddItemForCategory={handleAddItemForCategory}
          onAddItemForTag={handleAddItemForTag}
          onMoveItemCategory={handleMoveItemCategory}
          onMoveItemTag={handleMoveItemTag}
          onDeleteItem={(itemId) => void handleDeleteItem(itemId)}
          deletingItemId={deletingItemId}
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
        onDelete={() => void handleDeleteCategory()}
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
