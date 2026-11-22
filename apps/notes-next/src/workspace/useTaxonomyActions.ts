"use client"

import { markItemDeletedByUser, unmarkItemDeletedByUser } from "@/lib/userDeletedItems"
import {
  type BootstrapResponse,
  type CategoryRecord,
  type CreateCategoryResponse,
  type CreateTagResponse,
  type DeleteTagResponse,
  type ItemRecord,
  type SubcategoryRecord,
  type TagRecord,
  type UpdateTagResponse,
  type WorkspaceRecord,
} from "@lib/db-items"
import { getCategoryNameError } from "@lib/db-items/contracts/category-name"
import { type ItemGroupActionResponse } from "@lib/db-items/contracts/item-group-actions"
import {
  applyItemGroupResult,
  applyItemGroupResultToCategories,
  refileAfterGroupResult,
} from "@/lib/itemGroupActions"
import { useCallback, useRef } from "react"
import { getErrorMessage, itemsFetch, readJson } from "@/lib/api"
import { normalizeLabel } from "@/lib/strings"
import { type TextCaptureFormState } from "@/types/items"
import { updateItemsCacheList, writeItemsCache } from "@/lib/itemsCache"
import {
  type OpenItemKey,
  createEmptyOpenItemsState,
  isEmptyDraft,
  itemEntryKey,
} from "@/stores/openItems"
import { useItemsAppStore } from "@/stores/itemsAppStore"
import { useWorkspaceStore } from "@/stores/workspaceStore"
import { createEmptyItemDraft } from "@/capabilities/draftParts"
import { newItemRequestBody, serializeItemDraft } from "@/lib/itemDraft"
import { newPublicUid } from "@/lib/publicUid"
import { itemToFormState } from "@/types/items"
import {
  type StoredItemChange,
  changesNothing,
  draftAfterListWrite,
  storedItemFields,
} from "@/lib/listWrites"
import { collectSessionFlushEntries, stateWithDetachedSaves } from "@/lib/openItemsExit"
import { isPreferencesObject } from "@/lib/userPreferences"
import { canSaveEntry } from "@/views/registry"
import {
  type ItemFiling,
  existingFiling,
  filingLabel,
  isSameFiling,
  itemFilingLabel,
  upsertCategory,
} from "@/lib/itemFiling"
import { isResultsDrawerLayout } from "@/lib/resultsColumn"
import { isEntryDirty } from "@/workspace/shared"
import type { WorkspaceStateOutput } from "./useWorkspaceState"
import type { WorkspaceDataOutput } from "./useWorkspaceData"
import type { ItemSaveEngineOutput } from "./useItemSaveEngine"
import type { OpenItemEntriesOutput } from "./useOpenItemEntries"
import type { ItemListsOutput } from "./useItemLists"

export function useTaxonomyActions(
  ctx: WorkspaceStateOutput &
    WorkspaceDataOutput &
    ItemSaveEngineOutput &
    OpenItemEntriesOutput &
    ItemListsOutput,
) {
  // The last list write for each item, so the next one for that item waits its turn.
  const listWritesByItemRef = useRef(new Map<number, Promise<void>>())
  const latestCleanupRefreshRef = useRef(0)
  const categoryCreatesRef = useRef(new Map<string, Promise<CategoryRecord | null>>())

  const {
    activeKey,
    activeView,
    activeWorkspaceId,
    activeWorkspaceIdRef,
    applyServerItemToEntry,
    categories,
    categoriesRef,
    clearMessages,
    closeEntriesForItemInStore,
    closeIfDrawer,
    creatingTagLabelsRef,
    deletingTag,
    detachedSavesRef,
    directWritesRef,
    editTagLabel,
    editingTag,
    fallbackTagId,
    groupDeferredSaveKeysRef,
    itemsRef,
    mergeSavedItem,
    loadItems,
    openDraftEntry,
    openItemEntry,
    patchEntry,
    patchEntryForm,
    patchEveryEntry,
    persistOpenItemsRef,
    queuedAutosaveKeysRef,
    refreshResults,
    rehydrateOpenItems,
    remapEntriesAfterCategoryChange,
    saveEntry,
    scheduleTaxonomyRefresh,
    saveInFlightRef,
    searchMode,
    selectedTagId,
    setActiveWorkspaceId,
    setCategories,
    setCreateCategoryPending,
    setCreateStatusPending,
    setCreateTagPending,
    setDeleteTagPending,
    setDeletingItemId,
    setDeletingTag,
    setEditTagLabel,
    setEditTagPending,
    setEditingTag,
    setErrorMessage,
    setItems,
    setSearchResults,
    setSelectedTagId,
    setStatusMessage,
    setStatuses,
    setTags,
    setUserPreferences,
    setWorkspaces,
    statuses,
    tags,
    tagsRef,
    taxonomyRefreshTimeoutRef,
    trimmedSearchQuery,
    user,
    userRef,
  } = ctx

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

  const handleAddItemForCategory = (
    category: CategoryRecord | null,
    subcategory: SubcategoryRecord | null = null,
  ) => {
    clearMessages()
    const filing = { categoryId: category?.id ?? null, subcategoryId: subcategory?.id ?? null }
    openDraftEntry({ ...filing, categoryLabel: itemFilingLabel({ category, subcategory }) })
    closeIfDrawer()
  }

  const handleAddItemForTag = (tag: TagRecord) => {
    clearMessages()
    openDraftEntry({ tagIds: [tag.id] })
    closeIfDrawer()
  }

  const handleSelectCategory = (rawId: string) => {
    if (rawId === "") {
      if (activeKey === null) return
      patchEntry(activeKey, (entry) => ({
        form: { ...entry.form, selectedCategoryId: null, selectedSubcategoryId: null },
        categoryInputValue: "",
      }))
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
      // Choosing the current category again clears it. Either way the subcategory
      // goes: it belongs to the category that is no longer selected.
      const next = entry.form.selectedCategoryId === category.id ? null : category.id
      return {
        form: { ...entry.form, selectedCategoryId: next, selectedSubcategoryId: null },
        categoryInputValue: next === null ? "" : category.label,
      }
    })
  }

  const handleSelectSubcategory = (rawId: string) => {
    if (activeKey === null) return
    const id = rawId === "" ? null : Number.parseInt(rawId, 10)
    patchEntry(activeKey, (entry) => {
      const filing = existingFiling(categories, {
        categoryId: entry.form.selectedCategoryId,
        // Choosing the current subcategory again clears it.
        subcategoryId: id === entry.form.selectedSubcategoryId ? null : id,
      })
      return {
        form: { ...entry.form, selectedSubcategoryId: filing.subcategoryId },
        categoryInputValue: filingLabel(categories, filing),
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

  const createWorkspaceCategory = async (rawLabel: string): Promise<CategoryRecord | null> => {
    const workspaceId = activeWorkspaceId
    if (!user || workspaceId === null) throw new Error("Open a workspace before adding categories.")
    const label = rawLabel.trim()
    const nameError = getCategoryNameError(label)
    if (nameError) throw new Error(nameError)
    if (label === "") return null
    const workspace = useWorkspaceStore.getState()
    if (workspace.user?.id !== user.id || workspace.activeWorkspaceId !== workspaceId) return null
    const normalizedLabel = normalizeLabel(label)
    const existingCategory = workspace.categories.find(
      (category) => normalizeLabel(category.label) === normalizedLabel,
    )
    if (existingCategory) return existingCategory

    const pendingCreates = categoryCreatesRef.current
    const requestKey = JSON.stringify([user.id, workspaceId, normalizedLabel])
    const pendingCreate = pendingCreates.get(requestKey)
    if (pendingCreate) return pendingCreate

    clearMessages()
    setCreateCategoryPending(true)
    const request = (async () => {
      const response = await itemsFetch("/api/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.id, workspaceId, label }),
      })
      const data = await readJson<CreateCategoryResponse>(response)
      if (
        useWorkspaceStore.getState().user?.id !== user.id ||
        useWorkspaceStore.getState().activeWorkspaceId !== workspaceId
      ) {
        return null
      }
      setCategories((prev) => upsertCategory(prev, data.category))
      setStatusMessage(`Category “${data.category.label}” added.`)
      return data.category
    })().finally(() => {
      pendingCreates.delete(requestKey)
      setCreateCategoryPending(pendingCreates.size > 0)
    })
    pendingCreates.set(requestKey, request)
    return request
  }

  const handleCreateCategory = async (
    rawLabel: string,
    targetKey: OpenItemKey | null = activeKey,
  ) => {
    if (targetKey === null) return
    try {
      const category = await createWorkspaceCategory(rawLabel)
      if (!category) return
      patchEntry(targetKey, (entry) => ({
        form: {
          ...entry.form,
          selectedCategoryId: category.id,
          selectedSubcategoryId:
            entry.form.selectedCategoryId === category.id ? entry.form.selectedSubcategoryId : null,
        },
        categoryInputValue: category.label,
      }))
    } catch (error) {
      setErrorMessage(getErrorMessage(error))
    }
  }

  /** Create a subcategory of the entry's category, or select it if it exists. */
  const handleCreateSubcategory = async (
    rawLabel: string,
    targetKey: OpenItemKey | null = activeKey,
  ) => {
    if (!user) {
      setErrorMessage("Sign in before adding subcategories.")
      return
    }
    const label = rawLabel.trim()
    const nameError = getCategoryNameError(label)
    if (nameError) {
      setErrorMessage(nameError)
      return
    }
    if (label === "" || targetKey === null) return
    // Captured before awaiting: the entry may be filed elsewhere by the time this returns.
    const categoryId =
      useItemsAppStore.getState().openItems.find((entry) => entry.key === targetKey)?.form
        .selectedCategoryId ?? null
    const category = categories.find((entry) => entry.id === categoryId)
    if (!category) {
      setErrorMessage("Choose a category before adding a subcategory.")
      return
    }
    const selectSubcategory = (subcategoryId: number, list: CategoryRecord[]) =>
      patchEntry(targetKey, (entry) =>
        entry.form.selectedCategoryId === category.id
          ? {
              form: { ...entry.form, selectedSubcategoryId: subcategoryId },
              categoryInputValue: filingLabel(list, { categoryId: category.id, subcategoryId }),
            }
          : {},
      )
    const existing = category.subcategories.find(
      (subcategory) => normalizeLabel(subcategory.label) === normalizeLabel(label),
    )
    if (existing) {
      selectSubcategory(existing.id, categories)
      return
    }
    clearMessages()
    setCreateCategoryPending(true)
    try {
      const response = await itemsFetch("/api/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: user.id,
          workspaceId: category.workspaceId,
          categoryId: category.id,
          label,
        }),
      })
      const data = await readJson<CreateCategoryResponse>(response)
      if (!data.subcategory) throw new Error("The subcategory was not created.")
      const latest = upsertCategory(categoriesRef.current, data.category)
      setCategories(latest)
      selectSubcategory(data.subcategory.id, latest)
      setStatusMessage(`Subcategory “${data.subcategory.label}” added to “${data.category.label}”.`)
    } catch (error) {
      setErrorMessage(getErrorMessage(error))
    } finally {
      setCreateCategoryPending(false)
    }
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

  /**
   * The stored item a list action should start from, or null when there is none left.
   * If the item is open with unsaved edits, those are saved first, so a change made
   * from a list never overwrites what the user typed. That save deletes the item when
   * the edit had emptied it, and then there is nothing for the list action to change.
   */
  const settleOpenEntryFor = async (item: ItemRecord): Promise<ItemRecord | null> => {
    const entry = useItemsAppStore.getState().openItems.find((open) => open.itemId === item.id)
    if (!entry || !isEntryDirty(entry) || !canSaveEntry(entry)) return item
    if (!(await saveEntry(entry.key, "flush")))
      throw new Error("Couldn't save your changes to this item first. Try again.")
    return useWorkspaceStore.getState().items.find((stored) => stored.id === item.id) ?? null
  }

  /**
   * Change fields of a stored item from a list, without opening it. Writes to one
   * item run in the order they were asked for: a list keeps showing the item where it
   * was until its write lands, so a second change can start before the first is done.
   */
  const patchItemFromSidebar = (
    listedItem: ItemRecord,
    change: (current: ItemRecord) => StoredItemChange,
  ): Promise<ItemRecord | null> =>
    enqueueSidebarWrite(listedItem.id, () => patchStoredItem(listedItem, change))

  const enqueueSidebarWrite = (itemId: number, action: () => Promise<ItemRecord | null>) => {
    const queue = listWritesByItemRef.current
    const previous = queue.get(itemId) ?? Promise.resolve()
    const write = previous.then(action)
    const settled = write.then(
      () => undefined,
      () => undefined,
    )
    queue.set(itemId, settled)
    void settled.then(() => {
      if (queue.get(itemId) === settled) queue.delete(itemId)
    })
    return write
  }

  const readItemForSidebarWrite = (listedItem: ItemRecord) => {
    const latest =
      useWorkspaceStore.getState().items.find((stored) => stored.id === listedItem.id) ?? listedItem
    return settleOpenEntryFor(latest)
  }

  const patchStoredItem = async (
    listedItem: ItemRecord,
    change: (current: ItemRecord) => StoredItemChange,
  ) => {
    if (!user) return null
    // An earlier write in the queue may have changed the item since it was listed.
    const item = await readItemForSidebarWrite(listedItem)
    if (!item) return null
    // Decided against the item as it is now, not as the list showed it when the
    // action started: an earlier write or a saved edit may have changed it since.
    const changed = change(item)
    if (changesNothing(item, changed)) return item
    const fields = { ...storedItemFields(item), ...changed }

    const request = (async () => {
      const response = await itemsFetch("/api/items", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: user.id,
          itemId: item.id,
          item: {
            workspaceId: activeWorkspaceId,
            ...fields,
            description: item.description ?? "",
            // Named so an item that is a time block without text still holds content.
            timeStart: item.timeStart,
            timeEnd: item.timeEnd,
            timePlanned: item.timePlanned,
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
    const openEntry = useItemsAppStore
      .getState()
      .openItems.find((entry) => entry.itemId === item.id)
    const openKey = openEntry?.key
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
    applyListWriteToEntry(data.item, changed, openEntry?.form)
    await refreshResults(user.id)
    return data.item
  }

  /**
   * Bring an open entry in line with a list write to its item. If the user edited the
   * entry while the write was in flight, those edits stay and only the fields the
   * write changed are taken, with the stored state as the new baseline.
   */
  const applyListWriteToEntry = (
    item: ItemRecord,
    changed: StoredItemChange,
    sentForm?: TextCaptureFormState,
  ) => {
    const entry = useItemsAppStore.getState().openItems.find((open) => open.itemId === item.id)
    if (!entry) return
    if (!isEntryDirty(entry)) {
      applyServerItemToEntry(item)
      return
    }
    const stored = itemToFormState(item)
    const refiled = "categoryId" in changed || "subcategoryId" in changed
    patchEntry(entry.key, {
      form: draftAfterListWrite(entry.form, stored, changed, sentForm),
      baseTimeModified: item.timeModified,
      savedSignature: serializeItemDraft(item.id, stored),
      ...(refiled ? { categoryInputValue: itemFilingLabel(item) } : {}),
    })
  }

  const handleMoveItemFiling = (item: ItemRecord, destination: ItemFiling) => {
    if (!user) return Promise.resolve(false)
    clearMessages()
    let filingChanged = false
    return trackDirectWrite(
      patchItemFromSidebar(item, (current) => {
        if (current.workspaceId !== activeWorkspaceIdRef.current) {
          throw new Error("The item's workspace changed. Open the move picker again.")
        }
        const filing = existingFiling(categoriesRef.current, destination)
        if (!isSameFiling(filing, destination)) {
          throw new Error("The destination changed. Choose another category or subcategory.")
        }
        filingChanged = !changesNothing(current, filing)
        return filing
      }).then(
        (moved) => {
          if (!moved) return false
          if (!filingChanged) return true
          const label = itemFilingLabel(moved)
          setStatusMessage(label ? `Item moved to “${label}”.` : "Item moved to uncategorized.")
          return true
        },
        (error) => {
          setErrorMessage(getErrorMessage(error))
          return false
        },
      ),
    )
  }

  const handleMoveItemTag = async (item: ItemRecord, fromTagId: number, tagLabel: string) => {
    if (!user) return
    clearMessages()
    try {
      const tag = await resolveTagForSidebarMove(tagLabel)
      if (!tag) return

      const retagged = await patchItemFromSidebar(item, (current) => ({
        tagIds: [
          ...current.tags
            .filter((itemTag) => itemTag.id !== fromTagId && itemTag.id !== tag.id)
            .map((itemTag) => itemTag.id),
          tag.id,
        ],
      }))
      if (retagged) setStatusMessage(`Note tag changed to “${tag.label}”.`)
    } catch (error) {
      setErrorMessage(getErrorMessage(error))
    }
  }

  /** Register a write made from a list, so a session change waits for it to land. */
  const trackDirectWrite = (write: Promise<boolean>) => {
    directWritesRef.current.add(write)
    void write.finally(() => directWritesRef.current.delete(write))
    return write
  }

  /** Set or clear an item's status from a list, as a board does when a card moves. */
  const handleSetItemStatus = (item: ItemRecord, statusId: number | null) => {
    if (!user) return Promise.resolve(false)
    clearMessages()
    return trackDirectWrite(
      (async () => {
        try {
          await patchItemFromSidebar(item, () => ({ statusId }))
          return true
        } catch (error) {
          setErrorMessage(getErrorMessage(error))
          return false
        }
      })(),
    )
  }

  /**
   * Create an item from one line typed into a list, with the defaults of the view it
   * was typed in. It is stored directly and does not open in the editor.
   */
  const handleQuickAddItem = (
    description: string,
    context: { statusId: number | null },
  ): Promise<boolean> => {
    const workspaceId = activeWorkspaceId
    if (!user || workspaceId === null) return Promise.resolve(false)
    const draft = {
      ...createEmptyItemDraft(),
      ...activeView.quickAddDefaults?.(context),
      description,
    }
    if (!activeView.canCreate(draft)) return Promise.resolve(false)
    clearMessages()
    return trackDirectWrite(
      (async () => {
        try {
          // The text lives only in the list's input, so the request must outlive the
          // page if the tab closes right after Enter. It is sent once and never
          // replayed from a snapshot, so keepalive cannot create a second item.
          const response = await itemsFetch("/api/items", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              userId: user.id,
              item: newItemRequestBody(draft, workspaceId, newPublicUid()),
            }),
            keepalive: true,
          })
          const data = await readJson<{ item: ItemRecord }>(response)
          mergeSavedItem(user.id, data.item)
          scheduleTaxonomyRefresh(user.id)
          return true
        } catch (error) {
          setErrorMessage(getErrorMessage(error))
          return false
        }
      })(),
    )
  }

  const settlePendingItemWrites = useCallback(async () => {
    const settled = await Promise.allSettled([
      ...saveInFlightRef.current.values(),
      ...directWritesRef.current,
    ])
    if (settled.some((result) => result.status === "rejected" || result.value === false))
      throw new Error("An item could not be saved. Resolve the save error and try again.")
  }, [directWritesRef, saveInFlightRef])

  const prepareItemGroupAction = useCallback(
    async (signal?: AbortSignal) => {
      const userId = userRef.current?.id
      const workspaceId = activeWorkspaceIdRef.current
      if (taxonomyRefreshTimeoutRef.current !== null) {
        window.clearTimeout(taxonomyRefreshTimeoutRef.current)
        taxonomyRefreshTimeoutRef.current = null
      }
      // The modal pauses autosave and exit PATCHes. Flush dirty stored items so
      // the preview includes their latest edits. New drafts stay local.
      await settlePendingItemWrites()
      signal?.throwIfAborted()
      if (userRef.current?.id !== userId || activeWorkspaceIdRef.current !== workspaceId)
        throw new Error("The active workspace changed. Reopen the group action.")
      const entries = collectSessionFlushEntries(
        useItemsAppStore.getState().openItems,
        isEntryDirty,
        canSaveEntry,
      ).filter((entry) => entry.itemId !== null)
      const detached = [...detachedSavesRef.current].filter(([, entry]) => entry.itemId !== null)
      const saved = await Promise.all([
        ...entries.map((entry) => saveEntry(entry.key, "flush")),
        ...detached.map(([key]) => saveEntry(key, "flush")),
      ])
      signal?.throwIfAborted()
      if (saved.some((value) => !value))
        throw new Error("Save the pending note changes before changing this group.")
      persistOpenItemsRef.current()
    },
    [
      activeWorkspaceIdRef,
      detachedSavesRef,
      persistOpenItemsRef,
      saveEntry,
      settlePendingItemWrites,
      taxonomyRefreshTimeoutRef,
      userRef,
    ],
  )

  const refreshAfterWorkspaceCleanup = useCallback(
    async (userId: number, workspaceId: number, destinationId?: number, signal?: AbortSignal) => {
      const requestId = ++latestCleanupRefreshRef.current
      const isCurrent = () =>
        requestId === latestCleanupRefreshRef.current &&
        userRef.current?.id === userId &&
        activeWorkspaceIdRef.current === workspaceId
      let data: BootstrapResponse
      try {
        data = await readJson<BootstrapResponse>(
          await itemsFetch(`/api/bootstrap?workspaceId=${destinationId ?? workspaceId}`, {
            cache: "no-store",
            signal,
          }),
        )
      } catch (error) {
        if (isCurrent()) throw error
        return
      }
      if (signal?.aborted || !isCurrent() || data.user.id !== userId) return

      const store = useItemsAppStore.getState()
      if (!data.tags.some(({ id }) => id === store.selectedTagId)) store.setSelectedTagId(null)
      setWorkspaces(data.workspaces)
      setItems(data.items)
      setCategories(data.categories)
      setTags(data.tags)
      setStatuses(data.statuses)
      if (data.activeWorkspaceId !== workspaceId) {
        const drafts = stateWithDetachedSaves(store, detachedSavesRef.current).openItems.filter(
          (entry) => entry.itemId === null && !isEmptyDraft(entry),
        )
        detachedSavesRef.current.clear()
        groupDeferredSaveKeysRef.current.clear()
        queuedAutosaveKeysRef.current.clear()
        activeWorkspaceIdRef.current = data.activeWorkspaceId
        setActiveWorkspaceId(data.activeWorkspaceId)
        store.setSearchQuery("")
        setSearchResults([])
        store.replaceOpenItems(createEmptyOpenItemsState())
        rehydrateOpenItems(userId, {
          workspaceId: data.activeWorkspaceId,
          itemList: data.items,
          categoryList: data.categories,
          statusList: data.statuses,
          tagList: data.tags,
          pendingMerge: false,
          force: true,
          carriedDrafts: drafts,
        })
        if (useItemsAppStore.getState().openItems.length === 0) openDraftEntry()
        setUserPreferences((previous) => ({
          ...previous,
          notesApp: {
            ...(isPreferencesObject(previous.notesApp) ? previous.notesApp : {}),
            currentWorkspaceId: data.activeWorkspaceId,
          },
        }))
      }
      remapEntriesAfterCategoryChange(data.items, data.categories, data.statuses, data.tags)
      persistOpenItemsRef.current()
      writeItemsCache({ userId, ...data })
    },
    [
      activeWorkspaceIdRef,
      detachedSavesRef,
      groupDeferredSaveKeysRef,
      openDraftEntry,
      persistOpenItemsRef,
      queuedAutosaveKeysRef,
      rehydrateOpenItems,
      remapEntriesAfterCategoryChange,
      setActiveWorkspaceId,
      setCategories,
      setItems,
      setSearchResults,
      setStatuses,
      setTags,
      setUserPreferences,
      setWorkspaces,
      userRef,
    ],
  )

  const applyItemGroupAction = useCallback(
    async (result: ItemGroupActionResponse, signal?: AbortSignal) => {
      const currentUser = userRef.current
      const workspaceId = activeWorkspaceIdRef.current
      if (!currentUser || workspaceId === null) return
      const departed = new Set([...result.deletedItemIds, ...(result.workspaceMove?.itemIds ?? [])])
      for (const id of departed) closeEntriesForItemInStore(id)
      for (const [key, entry] of detachedSavesRef.current) {
        if (entry.itemId !== null && departed.has(entry.itemId)) {
          detachedSavesRef.current.delete(key)
          queuedAutosaveKeysRef.current.delete(key)
          groupDeferredSaveKeysRef.current.delete(key)
        }
      }
      const latestItems = applyItemGroupResult(itemsRef.current, result)
      const previousCategories = categoriesRef.current
      const latestCategories = applyItemGroupResultToCategories(previousCategories, result)
      // An entry the server has not saved follows the group it was being filed in.
      const refile = (form: TextCaptureFormState): TextCaptureFormState => {
        const filing = existingFiling(
          latestCategories,
          refileAfterGroupResult(previousCategories, result, {
            categoryId: form.selectedCategoryId,
            subcategoryId: form.selectedSubcategoryId,
          }),
        )
        return isSameFiling(filing, {
          categoryId: form.selectedCategoryId,
          subcategoryId: form.selectedSubcategoryId,
        })
          ? form
          : {
              ...form,
              selectedCategoryId: filing.categoryId,
              selectedSubcategoryId: filing.subcategoryId,
            }
      }
      for (const [key, entry] of detachedSavesRef.current)
        detachedSavesRef.current.set(key, { ...entry, form: refile(entry.form) })
      patchEveryEntry((entry) => {
        if (entry.itemId !== null) return {}
        const form = refile(entry.form)
        return form === entry.form ? {} : { form }
      })
      setItems(latestItems)
      setCategories(latestCategories)
      updateItemsCacheList(currentUser.id, workspaceId, "items", latestItems)
      updateItemsCacheList(currentUser.id, workspaceId, "categories", latestCategories)
      setSearchResults((previous) =>
        previous
          .filter(({ item }) => !departed.has(item.id))
          .map((entry) => ({
            ...entry,
            item: result.items.find((item) => item.id === entry.item.id) ?? entry.item,
          })),
      )
      remapEntriesAfterCategoryChange(latestItems, latestCategories, statuses, tagsRef.current)
      persistOpenItemsRef.current()
      setStatusMessage(
        result.workspaceMove
          ? `Moved ${result.workspaceMove.itemIds.length === 1 ? "1 item" : `${result.workspaceMove.itemIds.length} items`} to another workspace.`
          : result.deletedItemIds.length
            ? `Deleted ${result.deletedItemIds.length} items.`
            : "Categories updated.",
      )
      // The committed result is already applied. A failed count/search refresh
      // must never leave a completed destructive action available to replay.
      try {
        if (result.cleanup) {
          await refreshAfterWorkspaceCleanup(
            currentUser.id,
            workspaceId,
            result.cleanup.workspaceRemoved
              ? result.workspaceMove?.destinationWorkspaceId
              : undefined,
            signal,
          )
        } else {
          await refreshResults(currentUser.id)
        }
      } catch (error) {
        if (!signal?.aborted) setErrorMessage(`The change was saved. ${getErrorMessage(error)}`)
      }
    },
    [
      activeWorkspaceIdRef,
      categoriesRef,
      closeEntriesForItemInStore,
      detachedSavesRef,
      groupDeferredSaveKeysRef,
      itemsRef,
      patchEveryEntry,
      persistOpenItemsRef,
      queuedAutosaveKeysRef,
      refreshAfterWorkspaceCleanup,
      refreshResults,
      remapEntriesAfterCategoryChange,
      setCategories,
      setErrorMessage,
      setItems,
      setSearchResults,
      setStatusMessage,
      statuses,
      tagsRef,
      userRef,
    ],
  )

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

  /**
   * Store a time block from the time view's form: a new item, or the block, text, and
   * filing of an existing one. Like a list action it writes directly, after saving any
   * open edits to the item, and names the version it changes so it cannot write over
   * a change made elsewhere. Returns the stored item, or null with a message shown.
   */
  const handleSaveTimeBlock = (
    existing: ItemRecord | null,
    values: {
      timeStart: string
      timeEnd: string
      timePlanned: boolean
      description: string
      categoryId: number | null
      /** Names the item a create stores, so repeating the create stores it once. */
      uid: string
    },
  ): Promise<ItemRecord | null> => {
    const workspaceId = activeWorkspaceId
    if (!user || workspaceId === null) return Promise.resolve(null)
    const userId = user.id
    clearMessages()
    const send = async (current: ItemRecord | null) => {
      const stored = current ? storedItemFields(current) : null
      const keepsFiling = stored !== null && stored.categoryId === values.categoryId
      const response = await itemsFetch("/api/items", {
        method: current ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
          ...(current ? { itemId: current.id, expectedTimeModified: current.timeModified } : {}),
          item: {
            ...(current ? {} : { uid: values.uid }),
            workspaceId,
            categoryId: values.categoryId,
            subcategoryId: keepsFiling ? stored.subcategoryId : null,
            statusId: stored?.statusId ?? null,
            tagIds: stored?.tagIds ?? [],
            description: values.description,
            timeStart: values.timeStart,
            timeEnd: values.timeEnd,
            timePlanned: values.timePlanned,
            timeDue: current?.timeDue ?? null,
            timeRemind: current?.timeRemind ?? null,
          },
        }),
      })
      const data = await readJson<{ item: ItemRecord }>(response)
      mergeSavedItem(userId, data.item)
      applyServerItemToEntry(data.item)
      scheduleTaxonomyRefresh(userId)
      return data.item
    }
    const write = existing
      ? enqueueSidebarWrite(existing.id, async () => {
          const current = await readItemForSidebarWrite(existing)
          if (!current) throw new Error("This item is no longer here.")
          return send(current)
        })
      : send(null)
    return trackDirectWrite(
      write.then(
        () => true,
        (error) => {
          setErrorMessage(getErrorMessage(error))
          return false
        },
      ),
    ).then(async (stored) => (stored ? await write : null))
  }

  /**
   * A restored item joins the lists of its workspace. The restore may have created that
   * workspace and the item's vocabulary again, so both are loaded afresh.
   */
  const handleItemRestored = (item: ItemRecord) => {
    if (!user) return
    const userId = user.id
    mergeSavedItem(userId, item)
    scheduleTaxonomyRefresh(userId)
    setStatusMessage(
      item.workspaceId === activeWorkspaceIdRef.current
        ? "Item restored."
        : "Item restored to its workspace.",
    )
    void (async () => {
      try {
        const data = await readJson<{ workspaces: WorkspaceRecord[] }>(
          await itemsFetch("/api/workspaces", { cache: "no-store" }),
        )
        if (userRef.current?.id === userId) setWorkspaces(data.workspaces)
      } catch {
        // The workspace list is refreshed by the next load.
      }
    })()
  }

  const handleDeleteItem = async (itemId: number) => {
    const workspaceId = activeWorkspaceId
    if (!user || workspaceId === null) return
    clearMessages()
    setDeletingItemId(itemId)
    // Marked before the request: a save of the open entry that is answered 404 must not
    // create the note again.
    markItemDeletedByUser(itemId)
    try {
      await settlePendingItemWrites()
      if (userRef.current?.id !== user.id || activeWorkspaceIdRef.current !== workspaceId) return
      const response = await itemsFetch("/api/items", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.id, itemId, workspaceId }),
      })
      await readJson<{ ok: true }>(response)
      if (userRef.current?.id !== user.id || activeWorkspaceIdRef.current !== workspaceId) return
      closeEntriesForItemInStore(itemId)
      for (const [key, entry] of detachedSavesRef.current) {
        if (entry.itemId !== itemId) continue
        detachedSavesRef.current.delete(key)
        queuedAutosaveKeysRef.current.delete(key)
        groupDeferredSaveKeysRef.current.delete(key)
      }
      const latestItems = itemsRef.current.filter(({ id }) => id !== itemId)
      setItems(latestItems)
      updateItemsCacheList(user.id, workspaceId, "items", latestItems)
      setSearchResults((previous) => previous.filter(({ item }) => item.id !== itemId))
      persistOpenItemsRef.current()
      setStatusMessage("Item moved to the trash.")
      await refreshAfterWorkspaceCleanup(user.id, workspaceId).catch((error) =>
        setErrorMessage(`The item was deleted. ${getErrorMessage(error)}`),
      )
    } catch (error) {
      unmarkItemDeletedByUser(itemId)
      setErrorMessage(getErrorMessage(error))
    } finally {
      setDeletingItemId(null)
    }
  }

  return {
    handleTagValuesChange,
    handleCreateStatus,
    handleOpenItemFromResults,
    handleAddItemForCategory,
    handleAddItemForTag,
    handleSelectCategory,
    handleSelectSubcategory,
    handleSelectStatus,
    handleCreateTag,
    createWorkspaceCategory,
    handleCreateCategory,
    handleCreateSubcategory,
    resolveTagForSidebarMove,
    patchItemFromSidebar,
    handleSetItemStatus,
    handleQuickAddItem,
    handleMoveItemFiling,
    handleMoveItemTag,
    prepareItemGroupAction,
    applyItemGroupAction,
    openEditTag,
    closeEditTag,
    handleSaveTag,
    performDeleteTag,
    openDeleteTag,
    closeDeleteTag,
    handleConfirmDeleteTag,
    handleDeleteItem,
    handleItemRestored,
    handleSaveTimeBlock,
  }
}

export type TaxonomyActionsOutput = ReturnType<typeof useTaxonomyActions>
