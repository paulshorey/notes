"use client"

import { Button, Modal, Text } from "@gravity-ui/uikit"
import type { ItemRecord, WorkspaceRecord } from "@lib/db-items/contracts/items-app"
import { itemKinds } from "@lib/db-items/contracts/item-kinds"
import { itemHeadline } from "@/lib/strings"
import styles from "./TrashModal.module.css"

/** What an item is and where it is filed, for the line under its title. */
const itemDetail = (item: ItemRecord) =>
  [
    itemKinds(item).join(", "),
    [item.category?.label, item.subcategory?.label].filter(Boolean).join(" / "),
    item.status?.label,
    item.tags.map((tag) => tag.label).join(", "),
  ]
    .filter(Boolean)
    .join(" · ")

/**
 * Everything a workspace holds, shown before the workspace is deleted. A workspace with
 * no items is deleted without this dialog.
 */
export function DeleteWorkspaceModal({
  workspace,
  items,
  retentionDays,
  pending,
  error,
  onClose,
  onConfirm,
}: {
  workspace: WorkspaceRecord
  items: ItemRecord[]
  retentionDays: number
  pending: boolean
  error: string | null
  onClose: () => void
  onConfirm: () => void
}) {
  const count = `${items.length} ${items.length === 1 ? "item" : "items"}`
  return (
    <Modal open onClose={pending ? undefined : onClose} aria-label="Delete workspace">
      <div className={styles.modalBody}>
        <Text variant="subheader-2">Delete “{workspace.label}”?</Text>
        <Text variant="body-1" color="secondary">
          This workspace holds {count}. Deleting it moves them to the trash, where they stay for{" "}
          {retentionDays} days, and removes its categories, statuses, and tags.
        </Text>
        <div className={styles.list} role="list" aria-label="Items in this workspace">
          {items.map((item) => (
            <div key={item.id} className={styles.entry} role="listitem">
              <div className={styles.entryText}>
                <Text className={styles.entryTitle}>{itemHeadline(item.description)}</Text>
                <Text variant="caption-1" color="secondary" className={styles.entryTitle}>
                  {itemDetail(item)}
                </Text>
              </div>
            </div>
          ))}
        </div>
        {error && (
          <Text color="danger" role="alert">
            {error}
          </Text>
        )}
        <div className={styles.modalActions}>
          <Button view="outlined-danger" size="m" loading={pending} onClick={onConfirm}>
            Delete workspace and {count}
          </Button>
          <Button view="flat" size="m" disabled={pending} onClick={onClose}>
            Keep it
          </Button>
        </div>
      </div>
    </Modal>
  )
}
