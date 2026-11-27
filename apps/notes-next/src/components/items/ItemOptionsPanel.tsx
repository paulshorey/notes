"use client"

import { useState, type RefObject } from "react"
import { Tag } from "@phosphor-icons/react"
import { StatusPicker } from "@/capabilities/status/StatusPicker"
import { ScheduleField } from "@/capabilities/schedule/ScheduleField"
import type { ScheduleDraft } from "@/capabilities/schedule/draft"
import type { DraftControlProps } from "@/capabilities/types"
import { FilterablePicker, type FilterablePickerProps } from "@/components/ui/FilterablePicker"
import { useItemsWorkspace } from "@/workspace/ItemsWorkspaceProvider"
import { useItemsAppStore } from "@/stores/itemsAppStore"
import type { TextCaptureFormState } from "@/types/items"
import type { useItemPickers } from "./useItemPickers"
import styles from "./TextCaptureForm.module.css"

const MENU_PICKER_PLACEMENT: FilterablePickerProps["placement"] = [
  "left-start",
  "right-start",
  "top-start",
  "bottom-start",
]

type MorePicker = "status" | "tag" | "category" | "subcategory"

interface ItemOptionsPanelProps {
  itemId: number | null
  anchorRef: RefObject<HTMLElement | null>
  onClose: () => void
  form: TextCaptureFormState
  pickers: ReturnType<typeof useItemPickers>
  onScheduleChange: DraftControlProps<ScheduleDraft>["onChange"]
  onSelectStatusId: (rawId: string) => void
  onCreateStatus: (label: string) => void | Promise<void>
}

export function ItemOptionsPanel({
  itemId,
  anchorRef,
  onClose,
  form,
  pickers,
  onScheduleChange,
  onSelectStatusId,
  onCreateStatus,
}: ItemOptionsPanelProps) {
  const {
    statuses,
    createStatusPending,
    handleDeleteItem,
    deletingItemId,
    workspaces,
    activeWorkspaceId,
  } = useItemsWorkspace()
  const workspaceLabel = workspaces.find((workspace) => workspace.id === activeWorkspaceId)?.label
  const {
    categoryPicker,
    subcategoryPicker,
    tagPicker,
    selectedCategoryLabel,
    selectedSubcategoryLabel,
    selectedTagLabels,
  } = pickers
  const [activeMorePicker, setActiveMorePicker] = useState<MorePicker | null>(null)
  const updateMorePicker = (picker: MorePicker, open: boolean) => {
    setActiveMorePicker((current) => (open ? picker : current === picker ? null : current))
  }

  return (
    <div className={styles.morePanel}>
      <button
        type="button"
        role="menuitem"
        className={styles.moreMenuItem}
        disabled={itemId === null}
        aria-label="Move to workspace"
        onClick={() => {
          if (itemId === null) return
          onClose()
          useItemsAppStore.getState().openWorkspaceMovePicker({ kind: "item", itemId }, anchorRef)
        }}
      >
        <span>Workspace</span>
        <span className={styles.workspaceValue}>{workspaceLabel}</span>
      </button>

      <StatusPicker
        variant="menu"
        draft={form}
        statuses={statuses}
        pending={createStatusPending}
        open={activeMorePicker === "status"}
        onOpenChange={(open) => updateMorePicker("status", open)}
        onSelectStatusId={onSelectStatusId}
        onCreateStatus={onCreateStatus}
      />
      <FilterablePicker
        {...categoryPicker}
        variant="menu"
        triggerLabel="Category"
        triggerAriaLabel="Category"
        triggerRole="menuitem"
        value={selectedCategoryLabel}
        open={activeMorePicker === "category"}
        onOpenChange={(open) => updateMorePicker("category", open)}
        placement={MENU_PICKER_PLACEMENT}
      />
      <FilterablePicker
        {...subcategoryPicker}
        variant="menu"
        triggerLabel="Subcategory"
        triggerRole="menuitem"
        value={selectedSubcategoryLabel}
        open={activeMorePicker === "subcategory"}
        onOpenChange={(open) => updateMorePicker("subcategory", open)}
        placement={MENU_PICKER_PLACEMENT}
      />
      <FilterablePicker
        {...tagPicker}
        variant="menu"
        triggerLabel="Tag"
        triggerAriaLabel="Tag"
        triggerRole="menuitem"
        value={selectedTagLabels.join(", ")}
        triggerIcon={<Tag size={14} weight="regular" className={styles.propertyPickerIcon} />}
        open={activeMorePicker === "tag"}
        onOpenChange={(open) => updateMorePicker("tag", open)}
        placement={MENU_PICKER_PLACEMENT}
      />

      {(["due", "remind"] as const).map((field) => (
        <ScheduleField key={field} field={field} draft={form} onChange={onScheduleChange} />
      ))}
      <button
        type="button"
        role="menuitem"
        className={`${styles.moreMenuItem} ${styles.moreMenuDeleteItem}`}
        disabled={itemId === null || deletingItemId === itemId}
        onClick={() => {
          if (itemId === null) return
          onClose()
          void handleDeleteItem(itemId)
        }}
      >
        Delete
      </button>
    </div>
  )
}
