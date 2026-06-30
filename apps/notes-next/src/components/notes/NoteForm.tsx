"use client"

import dynamic from "next/dynamic"
import { Button, Popup, Text } from "@gravity-ui/uikit"
import { FilterablePickerPopup } from "@/components/ui/FilterablePickerPopup"
import { CalendarBlank, CaretDown, DotsThree, Plus, X } from "@phosphor-icons/react"
import {
  type Dispatch,
  type FormEvent,
  type JSX,
  type KeyboardEvent,
  type SetStateAction,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import type { CategoryRecord, TagRecord } from "@lib/db-marketing"
import type { NoteFormState } from "@/types/notes"
import { normalizeLabel, toLowercaseInput } from "@/lib/strings"
import { createDefaultDueValue, createDefaultRemindValue } from "@/types/notes"
import type { AtomicEditorProps } from "@/components/editor/AtomicEditor"
import styles from "./NoteForm.module.css"

const AtomicEditor = dynamic<AtomicEditorProps>(
  () => import("@/components/editor/AtomicEditor").then((mod) => mod.AtomicEditor),
  {
    ssr: false,
  },
)

interface NoteFormProps {
  form: NoteFormState
  setForm: Dispatch<SetStateAction<NoteFormState>>
  editingNoteId: number | null
  notePending: boolean
  userPresent: boolean
  categories: CategoryRecord[]
  tags: TagRecord[]
  pendingTagLabels: string[]
  descriptionEditorSessionId: number
  editorAutofocus: boolean
  editorRevealText?: string | null
  categoryInputValue: string
  onCategoryInputValueChange: (value: string) => void
  createCategoryPending: boolean
  createTagPending: boolean
  onSelectCategoryId: (rawId: string) => void
  onCreateCategory: (label: string) => void | Promise<void>
  onTagValuesChange: (values: string[]) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  onCancelEdit: () => void
  onDeleteEditingNote: () => void
  header?: JSX.Element
}

export function NoteForm({
  form,
  setForm,
  editingNoteId,
  userPresent,
  categories,
  tags,
  pendingTagLabels,
  descriptionEditorSessionId,
  editorAutofocus,
  editorRevealText = null,
  categoryInputValue,
  onCategoryInputValueChange,
  createCategoryPending,
  createTagPending,
  onSelectCategoryId,
  onCreateCategory,
  onTagValuesChange,
  onSubmit,
  onCancelEdit,
  onDeleteEditingNote,
  header,
}: NoteFormProps) {
  const categoryTriggerRef = useRef<HTMLButtonElement | null>(null)
  const categoryInputRef = useRef<HTMLInputElement | null>(null)
  const tagTriggerRef = useRef<HTMLButtonElement | null>(null)
  const tagInputRef = useRef<HTMLInputElement | null>(null)
  const moreTriggerRef = useRef<HTMLButtonElement | null>(null)
  const [categoryPickerOpen, setCategoryPickerOpen] = useState(false)
  const [tagPickerOpen, setTagPickerOpen] = useState(false)
  const [morePickerOpen, setMorePickerOpen] = useState(false)
  const [tagInputValue, setTagInputValue] = useState("")

  const selectedCategoryLabel =
    form.selectedCategoryId === null
      ? ""
      : (categories.find((category) => category.id === form.selectedCategoryId)?.label ?? "")

  const filteredCategoryOptions = useMemo(() => {
    const query = normalizeLabel(categoryInputValue)
    if (query === "") {
      return categories
    }
    return categories.filter((category) => normalizeLabel(category.label).includes(query))
  }, [categories, categoryInputValue])

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

  const filteredTagOptions = useMemo(() => {
    const query = normalizeLabel(tagInputValue)
    return tags.filter((tag) => {
      const normalized = normalizeLabel(tag.label)
      if (selectedTagLabelSet.has(normalized)) {
        return false
      }
      return query === "" || normalized.includes(query)
    })
  }, [selectedTagLabelSet, tagInputValue, tags])

  const newNoteHasUserInput =
    form.description !== "" ||
    form.selectedTagIds.length > 0 ||
    pendingTagLabels.length > 0 ||
    form.dueExpanded ||
    form.timeDue !== null ||
    form.remindExpanded ||
    form.timeRemind !== null
  const showCancelButton = editingNoteId !== null || newNoteHasUserInput

  useEffect(() => {
    if (!categoryPickerOpen) {
      onCategoryInputValueChange(selectedCategoryLabel)
    }
  }, [categoryPickerOpen, onCategoryInputValueChange, selectedCategoryLabel])

  const openCategoryDropdown = () => {
    onCategoryInputValueChange("")
    setCategoryPickerOpen(true)
    setTagPickerOpen(false)
    setMorePickerOpen(false)
  }

  const restoreCategoryInputValue = () => {
    onCategoryInputValueChange(selectedCategoryLabel)
  }

  const closeCategoryDropdown = () => {
    setCategoryPickerOpen(false)
    restoreCategoryInputValue()
  }

  const openTagDropdown = () => {
    setTagInputValue("")
    setTagPickerOpen(true)
    setCategoryPickerOpen(false)
    setMorePickerOpen(true)
    restoreCategoryInputValue()
  }

  const closeTagDropdown = () => {
    setTagPickerOpen(false)
    setTagInputValue("")
  }

  const closeMoreDropdown = () => {
    setMorePickerOpen(false)
    closeTagDropdown()
  }

  const selectCategory = (categoryId: number) => {
    onSelectCategoryId(String(categoryId))
    setCategoryPickerOpen(false)
  }

  const submitCategoryInput = () => {
    const label = categoryInputValue.trim()
    if (label === "") {
      return
    }
    const matchingCategory = categories.find(
      (category) => normalizeLabel(category.label) === normalizeLabel(label),
    )
    if (matchingCategory) {
      selectCategory(matchingCategory.id)
      return
    }
    if (filteredCategoryOptions.length === 0) {
      void (async () => {
        try {
          await onCreateCategory(label)
        } finally {
          setCategoryPickerOpen(false)
        }
      })()
    }
  }

  const handleCategoryInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault()
      closeCategoryDropdown()
      return
    }
    if (event.key !== "Enter") {
      return
    }
    event.preventDefault()
    submitCategoryInput()
  }

  const addTagLabel = (label: string) => {
    const normalized = normalizeLabel(label)
    if (normalized === "" || selectedTagLabelSet.has(normalized)) {
      setTagInputValue("")
      return
    }
    onTagValuesChange([...selectedTagLabels, label])
    setTagInputValue("")
    window.setTimeout(() => tagInputRef.current?.focus(), 0)
  }

  const removeTagLabel = (label: string) => {
    const normalized = normalizeLabel(label)
    onTagValuesChange(
      selectedTagLabels.filter((selectedLabel) => normalizeLabel(selectedLabel) !== normalized),
    )
  }

  const submitTagInput = () => {
    const label = tagInputValue.trim()
    if (label === "") {
      return
    }
    const matchingTag = filteredTagOptions.find(
      (tag) => normalizeLabel(tag.label) === normalizeLabel(label),
    )
    addTagLabel(matchingTag?.label ?? label)
  }

  const handleTagInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault()
      closeTagDropdown()
      return
    }
    if (event.key !== "Enter") {
      return
    }
    event.preventDefault()
    submitTagInput()
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
        <Text variant="caption-1" color="secondary">
          {label}
        </Text>
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
      {header}
      <form className={styles.form} onSubmit={onSubmit}>
        <div className={styles.formActions}>
          {showCancelButton && (
            <Button
              view="flat"
              size="s"
              pin="round-round"
              type="button"
              onClick={onCancelEdit}
              aria-label={editingNoteId !== null ? "Cancel editing" : "Cancel changes"}
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
          placeholder="Write now, organize later..."
          value={form.description}
          onUpdate={(description) => setForm((prev) => ({ ...prev, description }))}
        />

        <div className={styles.dateFields}>
          <div className={styles.categoryPicker}>
            <button
              ref={categoryTriggerRef}
              type="button"
              className={styles.categoryTrigger}
              onClick={categoryPickerOpen ? closeCategoryDropdown : openCategoryDropdown}
              disabled={!userPresent || createCategoryPending}
              aria-expanded={categoryPickerOpen}
              aria-haspopup="dialog"
            >
              <span className={styles.categoryTriggerLabel}>
                <span className={styles.categoryTriggerValue}>
                  {selectedCategoryLabel || "uncategorized"}
                </span>
              </span>
              <CaretDown size={14} weight="regular" />
            </button>

            <FilterablePickerPopup
              anchorRef={categoryTriggerRef}
              open={categoryPickerOpen}
              onClose={closeCategoryDropdown}
              placement={["top-start", "top-end", "bottom-start", "bottom-end"]}
              listboxAriaLabel="Category options"
              options={filteredCategoryOptions}
              inputValue={categoryInputValue}
              inputRef={categoryInputRef}
              inputDisabled={!userPresent || createCategoryPending}
              onInputChange={(value) => onCategoryInputValueChange(toLowercaseInput(value))}
              onInputKeyDown={handleCategoryInputKeyDown}
              onInputSubmit={submitCategoryInput}
              onSelectOption={(category) => selectCategory(Number(category.id))}
              isOptionActive={(category) => form.selectedCategoryId === Number(category.id)}
              isOptionSelected={(category) => form.selectedCategoryId === Number(category.id)}
              emptyWithoutQueryMessage="No categories yet"
            />
          </div>
          {form.dueExpanded && renderDateField("due", "Due", form.dueExpanded, form.timeDue)}
          {form.remindExpanded &&
            renderDateField("remind", "Remind", form.remindExpanded, form.timeRemind)}

          <div className={styles.morePicker}>
            <button
              ref={moreTriggerRef}
              type="button"
              className={`${styles.categoryTrigger} ${styles.moreTrigger}`}
              onClick={() => {
                setMorePickerOpen((open) => !open)
                setCategoryPickerOpen(false)
                setTagPickerOpen(false)
                restoreCategoryInputValue()
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
                    onDeleteEditingNote()
                  }}
                  disabled={!userPresent || editingNoteId === null}
                  role="menuitem"
                >
                  <span>Delete</span>
                </button>
                <div className={styles.moreMenuDivider} aria-hidden="true" />
                {!form.dueExpanded && renderDateField("due", "Due", form.dueExpanded, form.timeDue)}
                {!form.remindExpanded &&
                  renderDateField("remind", "Remind", form.remindExpanded, form.timeRemind)}
                <button
                  ref={tagTriggerRef}
                  type="button"
                  className={styles.moreMenuItem}
                  onClick={tagPickerOpen ? closeTagDropdown : openTagDropdown}
                  disabled={!userPresent || createTagPending}
                  aria-expanded={tagPickerOpen}
                  aria-haspopup="dialog"
                  role="menuitem"
                >
                  <span>Tag</span>
                  <Plus size={12} weight="regular" />
                </button>
                <FilterablePickerPopup
                  anchorRef={tagTriggerRef}
                  open={tagPickerOpen}
                  onClose={closeTagDropdown}
                  placement={["left-start", "right-start", "top-start", "bottom-start"]}
                  listboxAriaLabel="Tag options"
                  options={filteredTagOptions}
                  inputValue={tagInputValue}
                  inputRef={tagInputRef}
                  inputDisabled={!userPresent || createTagPending}
                  onInputChange={(value) => setTagInputValue(toLowercaseInput(value))}
                  onInputKeyDown={handleTagInputKeyDown}
                  onInputSubmit={submitTagInput}
                  onSelectOption={(tag) => addTagLabel(tag.label)}
                  emptyWithoutQueryMessage="No more tags."
                />
              </div>
            </Popup>
          </div>

          {selectedTagLabels.map((label) => (
            <button
              key={normalizeLabel(label)}
              type="button"
              className={styles.selectedTag}
              onClick={() => removeTagLabel(label)}
              aria-label={`Remove tag ${label}`}
            >
              <span>{label}</span>
              <X size={10} weight="regular" />
            </button>
          ))}
        </div>
      </form>
    </section>
  )
}
