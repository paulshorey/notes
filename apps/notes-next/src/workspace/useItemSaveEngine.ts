"use client"

import { type ItemRecord } from "@lib/db-items"
import { useCallback, useEffect, useRef } from "react"
import { getErrorMessage, itemsFetch, readJson } from "@/lib/api"
import { useOpenItemsAutosave } from "@/hooks/useOpenItemsAutosave"
import { itemRequestBody, serializeItemDraft, snapshotTextCaptureForm } from "@/lib/itemDraft"
import {
  collectExitFlushItems,
  collectSessionFlushEntries,
  selectKeepaliveExitItems,
  stateWithDetachedSaves,
} from "@/lib/openItemsExit"
import { writeOpenItemsSnapshot } from "@/lib/openItemsStorage"
import { type OpenItemEntry, type OpenItemKey } from "@/stores/openItems"
import { useItemsAppStore } from "@/stores/itemsAppStore"
import { type ItemSaveMode, OPEN_ITEMS_PERSIST_DEBOUNCE_MS, isEntryDirty } from "@/workspace/shared"
import type { WorkspaceStateOutput } from "./useWorkspaceState"
import type { WorkspaceDataOutput } from "./useWorkspaceData"

export function useItemSaveEngine(ctx: WorkspaceStateOutput & WorkspaceDataOutput) {
  const {
    activeKey,
    activeWorkspaceIdRef,
    canSaveDraft,
    canSaveDraftRef,
    detachedSavesRef,
    didRehydrateOpenItemsRef,
    exitKeepaliveKeysRef,
    flushAllPendingSavesRef,
    groupDeferredSaveKeysRef,
    itemGroupDialog,
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
    setMaxOpenItemsInStore,
    user,
    userRef,
  } = ctx

  const detachRemovedEntries = useCallback<(removed: OpenItemEntry[]) => void>(
    (removed) => {
      for (const entry of removed) {
        if (!isEntryDirty(entry)) continue

        // A draft its view does not save holds nothing to send.
        if (!canSaveDraftRef.current(entry.form)) continue

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
    },
    [canSaveDraftRef, detachedSavesRef, persistOpenItemsRef, saveEntryRef],
  )

  const detachRemovedEntriesRef = useRef(detachRemovedEntries)

  detachRemovedEntriesRef.current = detachRemovedEntries

  // Mirror the saved preference into the store so the ring actions can enforce
  // it without it being threaded through every call site.
  useEffect(() => {
    if (preferredMaxOpenItems === useItemsAppStore.getState().maxOpenItems) return
    detachRemovedEntriesRef.current(setMaxOpenItemsInStore(preferredMaxOpenItems))
  }, [preferredMaxOpenItems, setMaxOpenItemsInStore])

  const saveEntry = useCallback(
    async function saveEntry(key: OpenItemKey, mode: ItemSaveMode): Promise<boolean> {
      if (mode !== "flush" && useItemsAppStore.getState().itemGroupDialog) {
        if (mode === "detached") groupDeferredSaveKeysRef.current.add(key)
        return false
      }
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

      if (!canSaveDraftRef.current(formSnapshot)) return false
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
        if (latest && canSaveDraftRef.current(latest.form) && isEntryDirty(latest)) {
          void saveEntry(key, "autosave")
        }
      }

      return persisted
    },
    [
      activeWorkspaceIdRef,
      canSaveDraftRef,
      detachedSavesRef,
      groupDeferredSaveKeysRef,
      mergeSavedItem,
      patchEntry,
      persistOpenItemsRef,
      queuedAutosaveKeysRef,
      saveInFlightRef,
      scheduleTaxonomyRefresh,
      setErrorMessage,
      userRef,
    ],
  )

  saveEntryRef.current = saveEntry

  /**
   * Persist every dirty entry the active view would save and wait for all of them.
   * Used only where the session or the workspace is about to change, since ordinary
   * note switching does not block on a save. An entry the view does not save, such
   * as a draft holding only a tag, is skipped: it must never block the change.
   */

  const flushAllPendingSaves = useCallback(async () => {
    const entries = collectSessionFlushEntries(
      useItemsAppStore.getState().openItems,
      isEntryDirty,
      canSaveDraftRef.current,
    )
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
  }, [canSaveDraftRef, detachedSavesRef, saveEntry])

  flushAllPendingSavesRef.current = flushAllPendingSaves

  useEffect(() => {
    if (itemGroupDialog !== null) return
    const deferred = [...groupDeferredSaveKeysRef.current]
    groupDeferredSaveKeysRef.current.clear()
    for (const key of deferred) void saveEntry(key, "detached")
  }, [groupDeferredSaveKeysRef, itemGroupDialog, saveEntry])

  useOpenItemsAutosave({
    entries: openItems,
    enabled: Boolean(user) && itemGroupDialog === null,
    canSave: canSaveDraft,
    saveEntry,
  })

  // Keep each entry's indicator in sync whenever a save is not running for it
  // (the save routine owns the status while its request is in flight).
  useEffect(() => {
    if (!user) return

    for (const entry of openItems) {
      if (saveInFlightRef.current.has(entry.key)) continue

      const next =
        entry.itemId === null && !canSaveDraft(entry.form)
          ? "idle"
          : isEntryDirty(entry)
            ? "unsaved"
            : "saved"

      if (entry.saveStatus !== next) patchEntry(entry.key, { saveStatus: next })
    }
  }, [canSaveDraft, openItems, patchEntry, saveInFlightRef, user])

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
      if (useItemsAppStore.getState().itemGroupDialog) return

      const store = useItemsAppStore.getState()
      const pending = collectExitFlushItems(
        store.openItems,
        detachedSavesRef.current,
        isEntryDirty,
        canSaveDraftRef.current,
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
  }, [
    activeWorkspaceIdRef,
    canSaveDraftRef,
    detachedSavesRef,
    exitKeepaliveKeysRef,
    persistOpenItemsRef,
    user,
    userRef,
  ])

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
    detachRemovedEntries,
    detachRemovedEntriesRef,
    saveEntry,
    flushAllPendingSaves,
    persistOpenItems,
  }
}

export type ItemSaveEngineOutput = ReturnType<typeof useItemSaveEngine>
