"use client"

import { TagsInput as MantineTagsInput } from "@mantine/core"
import { Button, Icon, Text, TextArea } from "@gravity-ui/uikit"
import { Calendar, TrashBin, Xmark } from "@gravity-ui/icons"
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
import { CaretDownIcon } from "@/components/ui/icons/CaretDownIcon"
import styles from "./NoteForm.module.css"

interface NoteFormProps {
  form: NoteFormState
  setForm: Dispatch<SetStateAction<NoteFormState>>
  editingNoteId: number | null
  notePending: boolean
  deletingNoteId: number | null
  userPresent: boolean
  categories: CategoryRecord[]
  tags: TagRecord[]
  pendingTagLabels: string[]
  categoryInputValue: string
  onCategoryInputValueChange: (value: string) => void
  createCategoryPending: boolean
  createTagPending: boolean
  onSelectCategoryId: (rawId: string) => void
  onCreateCategory: (label: string) => void | Promise<void>
  onTagValuesChange: (values: string[]) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  onDeleteNote: (noteId: number) => void
  onCancelEdit: () => void
  header: JSX.Element
}

export function NoteForm({
  form,
  setForm,
  editingNoteId,
  notePending,
  deletingNoteId,
  userPresent,
  categories,
  tags,
  pendingTagLabels,
  categoryInputValue,
  onCategoryInputValueChange,
  createCategoryPending,
  createTagPending,
  onSelectCategoryId,
  onCreateCategory,
  onTagValuesChange,
  onSubmit,
  onDeleteNote,
  onCancelEdit,
  header,
}: NoteFormProps) {
  const categoryPickerRef = useRef<HTMLDivElement | null>(null)
  const categoryInputRef = useRef<HTMLInputElement | null>(null)
  const [categoryPickerOpen, setCategoryPickerOpen] = useState(false)

  const selectedCategoryLabel =
    form.selectedCategoryId === null
      ? ""
      : (categories.find((category) => category.id === form.selectedCategoryId)?.label ?? "")

  const defaultNewNoteCategoryId = useMemo(
    () => (categories.length > 0 ? categories.reduce((a, b) => (a.id < b.id ? a : b)).id : null),
    [categories],
  )

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

  const newNoteHasUserInput =
    form.description !== "" ||
    form.selectedTagIds.length > 0 ||
    pendingTagLabels.length > 0 ||
    form.dueExpanded ||
    form.timeDue !== null ||
    form.remindExpanded ||
    form.timeRemind !== null
  const showCancelButton = editingNoteId !== null || newNoteHasUserInput
  const primaryActionPin =
    editingNoteId !== null ? "brick-brick" : showCancelButton ? "round-brick" : "round-round"

  useEffect(() => {
    if (!categoryPickerOpen) {
      onCategoryInputValueChange(selectedCategoryLabel)
    }
  }, [categoryPickerOpen, onCategoryInputValueChange, selectedCategoryLabel])

  useEffect(() => {
    if (!categoryPickerOpen) {
      return
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (categoryPickerRef.current?.contains(event.target as Node)) {
        return
      }
      setCategoryPickerOpen(false)
      onCategoryInputValueChange(selectedCategoryLabel)
    }

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") {
        return
      }
      setCategoryPickerOpen(false)
      onCategoryInputValueChange(selectedCategoryLabel)
    }

    document.addEventListener("pointerdown", handlePointerDown)
    document.addEventListener("keydown", handleKeyDown)
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown)
      document.removeEventListener("keydown", handleKeyDown)
    }
  }, [categoryPickerOpen, onCategoryInputValueChange, selectedCategoryLabel])

  const openCategoryDropdown = () => {
    onCategoryInputValueChange("")
    setCategoryPickerOpen(true)
    window.setTimeout(() => categoryInputRef.current?.focus(), 0)
  }

  const restoreCategoryInputValue = () => {
    onCategoryInputValueChange(selectedCategoryLabel)
  }

  const closeCategoryDropdown = () => {
    setCategoryPickerOpen(false)
    restoreCategoryInputValue()
  }

  const selectCategory = (categoryId: number) => {
    onSelectCategoryId(String(categoryId))
    setCategoryPickerOpen(false)
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
    const label = categoryInputValue.trim()
    if (label === "") {
      return
    }
    const matchingCategory = categories.find(
      (category) => normalizeLabel(category.label) === normalizeLabel(label),
    )
    if (matchingCategory) {
      event.preventDefault()
      selectCategory(matchingCategory.id)
      return
    }
    if (filteredCategoryOptions.length === 0) {
      event.preventDefault()
      void (async () => {
        try {
          await onCreateCategory(label)
        } finally {
          setCategoryPickerOpen(false)
        }
      })()
    }
  }

  const expandDateField = (field: "due" | "remind") => {
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
          className={styles.dateLinkButton}
          onClick={() => expandDateField(field)}
        >
          <span>{label}</span>
          <Icon data={Calendar} size={14} />
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
        <TextArea
          size="m"
          placeholder="Description"
          rows={1}
          value={form.description}
          onUpdate={(v) => setForm((p) => ({ ...p, description: v }))}
          className={styles.formDescription}
        />

        <div className={styles.dateFields}>
          <div className={styles.categoryPicker} ref={categoryPickerRef}>
            <button
              type="button"
              className={styles.categoryTrigger}
              onClick={categoryPickerOpen ? closeCategoryDropdown : openCategoryDropdown}
              disabled={!userPresent || createCategoryPending}
              aria-expanded={categoryPickerOpen}
              aria-haspopup="dialog"
            >
              <span className={styles.categoryTriggerLabel}>
                Category:{" "}
                <span className={styles.categoryTriggerValue}>
                  {selectedCategoryLabel || "none"}
                </span>
              </span>
              <CaretDownIcon size={14} />
            </button>

            {categoryPickerOpen && (
              <div className={styles.categoryPanel}>
                <input
                  ref={categoryInputRef}
                  type="text"
                  className={styles.categoryInput}
                  placeholder="Enter new or select below..."
                  value={categoryInputValue}
                  disabled={!userPresent || createCategoryPending}
                  onChange={(event) => {
                    onCategoryInputValueChange(toLowercaseInput(event.currentTarget.value))
                  }}
                  onKeyDown={handleCategoryInputKeyDown}
                />
                <div
                  className={styles.categoryOptions}
                  role="listbox"
                  aria-label="Category options"
                >
                  {filteredCategoryOptions.length === 0 && categoryInputValue.trim() !== "" ? (
                    <div className={styles.categoryEmpty}>
                      Press Enter to create &quot;{categoryInputValue.trim()}&quot;
                    </div>
                  ) : (
                    filteredCategoryOptions.map((category) => (
                      <button
                        key={category.id}
                        type="button"
                        className={styles.categoryOption}
                        data-active={form.selectedCategoryId === category.id || undefined}
                        onClick={() => selectCategory(category.id)}
                        role="option"
                        aria-selected={form.selectedCategoryId === category.id}
                      >
                        {category.label}
                      </button>
                    ))
                  )}
                  {filteredCategoryOptions.length === 0 && categoryInputValue.trim() === "" && (
                    <div className={styles.categoryEmpty}>No categories yet.</div>
                  )}
                </div>
              </div>
            )}
          </div>
          {renderDateField("due", "Due", form.dueExpanded, form.timeDue)}
          {renderDateField("remind", "Remind", form.remindExpanded, form.timeRemind)}
        </div>

        <div className={styles.tagBlock}>
          <div className={styles.mantineField}>
            <MantineTagsInput
              placeholder="Add tags"
              data={tags.map((tag) => tag.label)}
              value={selectedTagLabels}
              clearable
              clearSectionMode="rightSection"
              rightSection={<CaretDownIcon size={16} />}
              rightSectionPointerEvents="none"
              acceptValueOnBlur={false}
              disabled={!userPresent || createTagPending}
              comboboxProps={{ withinPortal: false }}
              onChange={onTagValuesChange}
            />
          </div>
        </div>

        <div className={styles.formActions}>
          {editingNoteId !== null && (
            <Button
              view="outlined"
              size="l"
              pin="round-brick"
              type="button"
              loading={deletingNoteId === editingNoteId}
              disabled={notePending}
              onClick={() => onDeleteNote(editingNoteId)}
              aria-label="Delete note"
              className={`${styles.formSideButton} ${styles.formDeleteButton}`}
            >
              <Icon data={TrashBin} size={12} />
            </Button>
          )}
          <Button
            view="action"
            size="l"
            pin={primaryActionPin}
            type="submit"
            loading={notePending}
            className={styles.formPrimaryAction}
          >
            Save
          </Button>
          {showCancelButton && (
            <Button
              view="outlined"
              size="l"
              pin="brick-round"
              type="button"
              onClick={onCancelEdit}
              aria-label={editingNoteId !== null ? "Cancel editing" : "Cancel changes"}
              className={styles.formSideButton}
            >
              <Icon data={Xmark} size={14} />
            </Button>
          )}
        </div>
      </form>
    </section>
  )
}
