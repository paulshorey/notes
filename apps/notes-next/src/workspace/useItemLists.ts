"use client"

import { type ItemRecord, type SearchResponse } from "@lib/db-items"
import { ITEMS_APP_SEARCH_MAX_RESULTS } from "@lib/db-items/item-search-constants"
import { useCallback, useEffect, useMemo } from "react"
import { getErrorMessage, itemsFetch, readJson } from "@/lib/api"
import { updateItemsCacheList } from "@/lib/itemsCache"
import {
  type DisplayItemItem,
  buildCategoryItemGroups,
  getGroupSortTime,
  getItemSortTime,
} from "@/lib/itemGroups"
import { type StatusItemGroup, type TagItemGroup } from "@/components/items/ResultsColumn"
import { compareItemGroups } from "@/workspace/shared"
import type { WorkspaceStateOutput } from "./useWorkspaceState"
import type { WorkspaceDataOutput } from "./useWorkspaceData"
import type { OpenItemEntriesOutput } from "./useOpenItemEntries"

export function useItemLists(
  ctx: WorkspaceStateOutput & WorkspaceDataOutput & OpenItemEntriesOutput,
) {
  const {
    activeView,
    activeWorkspaceId,
    activeWorkspaceIdRef,
    categories,
    items,
    loadCategories,
    loadItems,
    loadTags,
    notesViewHiddenKinds,
    remapEntriesAfterCategoryChange,
    runSearch,
    searchMode,
    searchResults,
    selectedTagId,
    setSearchErrorMessage,
    setSearchLoading,
    setSearchResults,
    setStatuses,
    statuses,
    tags,
    trimmedSearchQuery,
    user,
  } = ctx

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
  }, [
    activeWorkspaceId,
    items.length,
    setSearchErrorMessage,
    setSearchLoading,
    setSearchResults,
    trimmedSearchQuery,
    user,
  ])

  /**
   * Point every open entry at a category that still exists. Runs where
   * categories actually change rather than on the save path.
   *
   * A change made here is not a user edit, so a clean entry has to stay clean:
   * its signature moves with the form, otherwise autosave would immediately
   * push the remap back to the server as if the user had made it.
   */

  const matchesSelectedTag = useCallback(
    (item: ItemRecord) =>
      selectedTagId === null || item.tags.some((tag) => tag.id === selectedTagId),
    [selectedTagId],
  )

  const selectsItem = useCallback(
    (item: ItemRecord) => activeView.selects(item, { notesViewHiddenKinds }),
    [activeView, notesViewHiddenKinds],
  )

  const searchItems = useMemo<DisplayItemItem[]>(() => {
    if (!searchMode) {
      return []
    }

    return [...searchResults]
      .filter((result) => selectsItem(result.item) && matchesSelectedTag(result.item))
      .sort((left, right) => right.similarity - left.similarity)
      .map((result) => ({
        item: result.item,
        relevance: result.similarity,
      }))
  }, [matchesSelectedTag, searchMode, searchResults, selectsItem])

  // The workspace holds every item; a view lists the ones it selects.
  const viewItems = useMemo(() => items.filter(selectsItem), [items, selectsItem])

  const allItemItems = useMemo<DisplayItemItem[]>(
    () =>
      [...viewItems]
        .sort((left, right) => getItemSortTime(right) - getItemSortTime(left))
        .map((item) => ({ item })),
    [viewItems],
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
      activeWorkspaceIdRef,
      loadItems,
      loadCategories,
      loadTags,
      setStatuses,
      remapEntriesAfterCategoryChange,
      trimmedSearchQuery,
      runSearch,
    ],
  )

  /**
   * Persist one entry. Saves for different entries run concurrently; saves for
   * the same entry stay serialized, so a note can never race itself into two
   * rows.
   */

  return {
    viewItems,
    matchesSelectedTag,
    searchItems,
    allItemItems,
    allCategoryItems,
    categoryItemGroups,
    tagItemGroups,
    statusItemGroups,
    noStatusItems,
    selectedTag,
    refreshResults,
  }
}

export type ItemListsOutput = ReturnType<typeof useItemLists>
