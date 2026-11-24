import type { ItemRecord } from "@lib/db-items"
import { draftHoldsContent } from "@/capabilities/draftParts"
import { RequestError, getErrorMessage, readJson } from "@/lib/api"
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
} from "@/lib/openItemsExit"
import { wasItemDeletedByUser } from "@/lib/userDeletedItems"
import { itemEntryKey, type OpenItemEntry, type OpenItemKey } from "@/stores/openItems"
import { itemToFormState } from "@/types/items"
import { canSaveEntry, entrySaveAction } from "@/views/registry"
import { isEntryDirty, type DetachedSave, type ItemSaveMode } from "@/workspace/shared"

type PatchEntry = (key: OpenItemKey, patch: Partial<OpenItemEntry>) => void

interface SaveDependencies {
  fetch: typeof fetch
  timeoutSignal: (ms: number) => AbortSignal
  getUser: () => { id: number } | null
  getWorkspaceId: () => number | null
  getOpenItems: () => OpenItemEntry[]
  isGroupDialogOpen: () => boolean
  detachedSaves: Map<OpenItemKey, DetachedSave>
  saveInFlight: Map<OpenItemKey, Promise<void>>
  directWrites: Set<Promise<boolean>>
  queuedAutosaveKeys: Set<OpenItemKey>
  groupDeferredSaveKeys: Set<OpenItemKey>
  exitKeepaliveKeys: Set<OpenItemKey>
  exitSentSignatures: Map<OpenItemKey, string>
  failedSignatures: Map<OpenItemKey, string>
  patchEntry: PatchEntry
  persistOpenItems: () => void
  finishViewClaim: (key: OpenItemKey) => void
  mergeSavedItem: (userId: number, item: ItemRecord) => void
  forgetDeletedItem: (userId: number, workspaceId: number, itemId: number) => void
  scheduleTaxonomyRefresh: (userId: number) => void
  setErrorMessage: (message: string) => void
  setSaveConflictUid: (uid: string | null) => void
  setSaveConflictText: (text: string | null) => void
  setStatusMessage: (message: string) => void
}

const ITEM_SAVE_TIMEOUT_MS = 30_000

function settledSaveStatus(entry: OpenItemEntry) {
  if (entry.itemId === null && !canSaveEntry(entry)) return "idle"
  return isEntryDirty(entry) ? "unsaved" : "saved"
}

export function createSaveEngine({
  fetch,
  timeoutSignal,
  getUser,
  getWorkspaceId,
  getOpenItems,
  isGroupDialogOpen,
  detachedSaves,
  saveInFlight,
  directWrites,
  queuedAutosaveKeys,
  groupDeferredSaveKeys,
  exitKeepaliveKeys,
  exitSentSignatures,
  failedSignatures,
  patchEntry,
  persistOpenItems,
  finishViewClaim,
  mergeSavedItem,
  forgetDeletedItem,
  scheduleTaxonomyRefresh,
  setErrorMessage,
  setSaveConflictUid,
  setSaveConflictText,
  setStatusMessage,
}: SaveDependencies) {
  const getEntry = (key: OpenItemKey) => getOpenItems().find((entry) => entry.key === key)

  function detachRemovedEntries(removed: OpenItemEntry[]) {
    for (const entry of removed) {
      if (!isEntryDirty(entry)) continue

      // A draft its view does not save holds nothing to send.
      if (!canSaveEntry(entry)) continue

      detachedSaves.set(entry.key, {
        itemId: entry.itemId,
        form: snapshotTextCaptureForm(entry.form),
        savedSignature: entry.savedSignature,
        view: entry.view,
        uid: entry.uid,
      })
      void saveEntry(entry.key, "detached")
    }
    if (removed.some((entry) => isEntryDirty(entry))) {
      persistOpenItems()
    }
  }

  /**
   * Forget the record of an entry that left the ring, once the save that captured it
   * has stored its text. Only that save may do it, and only while the record still
   * holds the text it captured: a save of the open entry that started earlier, or a
   * later record for the same key, would otherwise erase words that were never sent.
   */
  function forgetDetachedSave(key: OpenItemKey, captured: DetachedSave) {
    if (detachedSaves.get(key)?.form !== captured.form) return
    detachedSaves.delete(key)
    // Evicted notes live in the snapshot until this lands. Drop them now so a
    // reload does not reopen a note the user already closed.
    persistOpenItems()
  }

  async function saveEntry(key: OpenItemKey, mode: ItemSaveMode): Promise<boolean> {
    if (mode !== "flush" && isGroupDialogOpen()) {
      if (mode === "detached") groupDeferredSaveKeys.add(key)
      return false
    }
    const currentUser = getUser()
    const workspaceId = getWorkspaceId()
    // No session to save into. Not a failure the caller can act on, but not
    // a success either — a sign-in flush must not read this as "all stored".
    if (!currentUser || workspaceId === null) return false

    // Snapshot before awaiting anything. For a detached entry the snapshot is
    // all that is left of it; for a live one this pins the version being sent
    // so later keystrokes belong to the next save, not this one.
    const detached = detachedSaves.get(key)
    const entry = getEntry(key)

    const source = detached ?? entry
    // Nothing left to save: the entry was closed and its work already landed.
    if (!source) return true

    let formSnapshot = snapshotTextCaptureForm(source.form)
    let itemId = source.itemId
    let draftSignature = serializeItemDraft(itemId, formSnapshot)

    if (!canSaveEntry({ view: source.view, form: formSnapshot, itemId })) return false
    if (entry && !detached && draftSignature === entry.savedSignature) return true

    const inFlight = saveInFlight.get(key)
    if (inFlight) {
      if (mode === "autosave") {
        queuedAutosaveKeys.add(key)
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
      const settled = detachedSaves.get(key) ?? getEntry(key)
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

    // The stored item of an update refused as a conflict, for the notice.
    let conflicting: ItemRecord | null = null
    // What this save stored, and whether it went on from the hide-time request.
    let landedSignature: string | null = null
    let reconciledExitSave = false

    const savePromise = (async () => {
      const send = (method: "POST" | "PATCH" | "DELETE", body: object) =>
        fetch("/api/items", {
          method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId: currentUser.id, ...body }),
          // A request that never answers would hold every later save of this entry
          // behind it. Ending it reports a failed save, which is tried again.
          signal: timeoutSignal(ITEM_SAVE_TIMEOUT_MS),
        })
      const update = (id: number, expectedTimeModified?: string | null) =>
        send("PATCH", {
          itemId: id,
          item: itemRequestBody(formSnapshot, workspaceId),
          ...(expectedTimeModified ? { expectedTimeModified } : {}),
        })
      // An open entry edits the item as it was last loaded or saved here, and says
      // so, which lets the server refuse to write over a change made elsewhere. An
      // entry that left the ring has no such record and is stored as it is.
      const liveEntry = () => (detachedSaves.has(key) ? undefined : getEntry(key))

      // The edit left the item holding nothing, and an item without content is not
      // kept. The entry stays open as an unsaved draft: if the user types again, it
      // is created anew under the same uid.
      if (action === "delete" && itemId !== null) {
        // This snapshot may be older than the entry: a flush or a queued save pins
        // it before waiting its turn. If the user has typed since, the item is not
        // empty any more, and this save sends what it holds now instead.
        const current = detachedSaves.get(key) ?? getEntry(key)
        if (current && draftHoldsContent(current.form)) {
          formSnapshot = snapshotTextCaptureForm(current.form)
        } else {
          // Already gone is the outcome asked for: the exit keepalive may have sent
          // this deletion, or an earlier answer was lost.
          const response = await send("DELETE", { itemId, workspaceId })
          if (response.status !== 404) await readJson<{ ok: true }>(response)
          if (getUser()?.id !== currentUser.id) return
          forgetDeletedItem(currentUser.id, workspaceId, itemId)
          scheduleTaxonomyRefresh(currentUser.id)
          patchEntry(key, { itemId: null, baseTimeModified: null, savedSignature: null })
          const detachedRecord = detachedSaves.get(key)
          if (detachedRecord) {
            detachedSaves.set(key, {
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
      let response =
        itemId === null ? await create() : await update(itemId, liveEntry()?.baseTimeModified)
      // The stored item is newer than the one this entry began from. When it holds
      // what this entry last saved, or what this page itself sent as it was hidden,
      // nothing changed that the user did not write here, so the edit goes on from
      // that version. Otherwise the answer stays a conflict and the entry keeps its
      // draft.
      if (itemId !== null && response.status === 409) {
        const conflict = (await response
          .clone()
          .json()
          .catch(() => null)) as { item?: ItemRecord } | null
        const stored = conflict?.item
        const storedSignature = stored
          ? serializeItemDraft(stored.id, itemToFormState(stored))
          : null
        if (
          stored &&
          (storedSignature === liveEntry()?.savedSignature ||
            storedSignature === exitSentSignatures.get(key) ||
            storedSignature === serializeItemDraft(itemId, formSnapshot))
        ) {
          reconciledExitSave = storedSignature === exitSentSignatures.get(key)
          response = await update(itemId, stored.timeModified)
        } else {
          conflicting = stored ?? null
        }
      }
      // The item was deleted somewhere else while this entry was open. What the user
      // is writing is kept: it is created again under the entry's uid.
      if (!creating && response.status === 404) {
        // Not when the user deleted it here: the entry is about to close.
        if (itemId !== null && wasItemDeletedByUser(itemId)) return
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

      if (getUser()?.id !== currentUser.id) return

      mergeSavedItem(currentUser.id, data.item)
      scheduleTaxonomyRefresh(currentUser.id)

      landedSignature = serializeItemDraft(data.item.id, formSnapshot)
      patchEntry(key, {
        itemId: data.item.id,
        baseTimeModified: data.item.timeModified,
        savedSignature: landedSignature,
      })

      // Keep any detached record for this key in step. Without this, an entry
      // evicted mid-create keeps `itemId: null` and the next detached save or
      // exit keepalive POSTs a second copy of the same note.
      const pendingDetached = detachedSaves.get(key)
      if (pendingDetached) {
        detachedSaves.set(key, {
          ...pendingDetached,
          itemId: data.item.id,
          savedSignature: landedSignature,
        })
      }
    })()

    saveInFlight.set(key, savePromise)

    let persisted = false

    try {
      await savePromise
      persisted = true
      failedSignatures.delete(key)
      // The hide-time request is settled once a save went on from what it stored, or
      // stored the same thing. An earlier save finishing says nothing about it.
      if (reconciledExitSave || exitSentSignatures.get(key) === (landedSignature as string | null))
        exitSentSignatures.delete(key)
      // A view may be waiting to take this entry until its edits are stored.
      finishViewClaim(key)
      if (getUser()?.id === currentUser.id && !detached) {
        const live = getEntry(key)
        if (live) {
          patchEntry(key, {
            saveStatus: settledSaveStatus(live),
          })
        }
      }
    } catch (error) {
      if (getUser()?.id === currentUser.id) {
        if (error instanceof RequestError && error.status === 409 && itemId !== null) {
          persistOpenItems()
          setSaveConflictText((conflicting as ItemRecord | null)?.description ?? null)
          setSaveConflictUid(source.uid)
        } else {
          setErrorMessage(getErrorMessage(error))
        }
        if (!detached) {
          failedSignatures.set(key, draftSignature)
          patchEntry(key, { saveStatus: "error" })
        }
      }
    } finally {
      if (saveInFlight.get(key) === savePromise) {
        saveInFlight.delete(key)
      }
      // Drop the detached record only once its text is actually stored.
      // Keeping it on failure is what lets the exit keepalive and the
      // pre-sign-out flush still find the words that left the ring.
      if (persisted && detached) forgetDetachedSave(key, detached)
    }

    if (queuedAutosaveKeys.delete(key)) {
      const latest = getEntry(key)
      if (latest && canSaveEntry(latest) && isEntryDirty(latest)) {
        void saveEntry(key, "autosave")
      }
    }

    return persisted
  }

  /**
   * Persist every dirty entry that has a save to send and wait for all of them. Used
   * only where the session or the workspace is about to change, since ordinary note
   * switching does not block on a save. An entry with nothing to send, such as a
   * Notes draft holding only a tag, is skipped: it must never block the change.
   */
  async function flushAllPendingSaves() {
    const entries = collectSessionFlushEntries(getOpenItems(), isEntryDirty, canSaveEntry)
    // Detached work counts too: text that left the ring is exactly the text
    // nobody is looking at, so it is the easiest to lose in a session change.
    const detachedKeys = [...detachedSaves.keys()]

    const results = await Promise.allSettled([
      ...entries.map((entry) => saveEntry(entry.key, "flush")),
      ...detachedKeys.map((key) => saveEntry(key, "detached")),
      ...directWrites,
    ])

    // Reports failure rather than swallowing it. Callers are about to tear down
    // or replace the session, so proceeding past a failed save destroys the
    // draft it was carrying.
    return results.every((result) => result.status === "fulfilled" && result.value)
  }

  /**
   * The user chose their own version over the one stored since their edit began. The
   * entry forgets which version it started from, so its next save is not refused.
   */
  function keepEntryOverStoredItem(uid: string) {
    setSaveConflictUid(null)
    const entry = getOpenItems().find((item) => item.uid === uid)
    if (!entry) return
    patchEntry(entry.key, { baseTimeModified: null })
    void saveEntry(entry.key, "flush")
  }

  function syncSaveStatuses(openItems: OpenItemEntry[]) {
    for (const entry of openItems) {
      if (saveInFlight.has(entry.key)) continue
      // A save of this very draft failed; say so until the draft changes.
      if (
        entry.saveStatus === "error" &&
        failedSignatures.get(entry.key) === serializeItemDraft(entry.itemId, entry.form)
      )
        continue

      const next = settledSaveStatus(entry)

      if (entry.saveStatus !== next) patchEntry(entry.key, { saveStatus: next })
    }
  }

  const flushOnExit = () => {
    const currentUser = getUser()
    const workspaceId = getWorkspaceId()
    if (!currentUser || workspaceId === null) return

    persistOpenItems()
    if (isGroupDialogOpen()) return

    const pending = collectExitFlushItems(getOpenItems(), detachedSaves, isEntryDirty, canSaveEntry)
    const keepalive = selectKeepaliveExitItems(pending, exitKeepaliveKeys)

    for (const { key, itemId, uid, form } of keepalive) {
      exitKeepaliveKeys.add(key)

      // The same three outcomes as a save: a new item, an update, or the deletion of
      // an item whose content was removed.
      const removing = itemId !== null && !draftHoldsContent(form)
      if (itemId !== null && !removing)
        exitSentSignatures.set(key, serializeItemDraft(itemId, form))
      const requestBody =
        itemId === null
          ? { userId: currentUser.id, item: newItemRequestBody(form, workspaceId, uid) }
          : removing
            ? { userId: currentUser.id, itemId, workspaceId }
            : { userId: currentUser.id, itemId, item: itemRequestBody(form, workspaceId) }

      try {
        void fetch("/api/items", {
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

  return {
    saveEntry,
    detachRemovedEntries,
    flushAllPendingSaves,
    keepEntryOverStoredItem,
    syncSaveStatuses,
    flushOnExit,
  }
}

type ReopenDependencies = Pick<
  SaveDependencies,
  "detachedSaves" | "saveInFlight" | "queuedAutosaveKeys" | "patchEntry"
> & {
  openExistingItem: (item: ItemRecord) => OpenItemEntry[]
  detachRemovedEntries: (entries: OpenItemEntry[]) => void
  getStoredItem: (id: number) => ItemRecord | undefined
  saveEntry: (key: OpenItemKey, mode: ItemSaveMode) => Promise<boolean>
}

export function openItemWithDetachedSave(
  item: ItemRecord,
  {
    detachedSaves,
    saveInFlight,
    queuedAutosaveKeys,
    patchEntry,
    openExistingItem,
    detachRemovedEntries,
    getStoredItem,
    saveEntry,
  }: ReopenDependencies,
) {
  const key = itemEntryKey(item.id)
  // The record is kept under the key the entry had when it left the ring. An item
  // created in this session left as a draft, so it is found by its item, not by key.
  const detachedKey = [...detachedSaves].find(([, record]) => record.itemId === item.id)?.[0] ?? key
  const detached = detachedSaves.get(detachedKey)

  detachRemovedEntries(openExistingItem(item))

  if (!detached) return

  // Ownership returns to the ring: the reopened entry holds the text, so the record
  // is dropped and nothing sends the older copy again.
  detachedSaves.delete(detachedKey)
  if (detachedKey === key) {
    // A save still in flight is keyed the same way and writes its result back
    // into this entry.
    patchEntry(key, { form: detached.form, savedSignature: detached.savedSignature })
    return
  }

  // The entry is the item as last known here, holding the text that left the ring.
  // Its saves name that version, so a change made elsewhere is never written over.
  patchEntry(key, { form: detached.form })
  const inFlight = saveInFlight.get(detachedKey)
  if (!inFlight) return

  // The record's save is still landing under its old key. This entry's saves wait
  // for it and then go on from the version it stored.
  const settled: Promise<void> = inFlight
    .catch(() => undefined)
    .then(() => {
      const stored = getStoredItem(item.id)
      if (stored)
        patchEntry(key, {
          baseTimeModified: stored.timeModified,
          savedSignature: serializeItemDraft(stored.id, itemToFormState(stored)),
        })
      if (saveInFlight.get(key) === settled) saveInFlight.delete(key)
      if (queuedAutosaveKeys.delete(key)) void saveEntry(key, "autosave")
    })
  saveInFlight.set(key, settled)
}
