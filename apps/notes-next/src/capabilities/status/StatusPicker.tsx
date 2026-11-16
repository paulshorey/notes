"use client"

import type { StatusRecord } from "@lib/db-items"
import { FilterablePicker } from "@/components/ui/FilterablePicker"
import type { StatusDraft } from "./draft"

interface StatusPickerProps {
  draft: StatusDraft
  statuses: StatusRecord[]
  /** True while a new status is being created. */
  pending: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Receives the chosen status id as a string, or "" for no status. */
  onSelectStatusId: (rawId: string) => void
  onCreateStatus: (label: string) => void | Promise<void>
}

/** The menu row that shows an item's status and opens the list to change it. */
export function StatusPicker({
  draft,
  statuses,
  pending,
  open,
  onOpenChange,
  onSelectStatusId,
  onCreateStatus,
}: StatusPickerProps) {
  const selectedLabel =
    statuses.find((status) => status.id === draft.selectedStatusId)?.label ?? "No status"

  return (
    <FilterablePicker
      variant="menu"
      triggerLabel="Status"
      triggerRole="menuitem"
      value={selectedLabel}
      triggerAriaLabel="Status"
      listboxAriaLabel="Status options"
      options={[{ id: "", label: "No status" }, ...statuses]}
      selectedIds={[draft.selectedStatusId ?? ""]}
      pending={pending}
      open={open}
      onOpenChange={onOpenChange}
      placement={["left-start", "right-start", "top-start", "bottom-start"]}
      onSelectOption={(status) => onSelectStatusId(String(status.id))}
      onCreateOption={onCreateStatus}
      emptyWithoutQueryMessage="No statuses yet"
      inputPlaceholder="Enter new status..."
    />
  )
}
