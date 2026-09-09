"use client"

import { Button, Modal, Text } from "@gravity-ui/uikit"
import type { CategoryRecord } from "@lib/db-notes"
import styles from "./DeleteCategoryModal.module.css"

interface DeleteCategoryModalProps {
  category: CategoryRecord | null
  onClose: () => void
  onDelete: () => void
  pending: boolean
}

export function DeleteCategoryModal({
  category,
  onClose,
  onDelete,
  pending,
}: DeleteCategoryModalProps) {
  const count = category?.noteCount ?? 0

  return (
    <Modal open={category !== null} onClose={pending ? () => {} : onClose}>
      <div className={styles.modalBody}>
        <Text variant="subheader-2">Delete {category?.label ?? ""}?</Text>
        <Text variant="body-1" color="secondary">
          {count === 0
            ? "This category has no notes."
            : `${count} ${count === 1 ? "note uses" : "notes use"} this category. The notes will be kept.`}
        </Text>
        <div className={styles.modalActions}>
          <Button view="action" size="m" width="max" loading={pending} onClick={onDelete}>
            Delete category
          </Button>
          <Button view="flat" size="m" width="max" disabled={pending} onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </Modal>
  )
}
