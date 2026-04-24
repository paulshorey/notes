"use client"

import { Button, Modal, Text } from "@gravity-ui/uikit"
import type { CategoryRecord } from "@lib/db-marketing"
import styles from "./DeleteCategoryModal.module.css"

interface DeleteCategoryModalProps {
  category: CategoryRecord | null
  onClose: () => void
  onConfirm: () => void
  pending: boolean
}

export function DeleteCategoryModal({
  category,
  onClose,
  onConfirm,
  pending,
}: DeleteCategoryModalProps) {
  const count = category?.noteCount ?? 0

  return (
    <Modal open={category !== null} onClose={onClose}>
      <div className={styles.modalBody}>
        <Text variant="subheader-2">Delete {category?.label ?? ""}?</Text>
        <Text variant="body-1" color="secondary">
          {count} {count === 1 ? "note uses" : "notes use"} it. Deleting the
          category will move those notes into your fallback category.
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
