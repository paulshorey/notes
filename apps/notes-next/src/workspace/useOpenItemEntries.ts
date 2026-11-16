"use client"

import {
  type CategoryRecord,
  type ItemRecord,
  type StatusRecord,
  type TagRecord,
} from "@lib/db-items"
import { type Dispatch, type SetStateAction, useCallback, useEffect, useMemo } from "react"
import { type TextCaptureFormState, itemToFormState } from "@/types/items"
import { serializeItemDraft } from "@/lib/itemDraft"
import {
  readOpenItemsSnapshot,
  readOpenItemsSnapshotForAnyUser,
  reconcileOpenItems,
} from "@/lib/openItemsStorage"
import { type OpenItemKey, clampMaxOpenItems, itemEntryKey } from "@/stores/openItems"
import { useItemsAppStore } from "@/stores/itemsAppStore"
import { existingFiling, filingLabel, isSameFiling, itemFilingLabel } from "@/lib/itemFiling"
import { readItemsUrlSelection, writeItemsUrlSelection } from "@/lib/itemsUrlSelection"
import { getMaxOpenItemsPreference, withMaxOpenItemsPreference } from "@/lib/userPreferences"
import { EMPTY_ITEM_FORM, isEntryDirty } from "@/workspace/shared"
import type { WorkspaceStateOutput } from "./useWorkspaceState"
import type { ItemSaveEngineOutput } from "./useItemSaveEngine"

export function useOpenItemEntries(ctx: WorkspaceStateOutput & ItemSaveEngineOutput) {
  const {
    activeEntry,
    activeKey,
    categories,
    categoriesRef,
    clearMessages,
    closeEntryInStore,
    detachRemovedEntries,
    detachedSavesRef,
    didRehydrateOpenItemsRef,
    itemsRef,
    itemsUrlSelectionReady,
    openExistingItemInStore,
    openItems,
    openNewDraftInStore,
    patchEntry,
    patchEntryForm,
    patchEveryEntry,
    replaceOpenItems,
    setItemsUrlSelectionReady,
    setMaxOpenItemsInStore,
    setStatusMessage,
    setUserPreferences,
    tagsRef,
    user,
  } = ctx

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
    [detachRemovedEntries, detachedSavesRef, openExistingItemInStore, patchEntry],
  )

  const openDraftEntry = useCallback(
    (
      options: {
        categoryId?: number | null
        subcategoryId?: number | null
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
      const statusIds = new Set(statusList.map((status) => status.id))
      const tagIds = new Set(tagList.map((tag) => tag.id))

      const { state, orphanedDraftCount } = reconcileOpenItems(
        usable,
        (itemId) => itemsById.get(itemId),
        {
          existingFiling: (filing) => existingFiling(categoryList, filing),
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
    [didRehydrateOpenItemsRef, replaceOpenItems, setStatusMessage],
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
      const filing = existingFiling(categoryList, selection)

      openDraftEntry({
        ...filing,
        tagIds: validTagIds,
        categoryLabel: filingLabel(categoryList, filing),
      })
      setItemsUrlSelectionReady(true)
    },
    [categoriesRef, itemsRef, openDraftEntry, openItemEntry, setItemsUrlSelectionReady, tagsRef],
  )

  const handleCancelEdit = useCallback(() => {
    // Adds a draft alongside the open notes rather than replacing one. The
    // outgoing entry keeps autosaving in the background, so there is nothing
    // to await here.
    clearMessages()
    openDraftEntry({ categoryId: null, statusId: null, tagIds: [] })
  }, [clearMessages, openDraftEntry])

  const handleAddItemInCategory = useCallback(() => {
    clearMessages()
    const form = useItemsAppStore
      .getState()
      .openItems.find((entry) => entry.key === activeKey)?.form
    // The new note starts where the current one is filed.
    const filing = existingFiling(categoriesRef.current, {
      categoryId: form?.selectedCategoryId ?? null,
      subcategoryId: form?.selectedSubcategoryId ?? null,
    })
    openDraftEntry({ ...filing, categoryLabel: filingLabel(categoriesRef.current, filing) })
  }, [activeKey, categoriesRef, clearMessages, openDraftEntry])

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
            categoryInputValue: itemFilingLabel(serverItem),
            pendingTagLabels: [],
          }
        }

        const current = {
          categoryId: entry.form.selectedCategoryId,
          subcategoryId: entry.form.selectedSubcategoryId,
        }
        const filing = existingFiling(categoryList, current)
        const validStatusId =
          entry.form.selectedStatusId === null ||
          statusList.some((status) => status.id === entry.form.selectedStatusId)
            ? entry.form.selectedStatusId
            : null
        const validTagIds = entry.form.selectedTagIds.filter((id) =>
          tagList.some((tag) => tag.id === id),
        )
        if (
          isSameFiling(filing, current) &&
          validStatusId === entry.form.selectedStatusId &&
          validTagIds.length === entry.form.selectedTagIds.length
        ) {
          return {}
        }

        const form = {
          ...entry.form,
          selectedCategoryId: filing.categoryId,
          selectedSubcategoryId: filing.subcategoryId,
          selectedStatusId: validStatusId,
          selectedTagIds: validTagIds,
        }
        return {
          form,
          savedSignature: isEntryDirty(entry)
            ? entry.savedSignature
            : serializeItemDraft(entry.itemId, form),
          categoryInputValue: filingLabel(categoryList, filing),
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
        categoryInputValue: itemFilingLabel(item),
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

  const filingLabelFor = useCallback(
    (form: TextCaptureFormState) =>
      filingLabel(categories, {
        categoryId: form.selectedCategoryId,
        subcategoryId: form.selectedSubcategoryId,
      }) || "uncategorized",
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
    [detachRemovedEntries, setMaxOpenItemsInStore, setUserPreferences],
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

  // The reveal highlight is a one-shot: the editor consumes it at mount, so
  // clear it once handed over. Otherwise coming back to a note opened from a
  // search result would re-scroll and re-highlight every time.
  useEffect(() => {
    if (!activeEntry?.revealText) return
    patchEntry(activeEntry.key, { revealText: null })
  }, [activeEntry?.key, activeEntry?.revealText, patchEntry])

  useEffect(() => {
    if (!user) return
    if (!itemsUrlSelectionReady) return

    // Mirrors the *active* entry so the address bar stays copy-pasteable.
    writeItemsUrlSelection({
      itemId: activeEntry?.itemId ?? null,
      categoryId: activeEntry?.form.selectedCategoryId ?? null,
      subcategoryId: activeEntry?.form.selectedSubcategoryId ?? null,
      tagIds: activeEntry?.form.selectedTagIds ?? [],
    })
  }, [
    activeEntry?.itemId,
    activeEntry?.form.selectedCategoryId,
    activeEntry?.form.selectedSubcategoryId,
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

  return {
    openItemEntry,
    openDraftEntry,
    rehydrateOpenItems,
    applyItemsUrlSelection,
    handleCancelEdit,
    handleAddItemInCategory,
    remapEntriesAfterCategoryChange,
    applyServerItemToEntry,
    activeForm,
    openItemIds,
    setActiveForm,
    filingLabelFor,
    handleCloseOpenItem,
    handleMaxOpenItemsChange,
  }
}

export type OpenItemEntriesOutput = ReturnType<typeof useOpenItemEntries>
