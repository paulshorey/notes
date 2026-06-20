"use client"

import dynamic from "next/dynamic"
import { Button, Popup, Text } from "@gravity-ui/uikit"
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
import type { CategoryRecord, TagRecord, WorkflowStatusRecord } from "@lib/db-marketing"
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
  workflowStatuses: WorkflowStatusRecord[]
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
  onAddToBoard: () => void
  onRemoveFromBoard: () => void
  onSelectWorkflowStatusId: (workflowStatusId: number) => void
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
  workflowStatuses,
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
  onAddToBoard,
  onRemoveFromBoard,
  onSelectWorkflowStatusId,
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
  const [workflowPickerOpen, setWorkflowPickerOpen] = useState(false)
  const workflowTriggerRef = useRef<HTMLButtonElement | null>(null)
  const [tagInputValue, setTagInputValue] = useState("")

  const selectedWorkflowStatus =
    form.workflowStatusId === null
      ? null
      : (workflowStatuses.find((status) => status.id === form.workflowStatusId) ?? null)

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

  useEffect(() => {
    if (categoryPickerOpen) {
      window.setTimeout(() => categoryInputRef.current?.focus(), 0)
    }
  }, [categoryPickerOpen])

  useEffect(() => {
    if (tagPickerOpen) {
      window.setTimeout(() => tagInputRef.current?.focus(), 0)
    }
  }, [tagPickerOpen])

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

  const handleTagInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault()
      closeTagDropdown()
      return
    }
    if (event.key !== "Enter") {
      return
    }
    const label = tagInputValue.trim()
    if (label === "") {
      return
    }
    event.preventDefault()
    const matchingTag = filteredTagOptions.find(
      (tag) => normalizeLabel(tag.label) === normalizeLabel(label),
    )
    addTagLabel(matchingTag?.label ?? label)
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

            <Popup
              anchorRef={categoryTriggerRef}
              open={categoryPickerOpen}
              onClose={closeCategoryDropdown}
              placement={["top-start", "top-end", "bottom-start", "bottom-end"]}
              offset={6}
              role="dialog"
            >
              <div className={styles.categoryPanel}>
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
                    <div className={styles.categoryEmpty}>No categories yet</div>
                  )}
                </div>
                <input
                  ref={categoryInputRef}
                  type="text"
                  className={styles.categoryInput}
                  placeholder="Enter new..."
                  value={categoryInputValue}
                  disabled={!userPresent || createCategoryPending}
                  onChange={(event) => {
                    onCategoryInputValueChange(toLowercaseInput(event.currentTarget.value))
                  }}
                  onKeyDown={handleCategoryInputKeyDown}
                />
              </div>
            </Popup>
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
                {form.workflowStatusId === null ? (
                  <button
                    type="button"
                    className={styles.moreMenuItem}
                    onClick={() => {
                      closeMoreDropdown()
                      onAddToBoard()
                    }}
                    disabled={!userPresent || workflowStatuses.length === 0}
                    role="menuitem"
                  >
                    <span>Add to board</span>
                  </button>
                ) : (
                  <>
                    <button
                      ref={workflowTriggerRef}
                      type="button"
                      className={styles.moreMenuItem}
                      onClick={() => setWorkflowPickerOpen((open) => !open)}
                      disabled={!userPresent}
                      aria-expanded={workflowPickerOpen}
                      aria-haspopup="dialog"
                      role="menuitem"
                    >
                      <span>Board: {selectedWorkflowStatus?.label ?? "column"}</span>
                      <CaretDown size={12} weight="regular" />
                    </button>
                    <Popup
                      anchorRef={workflowTriggerRef}
                      open={workflowPickerOpen}
                      onClose={() => setWorkflowPickerOpen(false)}
                      placement={["left-start", "right-start", "top-start", "bottom-start"]}
                      offset={6}
                      role="dialog"
                    >
                      <div className={styles.categoryPanel}>
                        <div
                          className={styles.categoryOptions}
                          role="listbox"
                          aria-label="Board column options"
                        >
                          {workflowStatuses.map((status) => (
                            <button
                              key={status.id}
                              type="button"
                              className={styles.categoryOption}
                              data-active={form.workflowStatusId === status.id || undefined}
                              onClick={() => {
                                onSelectWorkflowStatusId(status.id)
                                setWorkflowPickerOpen(false)
                                closeMoreDropdown()
                              }}
                              role="option"
                              aria-selected={form.workflowStatusId === status.id}
                            >
                              {status.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    </Popup>
                    <button
                      type="button"
                      className={styles.moreMenuItem}
                      onClick={() => {
                        closeMoreDropdown()
                        onRemoveFromBoard()
                      }}
                      disabled={!userPresent}
                      role="menuitem"
                    >
                      <span>Remove from board</span>
                    </button>
                  </>
                )}
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
                <Popup
                  anchorRef={tagTriggerRef}
                  open={tagPickerOpen}
                  onClose={closeTagDropdown}
                  placement={["left-start", "right-start", "top-start", "bottom-start"]}
                  offset={6}
                  role="dialog"
                >
                  <div className={styles.categoryPanel}>
                    <div className={styles.categoryOptions} role="listbox" aria-label="Tag options">
                      {filteredTagOptions.length === 0 && tagInputValue.trim() !== "" ? (
                        <div className={styles.categoryEmpty}>
                          Press Enter to create &quot;{tagInputValue.trim()}&quot;
                        </div>
                      ) : (
                        filteredTagOptions.map((tag) => (
                          <button
                            key={tag.id}
                            type="button"
                            className={styles.categoryOption}
                            onClick={() => addTagLabel(tag.label)}
                            role="option"
                            aria-selected={false}
                          >
                            {tag.label}
                          </button>
                        ))
                      )}
                      {filteredTagOptions.length === 0 && tagInputValue.trim() === "" && (
                        <div className={styles.categoryEmpty}>No more tags.</div>
                      )}
                    </div>
                    <input
                      ref={tagInputRef}
                      type="text"
                      className={styles.categoryInput}
                      placeholder="Enter new..."
                      value={tagInputValue}
                      disabled={!userPresent || createTagPending}
                      onChange={(event) => {
                        setTagInputValue(toLowercaseInput(event.currentTarget.value))
                      }}
                      onKeyDown={handleTagInputKeyDown}
                    />
                  </div>
                </Popup>
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
