"use client"

import {
  Combobox,
  TagsInput as MantineTagsInput,
  TextInput as MantineTextInput,
  useCombobox,
} from "@mantine/core"
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
  const categoryCombobox = useCombobox()
  const categorySelectionCommittedRef = useRef(false)

  const selectedCategoryLabel =
    form.selectedCategoryId === null
      ? ""
      : categories.find((category) => category.id === form.selectedCategoryId)?.label ?? ""

  const filteredCategoryOptions = useMemo(() => {
    const query = normalizeLabel(categoryInputValue)
    if (query === "") {
      return categories
    }
    return categories.filter((category) => normalizeLabel(category.label).includes(query))
  }, [categories, categoryInputValue])

  const selectedTagLabels = useMemo(() => {
    const next = [
      ...form.selectedTagIds.map(
        (id) => tags.find((tag) => tag.id === id)?.label ?? `Tag #${id}`,
      ),
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

  useEffect(() => {
    onCategoryInputValueChange(selectedCategoryLabel)
  }, [onCategoryInputValueChange, selectedCategoryLabel])

  const openCategoryDropdown = () => {
    if (selectedCategoryLabel !== "" && categoryInputValue === selectedCategoryLabel) {
      onCategoryInputValueChange("")
    }
    categoryCombobox.openDropdown()
    categoryCombobox.updateSelectedOptionIndex()
  }

  const restoreCategoryInputValue = () => {
    onCategoryInputValueChange(selectedCategoryLabel)
  }

  const handleCategoryInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
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
      onSelectCategoryId(String(matchingCategory.id))
      categoryCombobox.closeDropdown()
      return
    }
    if (filteredCategoryOptions.length === 0) {
      event.preventDefault()
      void (async () => {
        try {
          await onCreateCategory(label)
        } finally {
          categoryCombobox.closeDropdown()
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
              field === "due" ? { ...p, timeDue: e.target.value } : { ...p, timeRemind: e.target.value },
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
          {editingNoteId ? (
            <>
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
              <Button
                view="action"
                size="l"
                pin="brick-brick"
                type="submit"
                loading={notePending}
                className={styles.formPrimaryAction}
              >
                Edit note
              </Button>
              <Button
                view="outlined"
                size="l"
                pin="brick-round"
                type="button"
                onClick={onCancelEdit}
                aria-label="Cancel editing"
                className={styles.formSideButton}
              >
                <Icon data={Xmark} size={14} />
              </Button>
            </>
          ) : (
            <Button
              view="action"
              size="l"
              pin="round-round"
              type="submit"
              loading={notePending}
              className={styles.formPrimaryAction}
            >
              Add note
            </Button>
          )}
        </div>
        <div className={styles.dateFields}>
          {renderDateField("due", "Due", form.dueExpanded, form.timeDue)}
          {renderDateField("remind", "Remind", form.remindExpanded, form.timeRemind)}
        </div>
        <div className={styles.tagBlock}>
          <div className={styles.mantineField}>
            <Combobox
              store={categoryCombobox}
              onOptionSubmit={(optionValue) => {
                categorySelectionCommittedRef.current = true
                onSelectCategoryId(optionValue)
                categoryCombobox.closeDropdown()
              }}
            >
              <Combobox.Target>
                <MantineTextInput
                  placeholder={
                    categories.length === 0
                      ? "Type a category and press Enter"
                      : "Select category or type new"
                  }
                  value={categoryInputValue}
                  disabled={!userPresent || createCategoryPending}
                  rightSection={<CaretDownIcon size={16} />}
                  rightSectionPointerEvents="none"
                  onChange={(event) => {
                    onCategoryInputValueChange(toLowercaseInput(event.currentTarget.value))
                    categoryCombobox.openDropdown()
                    categoryCombobox.updateSelectedOptionIndex()
                  }}
                  onClick={openCategoryDropdown}
                  onFocus={openCategoryDropdown}
                  onBlur={() => {
                    categoryCombobox.closeDropdown()
                    window.setTimeout(() => {
                      if (categorySelectionCommittedRef.current) {
                        categorySelectionCommittedRef.current = false
                        return
                      }
                      restoreCategoryInputValue()
                    }, 0)
                  }}
                  onKeyDown={handleCategoryInputKeyDown}
                />
              </Combobox.Target>

              <Combobox.Dropdown>
                <Combobox.Options>
                  {filteredCategoryOptions.length === 0 ? (
                    <Combobox.Empty>
                      Press Enter to create "{categoryInputValue.trim()}"
                    </Combobox.Empty>
                  ) : (
                    filteredCategoryOptions.map((category) => (
                      <Combobox.Option key={category.id} value={String(category.id)}>
                        {category.label}
                      </Combobox.Option>
                    ))
                  )}
                </Combobox.Options>
              </Combobox.Dropdown>
            </Combobox>
          </div>
          <div className={styles.mantineField}>
            <MantineTagsInput
              placeholder="Enter tags"
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
        <TextArea
          size="m"
          placeholder="Description"
          rows={1}
          value={form.description}
          onUpdate={(v) => setForm((p) => ({ ...p, description: v }))}
          className={styles.formDescription}
        />
      </form>
    </section>
  )
}
