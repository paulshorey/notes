"use client"

import { Button, Modal, Text } from "@gravity-ui/uikit"
import type { CategoryRecord } from "@lib/db-marketing"
import styles from "./DeleteCategoryModal.module.css"

export type DeleteCategoryAction = "delete-notes" | "keep-uncategorized"

interface DeleteCategoryModalProps {
  category: CategoryRecord | null
  onClose: () => void
  onDeleteWithNotes: () => void
  onKeepUncategorized: () => void
  pendingAction: DeleteCategoryAction | null
}

export function DeleteCategoryModal({
  category,
  onClose,
  onDeleteWithNotes,
  onKeepUncategorized,
  pendingAction,
}: DeleteCategoryModalProps) {
  const count = category?.noteCount ?? 0
  const pending = pendingAction !== null

  return (
    <Modal open={category !== null} onClose={pending ? () => {} : onClose}>
      <div className={styles.modalBody}>
        <Text variant="subheader-2">Delete {category?.label ?? ""}?</Text>
        <Text variant="body-1" color="secondary">
          {count === 0
            ? "This category has no notes."
            : `${count} ${count === 1 ? "note uses" : "notes use"} this category. Choose what to do with them.`}
        </Text>
        <div className={styles.modalActions}>
          <Button
            view="action"
            size="m"
            width="max"
            loading={pendingAction === "delete-notes"}
            disabled={pending && pendingAction !== "delete-notes"}
            onClick={onDeleteWithNotes}
          >
            Delete category including all notes
          </Button>
          <Button
            view="outlined"
            size="m"
            width="max"
            loading={pendingAction === "keep-uncategorized"}
            disabled={pending && pendingAction !== "keep-uncategorized"}
            onClick={onKeepUncategorized}
          >
            Delete category, keep items as uncategorized
          </Button>
          <Button
            view="flat"
            size="m"
            width="max"
            disabled={pending}
            onClick={onClose}
          >
            Cancel
          </Button>
        </div>
      </div>
    </Modal>
  )
}
