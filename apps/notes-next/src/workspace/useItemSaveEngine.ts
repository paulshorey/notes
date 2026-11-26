"use client"

import { useCallback, useEffect, useMemo, useRef } from "react"
import { useOpenItemsAutosave } from "@/hooks/useOpenItemsAutosave"
import { createSaveEngine } from "@/lib/saveEngine"
import { stateWithDetachedSaves } from "@/lib/openItemsExit"
import { writeOpenItemsSnapshot } from "@/lib/openItemsStorage"
import type { OpenItemKey } from "@/stores/openItems"
import { useItemsAppStore } from "@/stores/itemsAppStore"
import { canSaveEntry } from "@/views/registry"
import { OPEN_ITEMS_PERSIST_DEBOUNCE_MS, isEntryDirty } from "@/workspace/shared"
import type { WorkspaceStateOutput } from "./useWorkspaceState"
import type { WorkspaceDataOutput } from "./useWorkspaceData"

export function useItemSaveEngine(ctx: WorkspaceStateOutput & WorkspaceDataOutput) {
  const {
    activeKey,
    activeView,
    activeWorkspaceIdRef,
    detachedSavesRef,
    didRehydrateOpenItemsRef,
    directWritesRef,
    exitKeepaliveKeysRef,
    flushAllPendingSavesRef,
    groupDeferredSaveKeysRef,
    itemGroupDialog,
    forgetDeletedItem,
    mergeSavedItem,
    openItems,
    openItemsPersistTimeoutRef,
    patchEntry,
    persistOpenItemsRef,
    preferredMaxOpenItems,
    queuedAutosaveKeysRef,
    saveEntryRef,
    saveInFlightRef,
    scheduleTaxonomyRefresh,
    setErrorMessage,
    setSaveConflictItem,
    setMaxOpenItemsInStore,
    setStatusMessage,
    user,
    userRef,
  } = ctx

  // A hide-time request or a create with a lost reply may have landed under this uid.
  const unconfirmedSignaturesRef = useRef(new Map<string, string>())
  // The draft a failed save could not store, by entry. Its status stays "error" until
  // the draft changes or a save succeeds.
  const failedSignaturesRef = useRef(new Map<OpenItemKey, string>())

  const {
    saveEntry,
    detachRemovedEntries,
    flushAllPendingSaves,
    keepEntryOverStoredItem,
    syncSaveStatuses,
    flushOnExit,
  } = useMemo(
    () =>
      createSaveEngine({
        fetch,
        timeoutSignal: (ms) => AbortSignal.timeout(ms),
        getUser: () => userRef.current,
        getWorkspaceId: () => activeWorkspaceIdRef.current,
        getOpenItems: () => useItemsAppStore.getState().openItems,
        isGroupDialogOpen: () => Boolean(useItemsAppStore.getState().itemGroupDialog),
        detachedSaves: detachedSavesRef.current,
        saveInFlight: saveInFlightRef.current,
        queuedAutosaveKeys: queuedAutosaveKeysRef.current,
        groupDeferredSaveKeys: groupDeferredSaveKeysRef.current,
        exitKeepaliveKeys: exitKeepaliveKeysRef.current,
        unconfirmedSignatures: unconfirmedSignaturesRef.current,
        failedSignatures: failedSignaturesRef.current,
        directWrites: directWritesRef.current,
        patchEntry,
        persistOpenItems: () => persistOpenItemsRef.current(),
        finishViewClaim: (key) => useItemsAppStore.getState().finishViewClaim(key),
        mergeSavedItem,
        forgetDeletedItem,
        scheduleTaxonomyRefresh,
        setErrorMessage,
        setSaveConflictItem,
        setStatusMessage,
      }),
    [
      activeWorkspaceIdRef,
      detachedSavesRef,
      directWritesRef,
      exitKeepaliveKeysRef,
      forgetDeletedItem,
      groupDeferredSaveKeysRef,
      mergeSavedItem,
      patchEntry,
      persistOpenItemsRef,
      queuedAutosaveKeysRef,
      saveInFlightRef,
      scheduleTaxonomyRefresh,
      setErrorMessage,
      setSaveConflictItem,
      setStatusMessage,
      userRef,
    ],
  )

  const detachRemovedEntriesRef = useRef(detachRemovedEntries)
  saveEntryRef.current = saveEntry
  flushAllPendingSavesRef.current = flushAllPendingSaves
  detachRemovedEntriesRef.current = detachRemovedEntries

  // Mirror the saved preference into the store so the ring actions can enforce
  // it without it being threaded through every call site.
  useEffect(() => {
    if (preferredMaxOpenItems === useItemsAppStore.getState().maxOpenItems) return
    detachRemovedEntriesRef.current(setMaxOpenItemsInStore(preferredMaxOpenItems))
  }, [preferredMaxOpenItems, setMaxOpenItemsInStore])

  // A draft is created by the rule of the view it was opened in. Just before another
  // view takes an entry over, what is pending is saved under the outgoing view's rule.
  useEffect(() => {
    const store = useItemsAppStore.getState()
    store.setBeforeViewClaim((entry) => {
      // Only a never-saved draft can be something its view does not save, and it has
      // no stored state another view could overwrite; it changes view as typed.
      return isEntryDirty(entry) && canSaveEntry(entry)
        ? { wait: saveEntry(entry.key, "flush") }
        : {}
    })
    return () => useItemsAppStore.getState().setBeforeViewClaim(null)
  }, [saveEntry])

  useEffect(() => {
    useItemsAppStore.getState().setActiveView(activeView.kind, activeView.alwaysShowsEditor)
  }, [activeView])

  useEffect(() => {
    if (itemGroupDialog !== null) return
    const deferred = [...groupDeferredSaveKeysRef.current]
    groupDeferredSaveKeysRef.current.clear()
    for (const key of deferred) void saveEntry(key, "detached")
  }, [groupDeferredSaveKeysRef, itemGroupDialog, saveEntry])

  useOpenItemsAutosave({
    entries: openItems,
    enabled: Boolean(user) && itemGroupDialog === null,
    canSave: canSaveEntry,
    saveEntry,
  })

  // Keep each entry's indicator in sync whenever a save is not running for it
  // (the save routine owns the status while its request is in flight).
  useEffect(() => {
    if (user) syncSaveStatuses(openItems)
  }, [openItems, syncSaveStatuses, user])

  useEffect(() => {
    if (!user) return

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
  }, [exitKeepaliveKeysRef, flushOnExit, user])

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
  }, [activeWorkspaceIdRef, detachedSavesRef, setErrorMessage, userRef])

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
  }, [
    activeKey,
    didRehydrateOpenItemsRef,
    openItems,
    openItemsPersistTimeoutRef,
    persistOpenItems,
    user,
  ])

  return {
    keepEntryOverStoredItem,
    detachRemovedEntries,
    detachRemovedEntriesRef,
    saveEntry,
    flushAllPendingSaves,
    persistOpenItems,
  }
}

export type ItemSaveEngineOutput = ReturnType<typeof useItemSaveEngine>
