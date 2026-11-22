"use client"

import { Button, Modal, Spin, Text } from "@gravity-ui/uikit"
import type {
  ItemRecord,
  ItemResponse,
  PurgeTrashResponse,
  TrashedItemRecord,
  TrashResponse,
} from "@lib/db-items/contracts/items-app"
import { useEffect, useState } from "react"
import { getErrorMessage, itemsFetch, readJson } from "@/lib/api"
import { itemHeadline } from "@/lib/strings"
import { trashedItemDetail } from "@/lib/trash"
import styles from "./TrashModal.module.css"

const send = (method: "POST" | "DELETE", body: Record<string, unknown>) =>
  itemsFetch("/api/items/trash", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })

/**
 * The user's deleted items. The list is loaded each time the dialog opens, and each
 * action is applied to it when the server confirms, so it never shows an entry that a
 * failed request left in place as gone.
 */
export function TrashModal({
  onClose,
  onRestored,
}: {
  onClose: () => void
  onRestored: (item: ItemRecord) => void
}) {
  const [trash, setTrash] = useState<TrashResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  // The entry an action is running on, or "all" while the trash is being emptied.
  const [pending, setPending] = useState<number | "all" | null>(null)
  const [confirmingEmpty, setConfirmingEmpty] = useState(false)

  useEffect(() => {
    let current = true
    void (async () => {
      try {
        const data = await readJson<TrashResponse>(
          await itemsFetch("/api/items/trash", { cache: "no-store" }),
        )
        if (current) setTrash(data)
      } catch (loadError) {
        if (current) setError(getErrorMessage(loadError))
      }
    })()
    return () => {
      current = false
    }
  }, [])

  const run = async (target: number | "all", action: () => Promise<void>) => {
    if (pending !== null) return
    setError(null)
    setPending(target)
    try {
      await action()
    } catch (actionError) {
      setError(getErrorMessage(actionError))
    } finally {
      setPending(null)
    }
  }

  const drop = (trashId: number) =>
    setTrash(
      (current) =>
        current && { ...current, items: current.items.filter((item) => item.id !== trashId) },
    )

  const restore = (entry: TrashedItemRecord) =>
    run(entry.id, async () => {
      const data = await readJson<ItemResponse>(await send("POST", { trashId: entry.id }))
      drop(entry.id)
      onRestored(data.item)
    })

  const purge = (entry: TrashedItemRecord) =>
    run(entry.id, async () => {
      await readJson<PurgeTrashResponse>(await send("DELETE", { trashId: entry.id }))
      drop(entry.id)
    })

  const empty = () =>
    run("all", async () => {
      await readJson<PurgeTrashResponse>(await send("DELETE", {}))
      setTrash((current) => current && { ...current, items: [] })
      setConfirmingEmpty(false)
    })

  const items = trash?.items ?? []

  return (
    <Modal open onClose={onClose} aria-label="Trash">
      <div className={styles.modalBody}>
        <Text variant="subheader-2">Trash</Text>
        {trash === null && error === null && <Spin size="s" />}
        {trash !== null && (
          <Text variant="body-1" color="secondary">
            {items.length === 0
              ? "The trash is empty."
              : `Deleted items stay here for ${trash.retentionDays} days.`}
          </Text>
        )}
        <div className={styles.list} role="list" aria-label="Deleted items">
          {items.map((entry) => (
            <div key={entry.id} className={styles.entry} role="listitem">
              <div className={styles.entryText}>
                <Text className={styles.entryTitle}>{itemHeadline(entry.description)}</Text>
                <Text variant="caption-1" color="secondary" className={styles.entryTitle}>
                  {trashedItemDetail(entry)}
                </Text>
              </div>
              <Button
                view="flat"
                size="s"
                loading={pending === entry.id}
                disabled={pending !== null}
                onClick={() => void restore(entry)}
              >
                Restore
              </Button>
              <Button
                view="flat-danger"
                size="s"
                disabled={pending !== null}
                onClick={() => void purge(entry)}
                aria-label={`Delete forever: ${itemHeadline(entry.description)}`}
              >
                Delete forever
              </Button>
            </div>
          ))}
        </div>
        {error && (
          <Text color="danger" role="alert">
            {error}
          </Text>
        )}
        <div className={styles.modalActions}>
          {confirmingEmpty ? (
            <span>
              <Button
                view="outlined-danger"
                size="m"
                loading={pending === "all"}
                onClick={() => void empty()}
              >
                Delete {items.length} forever
              </Button>{" "}
              <Button view="flat" size="m" onClick={() => setConfirmingEmpty(false)}>
                Keep them
              </Button>
            </span>
          ) : (
            <Button
              view="flat-danger"
              size="m"
              disabled={items.length === 0 || pending !== null}
              onClick={() => setConfirmingEmpty(true)}
            >
              Empty trash…
            </Button>
          )}
          <Button view="flat" size="m" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </Modal>
  )
}
