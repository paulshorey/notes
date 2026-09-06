"use client"

import dynamic from "next/dynamic"
import { Button, Popup, Text } from "@gravity-ui/uikit"
import { FilterablePickerPopup } from "@/components/ui/FilterablePickerPopup"
import { CalendarBlank, CaretDown, DotsThree, Plus, X } from "@phosphor-icons/react"
import {
  type Dispatch,
  type KeyboardEvent,
  type SetStateAction,
  useMemo,
  useRef,
  useState,
} from "react"
import type { TagRecord } from "@lib/db-notes"
import {
  TAXONOMY_LEVEL_CATEGORY,
  TAXONOMY_LEVEL_EPIC,
  TAXONOMY_LEVEL_GROUP,
} from "@lib/db-notes/contracts/notes-app"
import {
  childrenOfLevel,
  defaultNodeLabel,
  epicsOf,
  pathForGroup,
  type TaxonomyIndex,
} from "@/lib/taxonomyIndex"
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

type TaxonomyPickerKind = "epic" | "category" | "group"

interface NoteFormProps {
  form: NoteFormState
  setForm: Dispatch<SetStateAction<NoteFormState>>
  editingNoteId: number | null
  userPresent: boolean
  pasteUrlAsMarkdown?: boolean
  taxonomyIndex: TaxonomyIndex
  taxonomyLabels: { epic: string; category: string; group: string; note: string }
  tags: TagRecord[]
  pendingTagLabels: string[]
  descriptionEditorSessionId: string | number
  editorAutofocus: boolean
  editorRevealText?: string | null
  createTaxonomyPending: boolean
  createTagPending: boolean
  onSelectEpicId: (id: number) => void
  onSelectCategoryId: (id: number) => void
  onSelectGroupId: (id: number) => void
  onCreateEpic: (label: string) => void | Promise<void>
  onCreateCategory: (label: string) => void | Promise<void>
  onCreateGroup: (label: string) => void | Promise<void>
  onTagValuesChange: (values: string[]) => void
  onCancelEdit: () => void
  onDeleteEditingNote: () => void
  onAddNote: () => void
}

export function NoteForm({
  form,
  setForm,
  editingNoteId,
  userPresent,
  pasteUrlAsMarkdown = false,
  taxonomyIndex,
  taxonomyLabels,
  tags,
  pendingTagLabels,
  descriptionEditorSessionId,
  editorAutofocus,
  editorRevealText = null,
  createTaxonomyPending,
  createTagPending,
  onSelectEpicId,
  onSelectCategoryId,
  onSelectGroupId,
  onCreateEpic,
  onCreateCategory,
  onCreateGroup,
  onTagValuesChange,
  onCancelEdit,
  onDeleteEditingNote,
  onAddNote,
}: NoteFormProps) {
  const tagTriggerRef = useRef<HTMLButtonElement | null>(null)
  const tagInputRef = useRef<HTMLInputElement | null>(null)
  const moreTriggerRef = useRef<HTMLButtonElement | null>(null)
  const [openTaxonomyPicker, setOpenTaxonomyPicker] = useState<TaxonomyPickerKind | null>(null)
  const [tagPickerOpen, setTagPickerOpen] = useState(false)
  const [morePickerOpen, setMorePickerOpen] = useState(false)
  const [tagInputValue, setTagInputValue] = useState("")

  const selectedPath = pathForGroup(taxonomyIndex, form.selectedGroupId)

  const epicOptions = useMemo(
    () => epicsOf(taxonomyIndex).map((epic) => ({ id: epic.id, label: epic.label })),
    [taxonomyIndex],
  )
  const categoryOptions = useMemo(() => {
    const epicId = selectedPath?.epic.id ?? null
    if (epicId === null) return []
    return childrenOfLevel(taxonomyIndex, epicId).map((row) => ({ id: row.id, label: row.label }))
  }, [selectedPath?.epic.id, taxonomyIndex])
  const groupOptions = useMemo(() => {
    const categoryId = selectedPath?.category.id ?? null
    if (categoryId === null) return []
    return childrenOfLevel(taxonomyIndex, categoryId).map((row) => ({
      id: row.id,
      label: row.label,
    }))
  }, [selectedPath?.category.id, taxonomyIndex])

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

  const closeTaxonomyPickers = () => setOpenTaxonomyPicker(null)

  const openTagDropdown = () => {
    setTagInputValue("")
    setTagPickerOpen(true)
    closeTaxonomyPickers()
    setMorePickerOpen(true)
  }

  const closeTagDropdown = () => {
    setTagPickerOpen(false)
    setTagInputValue("")
  }

  const closeMoreDropdown = () => {
    setMorePickerOpen(false)
    closeTagDropdown()
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
      {/* Notes save in the background, so there is no submit action. Enter in a
          date field would otherwise implicitly submit and reload the page. */}
      <form className={styles.form} onSubmit={(event) => event.preventDefault()}>
        <div className={styles.taxonomyBar}>
          <TaxonomyFieldPicker
            kind="epic"
            heading={taxonomyLabels.epic}
            options={epicOptions}
            selectedId={selectedPath?.epic.id ?? null}
            selectedLabel={selectedPath?.epic.label ?? defaultNodeLabel(TAXONOMY_LEVEL_EPIC)}
            open={openTaxonomyPicker === "epic"}
            onOpenChange={(open) => {
              setOpenTaxonomyPicker(open ? "epic" : null)
              if (open) {
                setTagPickerOpen(false)
                setMorePickerOpen(false)
              }
            }}
            disabled={!userPresent || createTaxonomyPending}
            onSelect={onSelectEpicId}
            onCreate={onCreateEpic}
          />
          <TaxonomyFieldPicker
            kind="category"
            heading={taxonomyLabels.category}
            options={categoryOptions}
            selectedId={selectedPath?.category.id ?? null}
            selectedLabel={
              selectedPath?.category.label ?? defaultNodeLabel(TAXONOMY_LEVEL_CATEGORY)
            }
            open={openTaxonomyPicker === "category"}
            onOpenChange={(open) => {
              setOpenTaxonomyPicker(open ? "category" : null)
              if (open) {
                setTagPickerOpen(false)
                setMorePickerOpen(false)
              }
            }}
            disabled={!userPresent || createTaxonomyPending}
            onSelect={onSelectCategoryId}
            onCreate={onCreateCategory}
          />
          <TaxonomyFieldPicker
            kind="group"
            heading={taxonomyLabels.group}
            options={groupOptions}
            selectedId={selectedPath?.group.id ?? null}
            selectedLabel={selectedPath?.group.label ?? defaultNodeLabel(TAXONOMY_LEVEL_GROUP)}
            open={openTaxonomyPicker === "group"}
            onOpenChange={(open) => {
              setOpenTaxonomyPicker(open ? "group" : null)
              if (open) {
                setTagPickerOpen(false)
                setMorePickerOpen(false)
              }
            }}
            disabled={!userPresent || createTaxonomyPending}
            onSelect={onSelectGroupId}
            onCreate={onCreateGroup}
          />
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
          pasteUrlAsMarkdown={pasteUrlAsMarkdown}
          placeholder="Write now, organize later..."
          value={form.description}
          onUpdate={(description) => setForm((prev) => ({ ...prev, description }))}
        />

        <div className={styles.formToolbar}>
          <button
            type="button"
            className={styles.addNoteButton}
            onClick={onAddNote}
            aria-label="Add new note"
          >
            <Plus size={16} weight="bold" aria-hidden />
          </button>
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
                closeTaxonomyPickers()
                setTagPickerOpen(false)
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

interface TaxonomyFieldPickerProps {
  kind: TaxonomyPickerKind
  heading: string
  options: Array<{ id: number; label: string }>
  selectedId: number | null
  selectedLabel: string
  open: boolean
  onOpenChange: (open: boolean) => void
  disabled: boolean
  onSelect: (id: number) => void
  onCreate: (label: string) => void | Promise<void>
}

function TaxonomyFieldPicker({
  kind,
  heading,
  options,
  selectedId,
  selectedLabel,
  open,
  onOpenChange,
  disabled,
  onSelect,
  onCreate,
}: TaxonomyFieldPickerProps) {
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [inputValue, setInputValue] = useState("")

  const filteredOptions = useMemo(() => {
    const query = normalizeLabel(inputValue)
    if (query === "") return options
    return options.filter((option) => normalizeLabel(option.label).includes(query))
  }, [inputValue, options])

  const openPicker = () => {
    setInputValue("")
    onOpenChange(true)
  }

  const closePicker = () => {
    onOpenChange(false)
    setInputValue("")
  }

  const selectOption = (id: number) => {
    onSelect(id)
    closePicker()
  }

  const submitInput = () => {
    const label = inputValue.trim()
    if (label === "") return
    const matching = options.find((option) => normalizeLabel(option.label) === normalizeLabel(label))
    if (matching) {
      selectOption(matching.id)
      return
    }
    if (filteredOptions.length === 0) {
      void (async () => {
        try {
          await onCreate(label)
        } finally {
          closePicker()
        }
      })()
    }
  }

  const handleInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault()
      closePicker()
      return
    }
    if (event.key !== "Enter") return
    event.preventDefault()
    submitInput()
  }

  return (
    <div className={styles.taxonomyPicker}>
      <div className={styles.taxonomyPickerHeading}>{heading}</div>
      <button
        ref={triggerRef}
        type="button"
        className={styles.taxonomyTrigger}
        onClick={open ? closePicker : openPicker}
        disabled={disabled}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`${heading}: ${selectedLabel}`}
        data-kind={kind}
      >
        <span className={styles.categoryTriggerLabel}>
          <span className={styles.categoryTriggerValue}>{selectedLabel}</span>
        </span>
        <CaretDown size={14} weight="regular" />
      </button>
      <FilterablePickerPopup
        anchorRef={triggerRef}
        open={open}
        onClose={closePicker}
        placement={["bottom-start", "bottom-end", "top-start", "top-end"]}
        listboxAriaLabel={`${heading} options`}
        options={filteredOptions}
        inputValue={inputValue}
        inputRef={inputRef}
        inputDisabled={disabled}
        onInputChange={(value) => setInputValue(toLowercaseInput(value))}
        onInputKeyDown={handleInputKeyDown}
        onInputSubmit={submitInput}
        onSelectOption={(option) => selectOption(Number(option.id))}
        isOptionActive={(option) => selectedId === Number(option.id)}
        isOptionSelected={(option) => selectedId === Number(option.id)}
        emptyWithoutQueryMessage={`No ${heading.toLowerCase()} yet`}
      />
    </div>
  )
}
