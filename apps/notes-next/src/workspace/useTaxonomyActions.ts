"use client"

import { markItemDeletedByUser, unmarkItemDeletedByUser } from "@/lib/userDeletedItems"
import {
  type CategoryRecord,
  type CreateCategoryResponse,
  type CreateTagResponse,
  type DeleteTagResponse,
  type ItemRecord,
  type SubcategoryRecord,
  type TagRecord,
  type UpdateTagResponse,
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
import { updateItemsCacheList } from "@/lib/itemsCache"
import { type OpenItemKey, itemEntryKey } from "@/stores/openItems"
import { useItemsAppStore } from "@/stores/itemsAppStore"
import { useWorkspaceStore } from "@/stores/workspaceStore"
import { createEmptyItemDraft } from "@/capabilities/draftParts"
import { newItemRequestBody, serializeItemDraft } from "@/lib/itemDraft"
import { newPublicUid } from "@/lib/publicUid"
import { itemToFormState } from "@/types/items"
import { itemFilingLabel } from "@/lib/itemFiling"
import {
  type StoredItemChange,
  changesNothing,
  draftAfterListWrite,
  storedItemFields,
} from "@/lib/listWrites"
import { collectSessionFlushEntries } from "@/lib/openItemsExit"
import { canSaveEntry } from "@/views/registry"
import { existingFiling, filingLabel, isSameFiling, upsertCategory } from "@/lib/itemFiling"
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
    remapEntriesAfterCategoryChange,
    saveEntry,
    scheduleTaxonomyRefresh,
    saveInFlightRef,
    searchMode,
    selectedTagId,
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
    openDraftEntry({ ...filing, categoryLabel: filingLabel(categories, filing) })
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
          selectedCategoryId: existingCategory.id,
          selectedSubcategoryId:
            entry.form.selectedCategoryId === existingCategory.id
              ? entry.form.selectedSubcategoryId
              : null,
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
      setCategories((prev) => upsertCategory(prev, data.category))
      patchEntry(targetKey, (entry) => ({
        form: {
          ...entry.form,
          selectedCategoryId: data.category.id,
          selectedSubcategoryId: null,
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
          workspaceId: activeWorkspaceId,
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
    setCategories((prev) => upsertCategory(prev, data.category))
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
  ): Promise<ItemRecord | null> => {
    const queue = listWritesByItemRef.current
    const previous = queue.get(listedItem.id) ?? Promise.resolve()
    const write = previous.then(() => patchStoredItem(listedItem, change))
    const settled = write.then(
      () => undefined,
      () => undefined,
    )
    queue.set(listedItem.id, settled)
    void settled.then(() => {
      if (queue.get(listedItem.id) === settled) queue.delete(listedItem.id)
    })
    return write
  }

  const patchStoredItem = async (
    listedItem: ItemRecord,
    change: (current: ItemRecord) => StoredItemChange,
  ) => {
    if (!user) return null
    // An earlier write in the queue may have changed the item since it was listed.
    const latest =
      useWorkspaceStore.getState().items.find((stored) => stored.id === listedItem.id) ?? listedItem
    const item = await settleOpenEntryFor(latest)
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

  const handleMoveItemCategory = async (item: ItemRecord, categoryLabel: string) => {
    if (!user) return
    clearMessages()
    try {
      const category = await resolveCategoryForSidebarMove(categoryLabel)
      if (!category) return
      if (item.category?.id === category.id) return

      // A subcategory belongs to the category the note is leaving.
      const moved = await patchItemFromSidebar(item, () => ({
        categoryId: category.id,
        subcategoryId: null,
      }))
      if (moved) setStatusMessage(`Note moved to “${category.label}”.`)
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

  /**
   * Set or clear an item's status from a list, as a board does when a card moves.
   * `refuse` is the view's own rule for the move: it sees the item as stored when the
   * write runs and returns a message to refuse it.
   */
  const handleSetItemStatus = (
    item: ItemRecord,
    statusId: number | null,
    refuse?: (current: ItemRecord) => string | null,
  ) => {
    if (!user) return Promise.resolve(false)
    clearMessages()
    return trackDirectWrite(
      (async () => {
        try {
          await patchItemFromSidebar(item, (current) => {
            const reason = refuse?.(current) ?? null
            if (reason !== null) throw new Error(reason)
            return { statusId }
          })
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

  const prepareItemGroupAction = useCallback(async () => {
    const userId = userRef.current?.id
    const workspaceId = activeWorkspaceIdRef.current
    if (taxonomyRefreshTimeoutRef.current !== null) {
      window.clearTimeout(taxonomyRefreshTimeoutRef.current)
      taxonomyRefreshTimeoutRef.current = null
    }
    // Opening the modal synchronously pauses autosave and exit PATCHes. Settle
    // existing requests, then save the dirty stored entries their view would save;
    // new drafts are not members of a server-side group.
    const settled = await Promise.allSettled([...saveInFlightRef.current.values()])
    if (settled.some((result) => result.status === "rejected"))
      throw new Error(
        "A note could not be saved. Resolve the save error before changing this group.",
      )
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
    if (saved.some((value) => !value))
      throw new Error("Save the pending note changes before changing this group.")
    persistOpenItemsRef.current()
  }, [
    activeWorkspaceIdRef,
    detachedSavesRef,
    persistOpenItemsRef,
    saveEntry,
    saveInFlightRef,
    taxonomyRefreshTimeoutRef,
    userRef,
  ])

  const applyItemGroupAction = useCallback(
    (result: ItemGroupActionResponse) => {
      const currentUser = userRef.current
      const workspaceId = activeWorkspaceIdRef.current
      if (!currentUser || workspaceId === null) return
      const deleted = new Set(result.deletedItemIds)
      for (const id of deleted) closeEntriesForItemInStore(id)
      for (const [key, entry] of detachedSavesRef.current) {
        if (entry.itemId !== null && deleted.has(entry.itemId)) {
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
          .filter(({ item }) => !deleted.has(item.id))
          .map((entry) => ({
            ...entry,
            item: result.items.find((item) => item.id === entry.item.id) ?? entry.item,
          })),
      )
      remapEntriesAfterCategoryChange(latestItems, latestCategories, statuses, tagsRef.current)
      persistOpenItemsRef.current()
      setStatusMessage(
        result.deletedItemIds.length
          ? `Deleted ${result.deletedItemIds.length} items.`
          : "Categories updated.",
      )
      // The committed result is already applied. A failed count/search refresh
      // must never leave a completed destructive action available to replay.
      void refreshResults(currentUser.id).catch((error) =>
        setErrorMessage(`The change was saved. ${getErrorMessage(error)}`),
      )
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

  const handleDeleteItem = async (itemId: number) => {
    if (!user) return
    clearMessages()
    setDeletingItemId(itemId)
    // Marked before the request: a save of the open entry that is answered 404 must not
    // create the note again.
    markItemDeletedByUser(itemId)
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
    handleCreateCategory,
    handleCreateSubcategory,
    resolveCategoryForSidebarMove,
    resolveTagForSidebarMove,
    patchItemFromSidebar,
    handleSetItemStatus,
    handleQuickAddItem,
    handleMoveItemCategory,
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
  }
}

export type TaxonomyActionsOutput = ReturnType<typeof useTaxonomyActions>
