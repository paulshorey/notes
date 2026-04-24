"use client"

import { Button, Modal, Text, TextInput } from "@gravity-ui/uikit"
import type { TagRecord } from "@lib/db-marketing"
import { toLowercaseInput } from "@/lib/strings"
import styles from "../NotesApp.module.css"

interface EditTagModalProps {
  tag: TagRecord | null
  label: string
  onLabelChange: (value: string) => void
  onClose: () => void
  onSave: () => void
  pending: boolean
}

export function EditTagModal({
  tag,
  label,
  onLabelChange,
  onClose,
  onSave,
  pending,
}: EditTagModalProps) {
  return (
    <Modal open={tag !== null} onClose={onClose}>
      <div className={styles.modalBody}>
        <Text variant="subheader-2">Edit tag</Text>
        <TextInput
          size="m"
          value={label}
          onUpdate={(value) => onLabelChange(toLowercaseInput(value))}
          placeholder="Tag name"
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
            disabled={label.trim() === "" || label.trim() === tag?.label}
            onClick={onSave}
          >
            Save
          </Button>
        </div>
      </div>
    </Modal>
  )
}
