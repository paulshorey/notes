"use client"

import { Button, Modal, Text, TextInput } from "@gravity-ui/uikit"
import type { WorkflowStatusRecord } from "@lib/db-marketing"
import { toLowercaseInput } from "@/lib/strings"
import styles from "./EditWorkflowStatusModal.module.css"

interface EditWorkflowStatusModalProps {
  workflowStatus: WorkflowStatusRecord | null
  label: string
  onLabelChange: (value: string) => void
  onClose: () => void
  onSave: () => void
  pending: boolean
}

export function EditWorkflowStatusModal({
  workflowStatus,
  label,
  onLabelChange,
  onClose,
  onSave,
  pending,
}: EditWorkflowStatusModalProps) {
  return (
    <Modal open={workflowStatus !== null} onClose={onClose}>
      <div className={styles.modalBody}>
        <Text variant="subheader-2">Edit board column</Text>
        <TextInput
          size="m"
          value={label}
          onUpdate={(value) => onLabelChange(toLowercaseInput(value))}
          placeholder="Column name"
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
            disabled={label.trim() === "" || label.trim() === workflowStatus?.label}
            onClick={onSave}
          >
            Save
          </Button>
        </div>
      </div>
    </Modal>
  )
}
