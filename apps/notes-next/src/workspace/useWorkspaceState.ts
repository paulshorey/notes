"use client"

import {
  type CategoryRecord,
  type ItemRecord,
  type SearchResponse,
  type StatusRecord,
  type TagRecord,
  type UserPreferences,
  type UserSummary,
  type WorkspaceRecord,
} from "@lib/db-items"
import { useCallback, useEffect, useRef, useState } from "react"
import { useSession } from "next-auth/react"
import { type EmbeddingMaintenanceMode } from "@/types/items"
import { useAutoDismissStatus } from "@/hooks/useAutoDismissStatus"
import { useSidebarDrawer } from "@/hooks/useSidebarDrawer"
import { type OpenItemKey } from "@/stores/openItems"
import { selectActiveEntry, useItemsAppStore } from "@/stores/itemsAppStore"
import { RESULTS_COLUMN_DEFAULT_WIDTH } from "@/lib/resultsColumn"
import { serializeUserPreferences } from "@/lib/userPreferences"
import { type DetachedSave, type ItemSaveMode, getDefaultTagId } from "@/workspace/shared"

export function useWorkspaceState() {
  const { data: authSession, status: authStatus } = useSession()

  const [identifier, setIdentifier] = useState("")

  const [password, setPassword] = useState("")

  const backupOperation = useItemsAppStore((s) => s.backupOperation)

  const itemGroupDialog = useItemsAppStore((s) => s.itemGroupDialog)

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

  const groupDeferredSaveKeysRef = useRef(new Set<OpenItemKey>())

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

  const clearStatusMessage = useCallback(() => setStatusMessage(null), [])

  useAutoDismissStatus(statusMessage, clearStatusMessage)

  const clearMessages = useCallback(() => {
    setStatusMessage(null)
    setErrorMessage(null)
    setSearchErrorMessage(null)
  }, [])

  return {
    authSession,
    authStatus,
    identifier,
    setIdentifier,
    password,
    setPassword,
    backupOperation,
    itemGroupDialog,
    user,
    setUser,
    userPreferences,
    setUserPreferences,
    items,
    setItems,
    categories,
    setCategories,
    statuses,
    setStatuses,
    tags,
    setTags,
    workspaces,
    setWorkspaces,
    activeWorkspaceId,
    setActiveWorkspaceId,
    fallbackTagId,
    resultsListVisible,
    drawerMode,
    closeIfDrawer,
    setResultsListVisible,
    selectedTagId,
    setSelectedTagId,
    searchQuery,
    setSearchQuery,
    openItems,
    activeKey,
    activeEntry,
    maxOpenItems,
    setMaxOpenItemsInStore,
    openExistingItemInStore,
    openNewDraftInStore,
    activateEntryInStore,
    closeEntryInStore,
    closeEntriesForItemInStore,
    patchEntry,
    patchEntryForm,
    patchEveryEntry,
    replaceOpenItems,
    resetItemsAppStore,
    searchResults,
    setSearchResults,
    sessionLoading,
    setSessionLoading,
    startupErrorMessage,
    setStartupErrorMessage,
    startupRetryKey,
    setStartupRetryKey,
    anonymousSignInPending,
    setAnonymousSignInPending,
    itemsUrlSelectionReady,
    setItemsUrlSelectionReady,
    itemsLoading,
    setItemsLoading,
    searchLoading,
    setSearchLoading,
    authPending,
    setAuthPending,
    embeddingMaintenancePending,
    setEmbeddingMaintenancePending,
    createCategoryPending,
    setCreateCategoryPending,
    createStatusPending,
    setCreateStatusPending,
    createTagPending,
    setCreateTagPending,
    deletingItemId,
    setDeletingItemId,
    statusMessage,
    setStatusMessage,
    errorMessage,
    setErrorMessage,
    searchErrorMessage,
    setSearchErrorMessage,
    editingTag,
    setEditingTag,
    editTagLabel,
    setEditTagLabel,
    editTagPending,
    setEditTagPending,
    deletingTag,
    setDeletingTag,
    deleteTagPending,
    setDeleteTagPending,
    preferredResultsColumnWidth,
    setPreferredResultsColumnWidth,
    resultsColumnWidth,
    setResultsColumnWidth,
    resultsOverlayMounted,
    setResultsOverlayMounted,
    contentRef,
    userRef,
    userPreferencesRef,
    itemsRef,
    categoriesRef,
    tagsRef,
    activeWorkspaceIdRef,
    saveInFlightRef,
    queuedAutosaveKeysRef,
    groupDeferredSaveKeysRef,
    detachedSavesRef,
    mergeInFlightRef,
    anonymousSignInInFlightRef,
    didRehydrateOpenItemsRef,
    openItemsPersistTimeoutRef,
    taxonomyRefreshTimeoutRef,
    flushAllPendingSavesRef,
    persistOpenItemsRef,
    saveEntryRef,
    exitKeepaliveKeysRef,
    creatingTagLabelsRef,
    preferenceSavesInFlightRef,
    lastSavedPreferencesRef,
    preferenceSaveRequestIdRef,
    resultsOverlayTimeoutRef,
    resizeStateRef,
    trimmedSearchQuery,
    searchMode,
    clearStatusMessage,
    clearMessages,
  }
}

export type WorkspaceStateOutput = ReturnType<typeof useWorkspaceState>
