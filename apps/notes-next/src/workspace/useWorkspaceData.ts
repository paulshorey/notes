"use client"

import {
  type CategoriesResponse,
  type ItemRecord,
  type ItemsResponse,
  type SearchResponse,
  type TagsResponse,
  type UserSummary,
} from "@lib/db-items"
import { ITEMS_APP_SEARCH_MAX_RESULTS } from "@lib/db-items/item-search-constants"
import type { ItemKindKey } from "@lib/db-items/contracts/item-kinds"
import { useCallback, useMemo, useRef } from "react"
import { readJson } from "@/lib/api"
import { updateItemsCacheList, updateItemsCacheUser } from "@/lib/itemsCache"
import { RESULTS_COLUMN_DEFAULT_WIDTH } from "@/lib/resultsColumn"
import {
  getMaxOpenItemsPreference,
  getNotesViewHiddenKindsPreference,
  getPasteUrlAsMarkdownPreference,
  getStoredResultsColumnWidth,
  normalizeUserPreferences,
  serializeUserPreferences,
  withPasteUrlAsMarkdownPreference,
} from "@/lib/userPreferences"
import { TAXONOMY_REFRESH_DEBOUNCE_MS } from "@/workspace/shared"
import type { WorkspaceStateOutput } from "./useWorkspaceState"
import type { ResultsColumnLayoutOutput } from "./useResultsColumnLayout"

export function useWorkspaceData(ctx: WorkspaceStateOutput & ResultsColumnLayoutOutput) {
  const {
    activeWorkspaceIdRef,
    clampResultsColumnWidth,
    itemsRef,
    lastSavedPreferencesRef,
    setCategories,
    setItems,
    setItemsLoading,
    setPreferredResultsColumnWidth,
    setResultsColumnWidth,
    setSearchResults,
    setStatuses,
    setTags,
    setUser,
    setUserPreferences,
    taxonomyRefreshTimeoutRef,
    userPreferences,
  } = ctx

  const pasteUrlAsMarkdown = getPasteUrlAsMarkdownPreference(userPreferences)

  const preferredMaxOpenItems = getMaxOpenItemsPreference(userPreferences)

  // A new array for the same choice would recompute every list that depends on it.
  const hiddenKindsKey = getNotesViewHiddenKindsPreference(userPreferences).join(",")
  const notesViewHiddenKinds = useMemo(
    () => (hiddenKindsKey === "" ? [] : (hiddenKindsKey.split(",") as ItemKindKey[])),
    [hiddenKindsKey],
  )

  const handlePasteUrlAsMarkdownChange = useCallback(
    (enabled: boolean) => {
      setUserPreferences((current) =>
        getPasteUrlAsMarkdownPreference(current) === enabled
          ? current
          : withPasteUrlAsMarkdownPreference(current, enabled),
      )
    },
    [setUserPreferences],
  )

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
    [
      clampResultsColumnWidth,
      lastSavedPreferencesRef,
      setPreferredResultsColumnWidth,
      setResultsColumnWidth,
      setUser,
      setUserPreferences,
    ],
  )

  /**
   * Send a dirty entry that has left the ring off to the server anyway. Used by
   * eviction, explicit close, and a lowered cap — the three ways a draft can
   * stop being visible while still holding unsaved text.
   */

  // Counts list reads, so only the most recently started one is applied.
  const latestItemsRequestRef = useRef(0)

  const loadItems = useCallback(
    async (userId: number, workspaceId = activeWorkspaceIdRef.current) => {
      if (workspaceId === null) return []
      // Only show the blocking "Loading…" indicator on the cold path, when we
      // have nothing to display yet. Background refreshes (post-CRUD and the
      // stale-while-revalidate startup) should keep showing the existing data.
      const showLoadingIndicator = itemsRef.current.length === 0
      if (showLoadingIndicator) setItemsLoading(true)
      const request = (latestItemsRequestRef.current += 1)
      try {
        const response = await fetch(`/api/items?workspaceId=${workspaceId}`, {
          cache: "no-store",
        })
        const data = await readJson<ItemsResponse>(response)
        if (activeWorkspaceIdRef.current !== workspaceId) return data.items
        // A list read that started earlier can arrive after a later one. Applying it
        // would put back what a write in between had already changed.
        if (request !== latestItemsRequestRef.current) return data.items
        setItems(data.items)
        updateItemsCacheList(userId, workspaceId, "items", data.items)
        return data.items
      } finally {
        if (showLoadingIndicator) setItemsLoading(false)
      }
    },
    [activeWorkspaceIdRef, itemsRef, setItems, setItemsLoading],
  )

  const loadCategories = useCallback(
    async (userId: number, workspaceId = activeWorkspaceIdRef.current) => {
      if (workspaceId === null) return []
      const response = await fetch(`/api/categories?workspaceId=${workspaceId}`, {
        cache: "no-store",
      })
      const data = await readJson<CategoriesResponse>(response)
      if (activeWorkspaceIdRef.current !== workspaceId) return data.categories
      setCategories(data.categories)
      updateItemsCacheList(userId, workspaceId, "categories", data.categories)
      return data.categories
    },
    [activeWorkspaceIdRef, setCategories],
  )

  const loadTags = useCallback(
    async (userId: number, workspaceId = activeWorkspaceIdRef.current) => {
      if (workspaceId === null) return []
      const response = await fetch(`/api/tags?workspaceId=${workspaceId}`, {
        cache: "no-store",
      })
      const data = await readJson<TagsResponse>(response)
      if (activeWorkspaceIdRef.current !== workspaceId) return data.tags
      setTags(data.tags)
      updateItemsCacheList(userId, workspaceId, "tags", data.tags)
      return data.tags
    },
    [activeWorkspaceIdRef, setTags],
  )

  const runSearch = useCallback(
    async (userId: number, query: string, limit: number) => {
      const workspaceId = activeWorkspaceIdRef.current
      if (workspaceId === null) return []
      const response = await fetch("/api/items/search", {
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
      setSearchResults(data.results)
      return data.results
    },
    [activeWorkspaceIdRef, setSearchResults],
  )

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
            fetch(`/api/statuses?workspaceId=${workspaceId}`, { cache: "no-store" })
              .then(readJson<import("@lib/db-items").StatusesResponse>)
              .then((data) => {
                if (activeWorkspaceIdRef.current !== workspaceId) return
                setStatuses(data.statuses)
                updateItemsCacheList(userId, workspaceId, "statuses", data.statuses)
              }),
          ]).catch(() => undefined)
      }, TAXONOMY_REFRESH_DEBOUNCE_MS)
    },
    [activeWorkspaceIdRef, loadCategories, loadTags, setStatuses, taxonomyRefreshTimeoutRef],
  )

  /** Merge a saved record into the lists in place, instead of refetching them. */
  const mergeSavedItem = useCallback(
    (userId: number, item: ItemRecord) => {
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
    },
    [activeWorkspaceIdRef, setItems, setSearchResults],
  )

  /** Drop a deleted record from the lists in place, instead of refetching them. */
  const forgetDeletedItem = useCallback(
    (userId: number, workspaceId: number, itemId: number) => {
      if (activeWorkspaceIdRef.current !== workspaceId) return
      setItems((prev) => {
        const next = prev.filter((existing) => existing.id !== itemId)
        updateItemsCacheList(userId, workspaceId, "items", next)
        return next
      })
      setSearchResults((prev) => prev.filter((result) => result.item.id !== itemId))
    },
    [activeWorkspaceIdRef, setItems, setSearchResults],
  )

  return {
    notesViewHiddenKinds,
    pasteUrlAsMarkdown,
    preferredMaxOpenItems,
    handlePasteUrlAsMarkdownChange,
    applyLoadedUser,
    loadItems,
    loadCategories,
    loadTags,
    runSearch,
    scheduleTaxonomyRefresh,
    mergeSavedItem,
    forgetDeletedItem,
  }
}

export type WorkspaceDataOutput = ReturnType<typeof useWorkspaceData>
