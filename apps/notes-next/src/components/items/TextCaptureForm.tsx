"use client"

import dynamic from "next/dynamic"
import { Button, Popup } from "@gravity-ui/uikit"
import { FilterablePicker } from "@/components/ui/FilterablePicker"
import { CalendarBlank, DotsThree, FolderOpen, Plus, Tag, X } from "@phosphor-icons/react"
import { type Dispatch, type SetStateAction, useMemo, useRef, useState } from "react"
import { getCategoryNameError } from "@lib/db-items/contracts/category-name"
import type { CategoryRecord, StatusRecord, TagRecord } from "@lib/db-items"
import type { TextCaptureFormState } from "@/types/items"
import { normalizeLabel } from "@/lib/strings"
import { createDefaultDueValue, createDefaultRemindValue } from "@/types/items"
import type { AtomicEditorProps } from "@/components/editor/AtomicEditor"
import styles from "./TextCaptureForm.module.css"

const AtomicEditor = dynamic<AtomicEditorProps>(
  () => import("@/components/editor/AtomicEditor").then((mod) => mod.AtomicEditor),
  {
    ssr: false,
  },
)

interface TextCaptureFormProps {
  form: TextCaptureFormState
  setForm: Dispatch<SetStateAction<TextCaptureFormState>>
  editingItemId: number | null
  userPresent: boolean
  pasteUrlAsMarkdown?: boolean
  categories: CategoryRecord[]
  statuses: StatusRecord[]
  tags: TagRecord[]
  pendingTagLabels: string[]
  descriptionEditorSessionId: string | number
  editorAutofocus: boolean
  editorRevealText?: string | null
  createCategoryPending: boolean
  createStatusPending: boolean
  createTagPending: boolean
  onSelectCategoryId: (rawId: string) => void
  onSelectStatusId: (rawId: string) => void
  onCreateCategory: (label: string) => void | Promise<void>
  onCreateStatus: (label: string) => void | Promise<void>
  onTagValuesChange: (values: string[]) => void
  onCancelEdit: () => void
  onDeleteEditingItem: () => void
  onAddItem: () => void
  onAddItemInCategory: () => void
}

export function TextCaptureForm({
  form,
  setForm,
  editingItemId,
  userPresent,
  pasteUrlAsMarkdown = false,
  categories,
  statuses,
  tags,
  pendingTagLabels,
  descriptionEditorSessionId,
  editorAutofocus,
  editorRevealText = null,
  createCategoryPending,
  createStatusPending,
  createTagPending,
  onSelectCategoryId,
  onSelectStatusId,
  onCreateCategory,
  onCreateStatus,
  onTagValuesChange,
  onCancelEdit,
  onDeleteEditingItem,
  onAddItem,
  onAddItemInCategory,
}: TextCaptureFormProps) {
  const moreTriggerRef = useRef<HTMLButtonElement | null>(null)
  const [morePickerOpen, setMorePickerOpen] = useState(false)
  const [activeMorePicker, setActiveMorePicker] = useState<"status" | "tag" | null>(null)

  const selectedCategory = categories.find(
    (category) => category.id === form.selectedCategoryIds[0],
  )
  const selectedCategoryLabel = selectedCategory?.label ?? ""
  const addItemLabel = selectedCategory
    ? `Add new note in current category ${selectedCategory.label}`
    : "Add new note"

  const selectedTagLabels = useMemo(() => {
    const next = [
      ...form.selectedTagIds.map((id) => tags.find((tag) => tag.id === id)?.label ?? `Tag #${id}`),
      ...pendingTagLabels,
    ]
    const seen = new Set<string>()
    return next.filter((label) => {
      const normalized = normalizeLabel(label)
      if (normalized === "" || seen.has(normalized)) {
        return false
      }
      seen.add(normalized)
      return true
    })
  }, [form.selectedTagIds, pendingTagLabels, tags])

  const selectedTagLabelSet = useMemo(() => {
    return new Set(selectedTagLabels.map((label) => normalizeLabel(label)))
  }, [selectedTagLabels])

  const selectedStatusLabel =
    statuses.find((status) => status.id === form.selectedStatusId)?.label ?? "No status"

  const newItemHasUserInput =
    form.description !== "" ||
    form.selectedCategoryIds.length > 0 ||
    form.selectedStatusId !== null ||
    form.selectedTagIds.length > 0 ||
    pendingTagLabels.length > 0 ||
    form.dueExpanded ||
    form.timeDue !== null ||
    form.remindExpanded ||
    form.timeRemind !== null
  const showCancelButton = editingItemId !== null || newItemHasUserInput

  const closeMoreDropdown = () => {
    setMorePickerOpen(false)
    setActiveMorePicker(null)
  }

  const updateMorePicker = (picker: "status" | "tag", open: boolean) => {
    setActiveMorePicker((current) => (open ? picker : current === picker ? null : current))
  }

  const selectCategory = (categoryId: number) => {
    onSelectCategoryId(String(categoryId))
  }

  const addTagLabel = (label: string) => {
    const normalized = normalizeLabel(label)
    if (normalized === "" || selectedTagLabelSet.has(normalized)) {
      return
    }
    onTagValuesChange([...selectedTagLabels, label])
  }

  const toggleTagLabel = (label: string) => {
    const normalized = normalizeLabel(label)
    if (normalized === "") {
      return
    }
    if (selectedTagLabelSet.has(normalized)) {
      onTagValuesChange(
        selectedTagLabels.filter((selectedLabel) => normalizeLabel(selectedLabel) !== normalized),
      )
      return
    }
    addTagLabel(label)
  }

  const expandDateField = (field: "due" | "remind") => {
    setMorePickerOpen(false)
    setForm((prev) =>
      field === "due"
        ? {
            ...prev,
            dueExpanded: true,
            timeDue: prev.timeDue || createDefaultDueValue(),
          }
        : {
            ...prev,
            remindExpanded: true,
            timeRemind: prev.timeRemind || createDefaultRemindValue(),
          },
    )
  }

  const renderDateField = (
    field: "due" | "remind",
    label: "Due" | "Remind",
    expanded: boolean,
    value: string | null,
  ) => {
    if (!expanded) {
      return (
        <button
          type="button"
          className={styles.moreMenuItem}
          onClick={() => expandDateField(field)}
          role="menuitem"
        >
          <span>{label}</span>
          <CalendarBlank size={14} weight="regular" />
        </button>
      )
    }

    return (
      <label className={styles.dateField}>
        <span className={styles.dateFieldLabel}>{label}</span>
        <input
          type="datetime-local"
          value={value ?? ""}
          onChange={(e) =>
            setForm((p) =>
              field === "due"
                ? { ...p, timeDue: e.target.value }
                : { ...p, timeRemind: e.target.value },
            )
          }
          className={styles.dateInput}
        />
      </label>
    )
  }

  return (
    <section className={styles.formColumn}>
      {/* Notes save in the background, so there is no submit action. Enter in a
          date field would otherwise implicitly submit and reload the page. */}
      <form className={styles.form} onSubmit={(event) => event.preventDefault()}>
        <div className={styles.formActions}>
          {showCancelButton && (
            <Button
              view="flat"
              size="s"
              pin="round-round"
              type="button"
              onClick={onCancelEdit}
              aria-label={editingItemId !== null ? "Cancel editing" : "Cancel changes"}
              className={styles.formSideButton}
            >
              <X size={14} weight="regular" />
            </Button>
          )}
        </div>

        <AtomicEditor
          autofocus={editorAutofocus}
          documentId={descriptionEditorSessionId}
          initialRevealText={editorRevealText}
          pasteUrlAsMarkdown={pasteUrlAsMarkdown}
          placeholder="Write now, organize later..."
          value={form.description}
          onUpdate={(description) => setForm((prev) => ({ ...prev, description }))}
        />

        <div className={styles.formToolbar}>
          <button
            type="button"
            className={`${styles.addItemButton} ${styles.addUncategorizedItemButton}`}
            onClick={onAddItem}
            aria-label="Add new uncategorized note"
            title="Add new uncategorized note"
          >
            <Plus size={16} weight="bold" aria-hidden />
          </button>
          <div className={styles.categoryControls}>
            <button
              type="button"
              className={styles.addItemButton}
              onClick={onAddItemInCategory}
              aria-label={addItemLabel}
              title={addItemLabel}
            >
              <Plus size={16} weight="bold" aria-hidden />
            </button>
            <FilterablePicker
              variant="inline"
              value={selectedCategoryLabel}
              triggerAriaLabel="Categories"
              listboxAriaLabel="Category options"
              triggerIcon={
                <FolderOpen size={17} weight="regular" className={styles.propertyPickerIcon} />
              }
              options={categories}
              selectedIds={form.selectedCategoryIds}
              disabled={!userPresent}
              pending={createCategoryPending}
              onOpenChange={(open) => {
                if (open) closeMoreDropdown()
              }}
              onSelectOption={(category) => selectCategory(Number(category.id))}
              onCreateOption={onCreateCategory}
              validateInput={getCategoryNameError}
              emptyWithoutQueryMessage="No categories yet"
              inputPlaceholder="Enter new category..."
            />
          </div>
          <FilterablePicker
            variant="inline"
            value={selectedTagLabels.join(", ") || ""}
            triggerAriaLabel="Tags"
            listboxAriaLabel="Tag options"
            triggerIcon={<Tag size={16} weight="regular" className={styles.propertyPickerIcon} />}
            options={tags}
            selectedIds={form.selectedTagIds}
            disabled={!userPresent}
            pending={createTagPending}
            multiple
            onOpenChange={(open) => {
              if (open) closeMoreDropdown()
            }}
            onSelectOption={(tag) => toggleTagLabel(tag.label)}
            onCreateOption={addTagLabel}
            emptyWithoutQueryMessage="No tags yet"
            inputPlaceholder="Enter new tag..."
          />
          {form.dueExpanded && renderDateField("due", "Due", form.dueExpanded, form.timeDue)}
          {form.remindExpanded &&
            renderDateField("remind", "Remind", form.remindExpanded, form.timeRemind)}

          <div className={styles.morePicker}>
            <button
              ref={moreTriggerRef}
              type="button"
              className={styles.moreTrigger}
              onClick={() => {
                setMorePickerOpen((open) => !open)
                setActiveMorePicker(null)
              }}
              disabled={!userPresent}
              aria-label="More note settings"
              aria-expanded={morePickerOpen}
              aria-haspopup="menu"
            >
              <DotsThree size={22} weight="bold" />
            </button>

            <Popup
              anchorRef={moreTriggerRef}
              className={styles.morePopup}
              open={morePickerOpen}
              onClose={closeMoreDropdown}
              placement={["top-end", "top-start", "bottom-end", "bottom-start"]}
              offset={6}
              role="menu"
            >
              <div className={styles.morePanel} aria-label="More note settings">
                <button
                  type="button"
                  className={`${styles.moreMenuItem} ${styles.moreMenuDeleteItem}`}
                  onClick={() => {
                    closeMoreDropdown()
                    onDeleteEditingItem()
                  }}
                  disabled={!userPresent || editingItemId === null}
                  role="menuitem"
                >
                  <span>Delete</span>
                </button>
                <div className={styles.moreMenuDivider} aria-hidden="true" />
                {!form.dueExpanded && renderDateField("due", "Due", form.dueExpanded, form.timeDue)}
                {!form.remindExpanded &&
                  renderDateField("remind", "Remind", form.remindExpanded, form.timeRemind)}
                <FilterablePicker
                  variant="menu"
                  triggerLabel="Status"
                  triggerRole="menuitem"
                  value={selectedStatusLabel}
                  triggerAriaLabel="Status"
                  listboxAriaLabel="Status options"
                  options={[{ id: "", label: "No status" }, ...statuses]}
                  selectedIds={[form.selectedStatusId ?? ""]}
                  pending={createStatusPending}
                  open={activeMorePicker === "status"}
                  onOpenChange={(open) => updateMorePicker("status", open)}
                  placement={["left-start", "right-start", "top-start", "bottom-start"]}
                  onSelectOption={(status) => onSelectStatusId(String(status.id))}
                  onCreateOption={onCreateStatus}
                  emptyWithoutQueryMessage="No statuses yet"
                  inputPlaceholder="Enter new status..."
                />
                <FilterablePicker
                  variant="menu"
                  triggerLabel="Tag"
                  triggerRole="menuitem"
                  value={selectedTagLabels.join(", ") || "None"}
                  triggerAriaLabel="Tags"
                  listboxAriaLabel="Tag options"
                  triggerIcon={
                    <Tag size={14} weight="regular" className={styles.propertyPickerIcon} />
                  }
                  options={tags}
                  selectedIds={form.selectedTagIds}
                  pending={createTagPending}
                  multiple
                  open={activeMorePicker === "tag"}
                  onOpenChange={(open) => updateMorePicker("tag", open)}
                  placement={["left-start", "right-start", "top-start", "bottom-start"]}
                  onSelectOption={(tag) => toggleTagLabel(tag.label)}
                  onCreateOption={addTagLabel}
                  emptyWithoutQueryMessage="No tags yet"
                  inputPlaceholder="Enter new tag..."
                />
              </div>
            </Popup>
          </div>
        </div>
      </form>
    </section>
  )
}
