"use client"

import { type ItemRecord } from "@lib/db-items"
import { useCallback, useEffect, useRef } from "react"
import { getErrorMessage, itemsFetch, readJson } from "@/lib/api"
import { useOpenItemsAutosave } from "@/hooks/useOpenItemsAutosave"
import {
  itemRequestBody,
  newItemRequestBody,
  serializeItemDraft,
  snapshotTextCaptureForm,
} from "@/lib/itemDraft"
import {
  collectExitFlushItems,
  collectSessionFlushEntries,
  selectKeepaliveExitItems,
  stateWithDetachedSaves,
} from "@/lib/openItemsExit"
import { writeOpenItemsSnapshot } from "@/lib/openItemsStorage"
import { type OpenItemEntry, type OpenItemKey } from "@/stores/openItems"
import { useItemsAppStore } from "@/stores/itemsAppStore"
import { canSaveEntry, entrySaveAction } from "@/views/registry"
import { draftHoldsContent } from "@/capabilities/draftParts"
import { type ItemSaveMode, OPEN_ITEMS_PERSIST_DEBOUNCE_MS, isEntryDirty } from "@/workspace/shared"
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
    setMaxOpenItemsInStore,
    setStatusMessage,
    user,
    userRef,
  } = ctx

  const detachRemovedEntries = useCallback<(removed: OpenItemEntry[]) => void>(
    (removed) => {
      for (const entry of removed) {
        if (!isEntryDirty(entry)) continue

        // A draft its view does not save holds nothing to send.
        if (!canSaveEntry(entry)) continue

        detachedSavesRef.current.set(entry.key, {
          itemId: entry.itemId,
          form: snapshotTextCaptureForm(entry.form),
          savedSignature: entry.savedSignature,
          view: entry.view,
          uid: entry.uid,
        })
        void saveEntryRef.current(entry.key, "detached")
      }
      if (removed.some((entry) => isEntryDirty(entry))) {
        persistOpenItemsRef.current()
      }
    },
    [detachedSavesRef, persistOpenItemsRef, saveEntryRef],
  )

  const detachRemovedEntriesRef = useRef(detachRemovedEntries)

  detachRemovedEntriesRef.current = detachRemovedEntries

  // Mirror the saved preference into the store so the ring actions can enforce
  // it without it being threaded through every call site.
  useEffect(() => {
    if (preferredMaxOpenItems === useItemsAppStore.getState().maxOpenItems) return
    detachRemovedEntriesRef.current(setMaxOpenItemsInStore(preferredMaxOpenItems))
  }, [preferredMaxOpenItems, setMaxOpenItemsInStore])

  /**
   * Forget the record of an entry that left the ring, once the save that captured it
   * has stored its text. Only that save may do it, and only while the record still
   * holds the text it captured: a save of the open entry that started earlier, or a
   * later record for the same key, would otherwise erase words that were never sent.
   */
  const forgetDetachedSave = useCallback(
    (key: OpenItemKey, captured: { form: unknown }) => {
      if (detachedSavesRef.current.get(key)?.form !== captured.form) return
      detachedSavesRef.current.delete(key)
      // Evicted notes live in the snapshot until this lands. Drop them now so a
      // reload does not reopen a note the user already closed.
      persistOpenItemsRef.current()
    },
    [detachedSavesRef, persistOpenItemsRef],
  )

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

      let formSnapshot = snapshotTextCaptureForm(source.form)
      let itemId = source.itemId
      let draftSignature = serializeItemDraft(itemId, formSnapshot)

      if (!canSaveEntry({ view: source.view, form: formSnapshot, itemId })) return false
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
        if (draftSignature === settled.savedSignature) {
          // The save this one waited for already stored the same content, so the
          // record of what left the ring has nothing more to send.
          if (detached) forgetDetachedSave(key, detached)
          return true
        }
      }

      // Decided once the item's address is settled: the save that was in flight may
      // have created the item, or deleted it.
      const action = entrySaveAction({ view: source.view, form: formSnapshot, itemId })
      if (action === null) return true

      if (!detached) patchEntry(key, { saveStatus: "saving" })

      const savePromise = (async () => {
        const send = (method: "POST" | "PATCH" | "DELETE", body: object) =>
          itemsFetch("/api/items", {
            method,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ userId: currentUser.id, ...body }),
          })
        const update = (id: number) =>
          send("PATCH", { itemId: id, item: itemRequestBody(formSnapshot, workspaceId) })

        // The edit left the item holding nothing, and an item without content is not
        // kept. The entry stays open as an unsaved draft: if the user types again, it
        // is created anew under the same uid.
        if (action === "delete" && itemId !== null) {
          // This snapshot may be older than the entry: a flush or a queued save pins
          // it before waiting its turn. If the user has typed since, the item is not
          // empty any more, and this save sends what it holds now instead.
          const current =
            detachedSavesRef.current.get(key) ??
            useItemsAppStore.getState().openItems.find((item) => item.key === key)
          if (current && draftHoldsContent(current.form)) {
            formSnapshot = snapshotTextCaptureForm(current.form)
          } else {
            // Already gone is the outcome asked for: the exit keepalive may have sent
            // this deletion, or an earlier answer was lost.
            const response = await send("DELETE", { itemId })
            if (response.status !== 404) await readJson<{ ok: true }>(response)
            if (userRef.current?.id !== currentUser.id) return
            forgetDeletedItem(currentUser.id, workspaceId, itemId)
            scheduleTaxonomyRefresh(currentUser.id)
            patchEntry(key, { itemId: null, baseTimeModified: null, savedSignature: null })
            const detachedRecord = detachedSavesRef.current.get(key)
            if (detachedRecord) {
              detachedSavesRef.current.set(key, {
                ...detachedRecord,
                itemId: null,
                savedSignature: null,
              })
            }
            setStatusMessage("The empty note was removed.")
            return
          }
        }

        const create = () =>
          send("POST", { item: newItemRequestBody(formSnapshot, workspaceId, source.uid) })

        let creating = itemId === null
        let response = itemId === null ? await create() : await update(itemId)
        // The item was deleted somewhere else while this entry was open. What the user
        // is writing is kept: it is created again under the entry's uid.
        if (!creating && response.status === 404) {
          creating = true
          response = await create()
        }
        let data = await readJson<{ item: ItemRecord }>(response)

        // A create answered with 200 found the item an earlier attempt had stored, so
        // this version was not written. It goes to that item as an update.
        if (creating && response.status === 200) {
          response = await update(data.item.id)
          data = await readJson<{ item: ItemRecord }>(response)
        }

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
        // A view may be waiting to take this entry until its edits are stored.
        useItemsAppStore.getState().finishViewClaim(key)
        if (userRef.current?.id === currentUser.id && !detached) {
          const live = useItemsAppStore.getState().openItems.find((item) => item.key === key)
          if (live) {
            patchEntry(key, {
              saveStatus:
                live.itemId === null && !canSaveEntry(live)
                  ? "idle"
                  : isEntryDirty(live)
                    ? "unsaved"
                    : "saved",
            })
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
        if (persisted && detached) forgetDetachedSave(key, detached)
      }

      if (queuedAutosaveKeysRef.current.delete(key)) {
        const latest = useItemsAppStore.getState().openItems.find((item) => item.key === key)
        if (latest && canSaveEntry(latest) && isEntryDirty(latest)) {
          void saveEntry(key, "autosave")
        }
      }

      return persisted
    },
    [
      activeWorkspaceIdRef,
      detachedSavesRef,
      groupDeferredSaveKeysRef,
      forgetDeletedItem,
      forgetDetachedSave,
      mergeSavedItem,
      patchEntry,
      queuedAutosaveKeysRef,
      saveInFlightRef,
      scheduleTaxonomyRefresh,
      setErrorMessage,
      setStatusMessage,
      userRef,
    ],
  )

  saveEntryRef.current = saveEntry

  /**
   * Persist every dirty entry that has a save to send and wait for all of them. Used
   * only where the session or the workspace is about to change, since ordinary note
   * switching does not block on a save. An entry with nothing to send, such as a
   * Notes draft holding only a tag, is skipped: it must never block the change.
   */

  const flushAllPendingSaves = useCallback(async () => {
    const entries = collectSessionFlushEntries(
      useItemsAppStore.getState().openItems,
      isEntryDirty,
      canSaveEntry,
    )
    // Detached work counts too: text that left the ring is exactly the text
    // nobody is looking at, so it is the easiest to lose in a session change.
    const detachedKeys = [...detachedSavesRef.current.keys()]

    const results = await Promise.allSettled([
      ...entries.map((entry) => saveEntry(entry.key, "flush")),
      ...detachedKeys.map((key) => saveEntry(key, "detached")),
      ...directWritesRef.current,
    ])

    // Reports failure rather than swallowing it. Callers are about to tear down
    // or replace the session, so proceeding past a failed save destroys the
    // draft it was carrying.
    return results.every((result) => result.status === "fulfilled" && result.value)
  }, [detachedSavesRef, directWritesRef, saveEntry])

  flushAllPendingSavesRef.current = flushAllPendingSaves

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
    if (!user) return

    for (const entry of openItems) {
      if (saveInFlightRef.current.has(entry.key)) continue

      const next =
        entry.itemId === null && !canSaveEntry(entry)
          ? "idle"
          : isEntryDirty(entry)
            ? "unsaved"
            : "saved"

      if (entry.saveStatus !== next) patchEntry(entry.key, { saveStatus: next })
    }
  }, [openItems, patchEntry, saveInFlightRef, user])

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
        canSaveEntry,
      )
      const keepalive = selectKeepaliveExitItems(pending, exitKeepaliveKeysRef.current)

      for (const { key, itemId, uid, form } of keepalive) {
        exitKeepaliveKeysRef.current.add(key)

        // The same three outcomes as a save: a new item, an update, or the deletion of
        // an item whose content was removed.
        const removing = itemId !== null && !draftHoldsContent(form)
        const requestBody =
          itemId === null
            ? { userId: currentUser.id, item: newItemRequestBody(form, workspaceId, uid) }
            : removing
              ? { userId: currentUser.id, itemId }
              : { userId: currentUser.id, itemId, item: itemRequestBody(form, workspaceId) }

        try {
          void itemsFetch("/api/items", {
            method: itemId === null ? "POST" : removing ? "DELETE" : "PATCH",
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
