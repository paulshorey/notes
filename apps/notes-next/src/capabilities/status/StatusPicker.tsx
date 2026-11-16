"use client"

import type { StatusRecord } from "@lib/db-items"
import { Kanban } from "@phosphor-icons/react"
import { FilterablePicker } from "@/components/ui/FilterablePicker"
import type { StatusDraft } from "./draft"

interface StatusPickerProps {
  draft: StatusDraft
  statuses: StatusRecord[]
  /** True while a new status is being created. */
  pending: boolean
  /** A row of a menu, or a control that stands in a toolbar. */
  variant: "menu" | "inline"
  /** A menu row is opened by its menu; a toolbar control opens itself. */
  open?: boolean
  onOpenChange?: (open: boolean) => void
  disabled?: boolean
  /** Receives the chosen status id as a string, or "" for no status. */
  onSelectStatusId: (rawId: string) => void
  onCreateStatus: (label: string) => void | Promise<void>
}

/** Shows an item's status and opens the list to change it. */
export function StatusPicker({
  draft,
  statuses,
  pending,
  variant,
  open,
  onOpenChange,
  disabled = false,
  onSelectStatusId,
  onCreateStatus,
}: StatusPickerProps) {
  const selectedLabel =
    statuses.find((status) => status.id === draft.selectedStatusId)?.label ?? "No status"

  const menu = variant === "menu"

  return (
    <FilterablePicker
      variant={variant}
      triggerLabel={menu ? "Status" : undefined}
      triggerRole={menu ? "menuitem" : undefined}
      triggerIcon={menu ? undefined : <Kanban size={16} weight="regular" aria-hidden />}
      value={selectedLabel}
      triggerAriaLabel="Status"
      listboxAriaLabel="Status options"
      options={[{ id: "", label: "No status" }, ...statuses]}
      selectedIds={[draft.selectedStatusId ?? ""]}
      disabled={disabled}
      pending={pending}
      open={open}
      onOpenChange={onOpenChange}
      placement={menu ? ["left-start", "right-start", "top-start", "bottom-start"] : undefined}
      onSelectOption={(status) => onSelectStatusId(String(status.id))}
      onCreateOption={onCreateStatus}
      emptyWithoutQueryMessage="No statuses yet"
      inputPlaceholder="Enter new status..."
    />
  )
}
