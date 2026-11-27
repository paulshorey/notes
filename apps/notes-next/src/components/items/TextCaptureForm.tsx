"use client"

import { Button, Popup } from "@gravity-ui/uikit"
import { FilterablePicker } from "@/components/ui/FilterablePicker"
import { DotsThree, FolderOpen, FolderSimple, Plus, Tag, X } from "@phosphor-icons/react"
import { type Dispatch, type SetStateAction, useRef, useState } from "react"
import { useItemPickers, type ItemPickerProps } from "./useItemPickers"
import { ItemOptionsPanel } from "./ItemOptionsPanel"
import type { StatusRecord } from "@lib/db-items"
import type { TextCaptureFormState } from "@/types/items"
import { ScheduleField, isScheduleFieldExpanded } from "@/capabilities/schedule/ScheduleField"
import type { EditorPart } from "@/views/registry"
import { StatusPicker } from "@/capabilities/status/StatusPicker"
import { TextEditorControl } from "@/capabilities/text/TextEditorControl"
import styles from "./TextCaptureForm.module.css"

interface TextCaptureFormProps extends ItemPickerProps {
  setForm: Dispatch<SetStateAction<TextCaptureFormState>>
  editingItemId: number | null
  pasteUrlAsMarkdown?: boolean
  statuses: StatusRecord[]
  descriptionEditorSessionId: string | number
  editorAutofocus: boolean
  editorRevealText?: string | null
  createStatusPending: boolean
  onSelectStatusId: (rawId: string) => void
  onCreateStatus: (label: string) => void | Promise<void>
  onCancelEdit: () => void
  onAddItem: () => void
  onAddItemInCategory: () => void
  /**
   * The parts the view prioritizes in the toolbar. Defaults to what a note is about.
   */
  prominent?: readonly EditorPart[]
  /**
   * Set when the form is shown in something that closes, such as a dialog. The corner
   * button then always shows and closes it, instead of clearing the form.
   */
  onClose?: () => void
}

const NOTE_PARTS: readonly EditorPart[] = ["filing", "tags"]

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
  onSelectFiling,
  onSelectSubcategoryId,
  onSelectStatusId,
  onCreateCategory,
  onCreateSubcategory,
  onCreateStatus,
  onTagValuesChange,
  onCancelEdit,
  onAddItem,
  onAddItemInCategory,
  prominent = NOTE_PARTS,
  onClose,
}: TextCaptureFormProps) {
  const moreTriggerRef = useRef<HTMLButtonElement | null>(null)
  const [morePickerOpen, setMorePickerOpen] = useState(false)
  const [toolbarTagPickerOpen, setToolbarTagPickerOpen] = useState(false)
  const inToolbar = (part: EditorPart) => prominent.includes(part)

  const pickers = useItemPickers({
    form,
    userPresent,
    categories,
    tags,
    pendingTagLabels,
    createCategoryPending,
    createTagPending,
    onSelectFiling,
    onSelectSubcategoryId,
    onCreateCategory,
    onCreateSubcategory,
    onTagValuesChange,
  })
  const {
    selectedCategoryLabel,
    selectedSubcategoryLabel,
    selectedTagLabels,
    categoryPicker,
    subcategoryPicker,
    tagPicker,
  } = pickers
  const addItemLabel = selectedCategoryLabel
    ? `Add new note in current category ${[selectedCategoryLabel, selectedSubcategoryLabel].filter(Boolean).join(" › ")}`
    : "Add new note"
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

  const closeMoreDropdown = () => setMorePickerOpen(false)

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
          {inToolbar("filing") && selectedSubcategoryLabel && (
            <FilterablePicker
              variant="inline"
              value={selectedSubcategoryLabel}
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
          {/* Keep the multi-select open after removing the last tag. */}
          {inToolbar("tags") && (selectedTagLabels.length > 0 || toolbarTagPickerOpen) && (
            <FilterablePicker
              variant="inline"
              value={selectedTagLabels.join(", ")}
              triggerIcon={<Tag size={16} weight="regular" className={styles.propertyPickerIcon} />}
              disabled={!userPresent}
              open={toolbarTagPickerOpen}
              onOpenChange={(open) => {
                setToolbarTagPickerOpen(open)
                if (open) closeMoreDropdown()
              }}
              {...tagPicker}
            />
          )}
          {/* Dates also appear inline when set or prominent in this view. */}
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
              {morePickerOpen && (
                <ItemOptionsPanel
                  key={descriptionEditorSessionId}
                  itemId={editingItemId}
                  form={form}
                  pickers={pickers}
                  onScheduleChange={patchForm}
                  onSelectStatusId={onSelectStatusId}
                  onCreateStatus={onCreateStatus}
                  anchorRef={moreTriggerRef}
                  onClose={closeMoreDropdown}
                />
              )}
            </Popup>
          </div>
        </div>
      </form>
    </section>
  )
}
