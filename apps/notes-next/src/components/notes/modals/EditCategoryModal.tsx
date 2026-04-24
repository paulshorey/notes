"use client"

import { Button, Modal, Text, TextInput } from "@gravity-ui/uikit"
import type { CategoryRecord } from "@lib/db-marketing"
import { toLowercaseInput } from "@/lib/strings"
import styles from "../NotesApp.module.css"

interface EditCategoryModalProps {
  category: CategoryRecord | null
  label: string
  onLabelChange: (value: string) => void
  onClose: () => void
  onSave: () => void
  pending: boolean
}

export function EditCategoryModal({
  category,
  label,
  onLabelChange,
  onClose,
  onSave,
  pending,
}: EditCategoryModalProps) {
  return (
    <Modal open={category !== null} onClose={onClose}>
      <div className={styles.modalBody}>
        <Text variant="subheader-2">Edit category</Text>
        <TextInput
          size="m"
          value={label}
          onUpdate={(value) => onLabelChange(toLowercaseInput(value))}
          placeholder="Category name"
          autoFocus
        />
        <div className={styles.modalActions}>
          <Button view="flat" size="m" onClick={onClose}>
            Cancel
          </Button>
          <Button
            view="action"
            size="m"
            loading={pending}
            disabled={label.trim() === "" || label.trim() === category?.label}
            onClick={onSave}
          >
            Save
          </Button>
        </div>
      </div>
    </Modal>
  )
}
