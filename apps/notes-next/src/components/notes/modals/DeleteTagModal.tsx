"use client"

import { Button, Modal, Text } from "@gravity-ui/uikit"
import type { TagRecord } from "@lib/db-marketing"
import styles from "./DeleteTagModal.module.css"

interface DeleteTagModalProps {
  tag: TagRecord | null
  onClose: () => void
  onConfirm: () => void
  pending: boolean
}

export function DeleteTagModal({
  tag,
  onClose,
  onConfirm,
  pending,
}: DeleteTagModalProps) {
  const count = tag?.noteCount ?? 0

  return (
    <Modal open={tag !== null} onClose={onClose}>
      <div className={styles.modalBody}>
        <Text variant="subheader-2">Delete {tag?.label ?? ""}?</Text>
        <Text variant="body-1" color="secondary">
          {count} {count === 1 ? "note uses" : "notes use"} it. Deleting the tag
          removes this tag relation from every note.
        </Text>
        <div className={styles.modalActions}>
          <Button view="flat" size="m" onClick={onClose}>
            Cancel
          </Button>
          <Button view="action" size="m" loading={pending} onClick={onConfirm}>
            Confirm
          </Button>
        </div>
      </div>
    </Modal>
  )
}
