import type { ItemRecord } from "@lib/db-items"
import { draftHoldsContent } from "@/capabilities/draftParts"
import { getErrorMessage, readJson, RequestError } from "@/lib/api"
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
  unconfirmedSignatures: Map<string, string>
  failedSignatures: Map<OpenItemKey, string>
  patchEntry: PatchEntry
  persistOpenItems: () => void
  finishViewClaim: (key: OpenItemKey) => void
  mergeSavedItem: (userId: number, item: ItemRecord) => void
  forgetDeletedItem: (userId: number, workspaceId: number, itemId: number) => void
  scheduleTaxonomyRefresh: (userId: number) => void
  setErrorMessage: (message: string) => void
  setSaveConflictItem: (item: ItemRecord | null) => void
  setStatusMessage: (message: string) => void
}

const ITEM_SAVE_TIMEOUT_MS = 30_000

function settledSaveStatus(entry: OpenItemEntry) {
  if (entry.itemId === null && !canSaveEntry(entry)) return "idle"
  return isEntryDirty(entry) ? "unsaved" : "saved"
}

class SaveConflict extends Error {
  constructor(readonly item: ItemRecord) {
    super("The saved item changed since this edit began.")
  }
}

async function readWriteResult<T>(response: Response): Promise<T> {
  if (response.status === 409) {
    const conflict = await response
      .clone()
      .json()
      .catch(() => null)
    if (conflict?.code === "item_changed" && conflict.item) throw new SaveConflict(conflict.item)
  }
  return readJson<T>(response)
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
  unconfirmedSignatures,
  failedSignatures,
  patchEntry,
  persistOpenItems,
  finishViewClaim,
  mergeSavedItem,
  forgetDeletedItem,
  scheduleTaxonomyRefresh,
  setErrorMessage,
  setSaveConflictItem,
  setStatusMessage,
}: SaveDependencies) {
  const getEntry = (key: OpenItemKey) => getOpenItems().find((entry) => entry.key === key)

  function detachRemovedEntries(removed: OpenItemEntry[]) {
    let captured = false
    for (const entry of removed) {
      // An earlier request may still replace what currently looks clean, or create
      // the item after the user has cleared the draft.
      if (!saveInFlight.has(entry.key) && !(isEntryDirty(entry) && canSaveEntry(entry))) continue
      captured = true

      detachedSaves.set(entry.key, {
        itemId: entry.itemId,
        form: snapshotTextCaptureForm(entry.form),
        savedSignature: entry.savedSignature,
        baseTimeModified: entry.baseTimeModified,
        view: entry.view,
        uid: entry.uid,
      })
      void saveEntry(entry.key, "detached")
    }
    if (captured) {
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

    const pending = saveInFlight.get(key)
    if (pending) {
      if (mode === "autosave") {
        queuedAutosaveKeys.add(key)
        return true
      }
      await pending.catch(() => undefined)
      if (getUser()?.id !== currentUser.id || getWorkspaceId() !== workspaceId) return false
      // Another waiter may already be sending newer text. Read the slot and its
      // address again only when the preceding request has finished.
      return saveEntry(key, mode)
    }

    const detached = detachedSaves.get(key)
    const source = detached ?? getEntry(key)
    if (!source) return true
    const formSnapshot = snapshotTextCaptureForm(source.form)
    const itemId = source.itemId
    const draftSignature = serializeItemDraft(itemId, formSnapshot)
    const action = entrySaveAction({ view: source.view, form: formSnapshot, itemId })
    if (draftSignature === source.savedSignature || action === null) {
      if (detached) forgetDetachedSave(key, detached)
      return draftSignature === source.savedSignature || mode !== "autosave"
    }

    if (!detached) patchEntry(key, { saveStatus: "saving" })

    // A detached request can finish after the draft reopened under its item key.
    // Apply only the server acknowledgment to the entry that now owns this uid.
    const uid = source.uid
    function acknowledge(
      baseline: Pick<OpenItemEntry, "itemId" | "savedSignature" | "baseTimeModified">,
    ) {
      const live = getOpenItems().find((entry) => entry.uid === uid)
      if (live) patchEntry(live.key, baseline)
      for (const [pendingKey, record] of detachedSaves) {
        if (record.uid === uid) detachedSaves.set(pendingKey, { ...record, ...baseline })
      }
    }
    const sentSignature = unconfirmedSignatures.get(source.uid)
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
      let acknowledgedForm = formSnapshot
      const writeExisting = async (id: number, version: string) => {
        const response =
          action === "delete"
            ? await send("DELETE", { itemId: id, workspaceId, expectedTimeModified: version })
            : await send("PATCH", {
                itemId: id,
                item: itemRequestBody(formSnapshot, workspaceId),
                expectedTimeModified: version,
              })
        if (response.status === 404) return null
        if (action === "delete") {
          await readWriteResult<{ ok: true }>(response)
          return null
        }
        return (await readWriteResult<{ item: ItemRecord }>(response)).item
      }

      const matchesBaseline = (stored: ItemRecord) => {
        const signature = serializeItemDraft(stored.id, itemToFormState(stored))
        return (
          signature === source.savedSignature ||
          (signature === sentSignature && signature === unconfirmedSignatures.get(uid)) ||
          signature === draftSignature
        )
      }

      const updateOrDelete = async (id: number) => {
        let version = source.baseTimeModified
        if (!version) {
          // A dirty draft from an older browser snapshot may have only its saved
          // signature. Recover its version only if the content still matches.
          const response = await fetch(
            `/api/items?userId=${currentUser.id}&workspaceId=${workspaceId}`,
            {
              signal: timeoutSignal(ITEM_SAVE_TIMEOUT_MS),
              cache: "no-store",
            },
          )
          const { items } = await readJson<{ items: ItemRecord[] }>(response)
          const stored = items.find((item) => item.id === id)
          if (!stored) return null
          if (!matchesBaseline(stored)) throw new SaveConflict(stored)
          version = stored.timeModified
        }
        try {
          return await writeExisting(id, version)
        } catch (error) {
          if (!(error instanceof SaveConflict)) throw error
          const storedForm = itemToFormState(error.item)
          const signature = serializeItemDraft(id, storedForm)
          if (signature === unconfirmedSignatures.get(uid) && signature !== sentSignature) {
            // A later hide-time write beat this request. Adopt that acknowledgment
            // and leave any subsequent keystrokes dirty for their own save.
            acknowledgedForm = storedForm
            return error.item
          }
          if (!matchesBaseline(error.item)) throw error
          return writeExisting(id, error.item.timeModified)
        }
      }

      let stored = itemId === null ? null : await updateOrDelete(itemId)
      if (action !== "delete" && !stored) {
        if (itemId !== null && wasItemDeletedByUser(itemId)) return
        const createSignature = serializeItemDraft(null, formSnapshot)
        const createResponse = await send("POST", {
          item: newItemRequestBody(formSnapshot, workspaceId, uid),
        })
        stored = (await readWriteResult<{ item: ItemRecord }>(createResponse)).item
        if (createResponse.status === 200) {
          const existing = serializeItemDraft(null, itemToFormState(stored))
          if (existing === unconfirmedSignatures.get(uid) && existing !== sentSignature) {
            acknowledgedForm = itemToFormState(stored)
          } else if (existing !== createSignature) {
            if (existing !== sentSignature || existing !== unconfirmedSignatures.get(uid))
              throw new SaveConflict(stored)
            stored = await writeExisting(stored.id, stored.timeModified)
            if (!stored) throw new Error("The item was removed during the save. Try again.")
          }
        }
      }

      if (getUser()?.id !== currentUser.id || getWorkspaceId() !== workspaceId) return
      if (stored) {
        mergeSavedItem(currentUser.id, stored)
        acknowledge({
          itemId: stored.id,
          baseTimeModified: stored.timeModified,
          savedSignature: serializeItemDraft(stored.id, acknowledgedForm),
        })
      } else if (itemId !== null) {
        forgetDeletedItem(currentUser.id, workspaceId, itemId)
        acknowledge({ itemId: null, baseTimeModified: null, savedSignature: null })
        setStatusMessage("The empty note was removed.")
      }
      scheduleTaxonomyRefresh(currentUser.id)
      // Only discharge evidence observed by this save. A page hide while it
      // was in flight can have sent a later draft.
      const unconfirmed = unconfirmedSignatures.get(uid)
      if (
        unconfirmed === sentSignature ||
        unconfirmed === serializeItemDraft(itemId, acknowledgedForm)
      )
        unconfirmedSignatures.delete(uid)
    })()

    saveInFlight.set(key, savePromise)

    let persisted = false

    try {
      await savePromise
      persisted = true
      failedSignatures.delete(key)
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
      if (getUser()?.id === currentUser.id && getWorkspaceId() === workspaceId) {
        if (
          !(error instanceof SaveConflict) &&
          (!(error instanceof RequestError) || error.status >= 500)
        ) {
          // The server may have committed before the reply was lost. If the user
          // already reverted, its apparently clean draft still needs reconciliation.
          if (unconfirmedSignatures.get(uid) === sentSignature)
            unconfirmedSignatures.set(uid, draftSignature)
          const current =
            detachedSaves.get(key) ?? getOpenItems().find((entry) => entry.uid === uid)
          if (
            current &&
            current.itemId === itemId &&
            current.savedSignature === serializeItemDraft(itemId, current.form) &&
            current.savedSignature !== draftSignature
          ) {
            acknowledge({
              itemId,
              baseTimeModified: current.baseTimeModified,
              savedSignature: draftSignature,
            })
            persistOpenItems()
          }
        }
        if (error instanceof SaveConflict) {
          persistOpenItems()
          setSaveConflictItem(error.item)
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
    const userId = getUser()?.id
    const workspaceId = getWorkspaceId()
    while (getUser()?.id === userId && getWorkspaceId() === workspaceId) {
      const entries = collectSessionFlushEntries(getOpenItems(), isEntryDirty, canSaveEntry)
      const keys = new Set([...saveInFlight.keys(), ...detachedSaves.keys()])
      for (const entry of entries) {
        if (entry.itemId === null || !wasItemDeletedByUser(entry.itemId)) keys.add(entry.key)
      }
      if (!keys.size && !directWrites.size) return true
      const results = await Promise.allSettled([
        ...Array.from(keys, (key) => saveEntry(key, "flush")),
        ...directWrites,
      ])
      if (results.some((result) => result.status === "rejected" || !result.value)) return false
      // The user could still type or undo while the flush waited for its replies.
    }
    return false
  }

  function keepEntryOverStoredItem(stored: ItemRecord) {
    setSaveConflictItem(null)
    const baseline = {
      itemId: stored.id,
      baseTimeModified: stored.timeModified,
      savedSignature: serializeItemDraft(stored.id, itemToFormState(stored)),
    }
    const entry = getOpenItems().find((item) => item.uid === stored.uid)
    if (entry) {
      patchEntry(entry.key, baseline)
      return saveEntry(entry.key, "flush")
    }
    for (const [key, record] of detachedSaves) {
      if (record.uid !== stored.uid) continue
      detachedSaves.set(key, { ...record, ...baseline })
      return saveEntry(key, "flush")
    }
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

    for (const { key, itemId, uid, form, baseTimeModified } of keepalive) {
      // A legacy snapshot must reconcile in the foreground before it can write.
      if (itemId !== null && !baseTimeModified) continue
      exitKeepaliveKeys.add(key)

      // The same three outcomes as a save: a new item, an update, or the deletion of
      // an item whose content was removed.
      const removing = itemId !== null && !draftHoldsContent(form)
      const signature = serializeItemDraft(itemId, form)
      if (!removing) unconfirmedSignatures.set(uid, signature)
      const requestBody =
        itemId === null
          ? { userId: currentUser.id, item: newItemRequestBody(form, workspaceId, uid) }
          : removing
            ? {
                userId: currentUser.id,
                itemId,
                workspaceId,
                expectedTimeModified: baseTimeModified,
              }
            : {
                userId: currentUser.id,
                itemId,
                item: itemRequestBody(form, workspaceId),
                expectedTimeModified: baseTimeModified,
              }

      try {
        void fetch("/api/items", {
          method: itemId === null ? "POST" : removing ? "DELETE" : "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestBody),
          keepalive: true,
        })
          .then((response) => {
            if (
              response.status >= 400 &&
              response.status < 500 &&
              unconfirmedSignatures.get(uid) === signature
            )
              unconfirmedSignatures.delete(uid)
          })
          .catch(() => undefined)
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
  patchEntry(key, {
    form: detached.form,
    savedSignature: detached.savedSignature,
    baseTimeModified: detached.baseTimeModified,
  })
  if (detachedKey === key) return
  const inFlight = saveInFlight.get(detachedKey)
  if (!inFlight) return

  // The record's save is still landing under its old key. This entry's saves wait
  // for it and then go on from the version it stored.
  const settled: Promise<void> = inFlight
    .catch(() => undefined)
    .then(() => {
      if (saveInFlight.get(key) === settled) saveInFlight.delete(key)
      if (queuedAutosaveKeys.delete(key)) void saveEntry(key, "autosave")
    })
  saveInFlight.set(key, settled)
}
