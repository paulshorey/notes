"use client"

import { Button, Popup } from "@gravity-ui/uikit"
import { FilterablePicker, type FilterablePickerProps } from "@/components/ui/FilterablePicker"
import { DotsThree, FolderOpen, FolderSimple, Plus, Tag, X } from "@phosphor-icons/react"
import { type Dispatch, type SetStateAction, useMemo, useRef, useState } from "react"
import { getCategoryNameError } from "@lib/db-items/contracts/category-name"
import type { CategoryRecord, StatusRecord, TagRecord } from "@lib/db-items"
import type { TextCaptureFormState } from "@/types/items"
import { normalizeLabel } from "@/lib/strings"
import { ScheduleField, isScheduleFieldExpanded } from "@/capabilities/schedule/ScheduleField"
import type { EditorPart } from "@/views/registry"
import { StatusPicker } from "@/capabilities/status/StatusPicker"
import { TextEditorControl } from "@/capabilities/text/TextEditorControl"
import styles from "./TextCaptureForm.module.css"

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
  onSelectSubcategoryId: (rawId: string) => void
  onSelectStatusId: (rawId: string) => void
  onCreateCategory: (label: string) => void | Promise<void>
  onCreateSubcategory: (label: string) => void | Promise<void>
  onCreateStatus: (label: string) => void | Promise<void>
  onTagValuesChange: (values: string[]) => void
  onCancelEdit: () => void
  onMoveEditingItem: () => void
  onDeleteEditingItem: () => void
  onAddItem: () => void
  onAddItemInCategory: () => void
  /**
   * The parts the view on screen is about. They stand in the toolbar; the others are
   * in the More menu. Defaults to what a note is about.
   */
  prominent?: readonly EditorPart[]
  /**
   * Set when the form is shown in something that closes, such as a dialog. The corner
   * button then always shows and closes it, instead of clearing the form.
   */
  onClose?: () => void
}

const NOTE_PARTS: readonly EditorPart[] = ["filing", "tags"]

const MENU_PICKER_PLACEMENT: FilterablePickerProps["placement"] = [
  "left-start",
  "right-start",
  "top-start",
  "bottom-start",
]

type MorePicker = "status" | "tag" | "category" | "subcategory"

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
  onSelectSubcategoryId,
  onSelectStatusId,
  onCreateCategory,
  onCreateSubcategory,
  onCreateStatus,
  onTagValuesChange,
  onCancelEdit,
  onMoveEditingItem,
  onDeleteEditingItem,
  onAddItem,
  onAddItemInCategory,
  prominent = NOTE_PARTS,
  onClose,
}: TextCaptureFormProps) {
  const moreTriggerRef = useRef<HTMLButtonElement | null>(null)
  const [morePickerOpen, setMorePickerOpen] = useState(false)
  const [activeMorePicker, setActiveMorePicker] = useState<MorePicker | null>(null)
  const inToolbar = (part: EditorPart) => prominent.includes(part)

  const selectedCategory = categories.find((category) => category.id === form.selectedCategoryId)
  const selectedSubcategory = selectedCategory?.subcategories.find(
    (subcategory) => subcategory.id === form.selectedSubcategoryId,
  )
  const selectedCategoryLabel = selectedCategory?.label ?? "__"
  const addItemLabel = selectedCategory
    ? `Add new note in current category ${[selectedCategory.label, selectedSubcategory?.label].filter(Boolean).join(" › ")}`
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

  const newItemHasUserInput =
    form.description !== "" ||
    form.selectedCategoryId !== null ||
    form.selectedStatusId !== null ||
    form.selectedTagIds.length > 0 ||
    pendingTagLabels.length > 0 ||
    form.dueExpanded ||
    form.timeDue !== null ||
    form.remindExpanded ||
    form.timeRemind !== null
  const showCancelButton = onClose !== undefined || editingItemId !== null || newItemHasUserInput
  const cancelLabel =
    onClose !== undefined ? "Close" : editingItemId !== null ? "Cancel editing" : "Cancel changes"

  const closeMoreDropdown = () => {
    setMorePickerOpen(false)
    setActiveMorePicker(null)
  }

  const updateMorePicker = (picker: MorePicker, open: boolean) => {
    setActiveMorePicker((current) => (open ? picker : current === picker ? null : current))
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

  // What each picker offers is the same wherever the view places it.
  const categoryPicker = {
    triggerAriaLabel: "Categories",
    listboxAriaLabel: "Category options",
    options: [{ id: "", label: "uncategorized" }, ...categories],
    selectedIds: [form.selectedCategoryId ?? ""],
    disabled: !userPresent,
    pending: createCategoryPending,
    onSelectOption: (category: { id: number | string }) => onSelectCategoryId(String(category.id)),
    onCreateOption: onCreateCategory,
    validateInput: (label: string) =>
      normalizeLabel(label) === "uncategorized" ? null : getCategoryNameError(label),
    emptyWithoutQueryMessage: "No categories yet",
    inputPlaceholder: "Enter new category...",
  }
  const subcategoryPicker = selectedCategory && {
    triggerAriaLabel: "Subcategory",
    listboxAriaLabel: "Subcategory options",
    options: [{ id: "", label: "no subcategory" }, ...selectedCategory.subcategories],
    selectedIds: [form.selectedSubcategoryId ?? ""],
    disabled: !userPresent,
    pending: createCategoryPending,
    onSelectOption: (subcategory: { id: number | string }) =>
      onSelectSubcategoryId(String(subcategory.id)),
    onCreateOption: onCreateSubcategory,
    validateInput: getCategoryNameError,
    emptyWithoutQueryMessage: `No subcategories in ${selectedCategory.label} yet`,
    inputPlaceholder: "Enter new subcategory...",
  }
  const tagPicker = {
    triggerAriaLabel: "Tags",
    listboxAriaLabel: "Tag options",
    options: tags,
    selectedIds: form.selectedTagIds,
    pending: createTagPending,
    multiple: true,
    onSelectOption: (tag: { label: string }) => toggleTagLabel(tag.label),
    onCreateOption: addTagLabel,
    emptyWithoutQueryMessage: "No tags yet",
    inputPlaceholder: "Enter new tag...",
  }

  /** Each capability control changes its own slice of the form. */
  const patchForm = (patch: (current: TextCaptureFormState) => Partial<TextCaptureFormState>) =>
    setForm((current) => ({ ...current, ...patch(current) }))

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
              onClick={onClose ?? onCancelEdit}
              aria-label={cancelLabel}
              className={styles.formSideButton}
            >
              <X size={14} weight="regular" />
            </Button>
          )}
        </div>

        <TextEditorControl
          draft={form}
          onChange={patchForm}
          autofocus={editorAutofocus}
          documentId={descriptionEditorSessionId}
          revealText={editorRevealText}
          pasteUrlAsMarkdown={pasteUrlAsMarkdown}
          placeholder="Write now, organize later..."
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
            <span aria-hidden>__</span>
          </button>
          {inToolbar("filing") && (
            <div className={styles.categoryControls}>
              <button
                type="button"
                className={`${styles.addItemButton} ${styles.categoryAddButton}`}
                onClick={onAddItemInCategory}
                aria-label={addItemLabel}
                title={addItemLabel}
              >
                <Plus size={16} weight="bold" aria-hidden />
              </button>
              <FilterablePicker
                variant="inline"
                value={selectedCategoryLabel}
                triggerClassName={styles.categoryPickerTrigger}
                triggerIcon={
                  <FolderOpen size={17} weight="regular" className={styles.propertyPickerIcon} />
                }
                onOpenChange={(open) => {
                  if (open) closeMoreDropdown()
                }}
                {...categoryPicker}
              />
            </div>
          )}
          {/* A subcategory belongs to the chosen category, so it is offered only then. */}
          {inToolbar("filing") && subcategoryPicker && (
            <FilterablePicker
              variant="inline"
              value={selectedSubcategory?.label ?? "__"}
              triggerIcon={
                <FolderSimple size={16} weight="regular" className={styles.propertyPickerIcon} />
              }
              onOpenChange={(open) => {
                if (open) closeMoreDropdown()
              }}
              {...subcategoryPicker}
            />
          )}
          {inToolbar("status") && (
            <StatusPicker
              variant="inline"
              draft={form}
              statuses={statuses}
              pending={createStatusPending}
              disabled={!userPresent}
              onOpenChange={(open) => {
                if (open) closeMoreDropdown()
              }}
              onSelectStatusId={onSelectStatusId}
              onCreateStatus={onCreateStatus}
            />
          )}
          {inToolbar("tags") && (
            <FilterablePicker
              variant="inline"
              value={selectedTagLabels.join(", ") || ""}
              triggerIcon={<Tag size={16} weight="regular" className={styles.propertyPickerIcon} />}
              disabled={!userPresent}
              onOpenChange={(open) => {
                if (open) closeMoreDropdown()
              }}
              {...tagPicker}
            />
          )}
          {/* A date the item has stands in the toolbar. Where the view is about dates,
              the missing ones are offered there too; elsewhere they are in the menu. */}
          {(["due", "remind"] as const).map(
            (field) =>
              (isScheduleFieldExpanded(form, field) || inToolbar("schedule")) && (
                <ScheduleField
                  // A date being retyped belongs to one entry: the field starts over
                  // when another entry takes the form.
                  key={`${field}:${descriptionEditorSessionId}`}
                  field={field}
                  draft={form}
                  onChange={patchForm}
                  collapsedAs="button"
                />
              ),
          )}

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
                {editingItemId !== null && (
                  <button
                    type="button"
                    className={styles.moreMenuItem}
                    role="menuitem"
                    onClick={() => {
                      closeMoreDropdown()
                      onMoveEditingItem()
                    }}
                  >
                    <span>Move to workspace</span>
                  </button>
                )}
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
                {!inToolbar("schedule") &&
                  (["due", "remind"] as const).map(
                    (field) =>
                      !isScheduleFieldExpanded(form, field) && (
                        <ScheduleField
                          key={field}
                          field={field}
                          draft={form}
                          onChange={patchForm}
                          onExpand={() => setMorePickerOpen(false)}
                        />
                      ),
                  )}
                {!inToolbar("status") && (
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
                )}
                {!inToolbar("filing") && (
                  <FilterablePicker
                    variant="menu"
                    triggerLabel="Category"
                    triggerRole="menuitem"
                    value={selectedCategory?.label ?? "None"}
                    open={activeMorePicker === "category"}
                    onOpenChange={(open) => updateMorePicker("category", open)}
                    placement={MENU_PICKER_PLACEMENT}
                    {...categoryPicker}
                  />
                )}
                {!inToolbar("filing") && subcategoryPicker && (
                  <FilterablePicker
                    variant="menu"
                    triggerLabel="Subcategory"
                    triggerRole="menuitem"
                    value={selectedSubcategory?.label ?? "None"}
                    open={activeMorePicker === "subcategory"}
                    onOpenChange={(open) => updateMorePicker("subcategory", open)}
                    placement={MENU_PICKER_PLACEMENT}
                    {...subcategoryPicker}
                  />
                )}
                <FilterablePicker
                  variant="menu"
                  triggerLabel="Tag"
                  triggerRole="menuitem"
                  value={selectedTagLabels.join(", ") || "None"}
                  triggerIcon={
                    <Tag size={14} weight="regular" className={styles.propertyPickerIcon} />
                  }
                  open={activeMorePicker === "tag"}
                  onOpenChange={(open) => updateMorePicker("tag", open)}
                  placement={MENU_PICKER_PLACEMENT}
                  {...tagPicker}
                />
              </div>
            </Popup>
          </div>
        </div>
      </form>
    </section>
  )
}
