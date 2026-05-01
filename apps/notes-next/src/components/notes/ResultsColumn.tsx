"use client"

import type { CategoryRecord, NoteRecord, TagRecord } from "@lib/db-marketing"
import {
  ArrowsLeftRight,
  DotsThreeVertical,
  PencilSimple,
  Plus,
  SidebarSimple,
  Trash,
  X,
} from "@phosphor-icons/react"
import { Button, Popup, Text, TextInput } from "@gravity-ui/uikit"
import { normalizeLabel, toLowercaseInput } from "@/lib/strings"
import {
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { useNotesAppStore } from "@/stores/notesAppStore"
import { NoteResultsList, type DisplayNoteItem } from "./NoteResultsList"
import styles from "./ResultsColumn.module.css"

const ALL_TAGS_EXPANDED_ID = "all-tags"

type ExpandedTagId = number | typeof ALL_TAGS_EXPANDED_ID

type MovePickerState =
  | {
      kind: "category"
      id: string
      note: NoteRecord
    }
  | {
      kind: "tag"
      id: string
      note: NoteRecord
      fromTagId: number
    }

export interface CategoryNoteGroup {
  category: CategoryRecord
  items: DisplayNoteItem[]
  sortTime: number
}

export interface TagNoteGroup {
  tag: TagRecord
  items: DisplayNoteItem[]
  sortTime: number
}

interface ResultsColumnProps {
  visible: boolean
  columnStyle: CSSProperties
  tags: TagRecord[]
  notesCount: number
  notesLoading: boolean
  categories: CategoryRecord[]
  fallbackCategoryId: number | null
  selectedTag: TagRecord | null
  searchMode: boolean
  searchItems: DisplayNoteItem[]
  searchLoading: boolean
  allCategoryItems: DisplayNoteItem[]
  allCategoriesNoteCount: number
  categoryNoteGroups: CategoryNoteGroup[]
  allTagItems: DisplayNoteItem[]
  tagNoteGroups: TagNoteGroup[]
  activeNoteId: number | null
  activeCategoryId: number | null
  onEditNote: (note: NoteRecord) => void
  onAddNoteForCategory: (category: CategoryRecord) => void
  onAddNoteForTag: (tag: TagRecord) => void
  onMoveNoteCategory: (note: NoteRecord, categoryLabel: string) => void | Promise<void>
  onMoveNoteTag: (note: NoteRecord, fromTagId: number, tagLabel: string) => void | Promise<void>
  onEditCategory: (category: CategoryRecord) => void
  onDeleteCategory: (category: CategoryRecord) => void
  onEditTag: (tag: TagRecord) => void
  onDeleteTag: (tag: TagRecord) => void
  onClose: () => void
}

export function ResultsColumn({
  visible,
  columnStyle,
  tags,
  notesCount,
  notesLoading,
  categories,
  fallbackCategoryId,
  selectedTag,
  searchMode,
  searchItems,
  searchLoading,
  allCategoryItems,
  allCategoriesNoteCount,
  categoryNoteGroups,
  allTagItems,
  tagNoteGroups,
  activeNoteId,
  activeCategoryId,
  onEditNote,
  onAddNoteForCategory,
  onAddNoteForTag,
  onMoveNoteCategory,
  onMoveNoteTag,
  onEditCategory,
  onDeleteCategory,
  onEditTag,
  onDeleteTag,
  onClose,
}: ResultsColumnProps) {
  const [expandedTagId, setExpandedTagId] = useState<ExpandedTagId | null>(null)
  const [openActionMenuId, setOpenActionMenuId] = useState<string | null>(null)
  const [activeMovePicker, setActiveMovePicker] = useState<MovePickerState | null>(null)
  const actionMenuRootRef = useRef<HTMLDivElement>(null)
  const {
    manuallyExpandedCategoryId,
    setManuallyExpandedCategoryId,
    selectedTagId,
    setSelectedTagId,
    searchQuery,
    setSearchQuery,
  } = useNotesAppStore()
  const trimmedSearchQuery = searchQuery.trim()
  const visibleCategoryNoteGroups = categoryNoteGroups.filter(
    ({ category }) =>
      category.id === activeCategoryId || !(category.id === 1 && category.noteCount === 0),
  )

  useEffect(() => {
    if (manuallyExpandedCategoryId === null) {
      return
    }

    if (manuallyExpandedCategoryId === activeCategoryId) {
      setManuallyExpandedCategoryId(null)
      return
    }

    if (categories.some((category) => category.id === manuallyExpandedCategoryId)) {
      return
    }

    setManuallyExpandedCategoryId(null)
  }, [activeCategoryId, categories, manuallyExpandedCategoryId, setManuallyExpandedCategoryId])

  useEffect(() => {
    setExpandedTagId((current) => {
      if (current === null) {
        return current
      }

      if (current === ALL_TAGS_EXPANDED_ID) {
        return current
      }

      if (tags.some((tag) => tag.id === current)) {
        return current
      }

      return null
    })
  }, [tags])

  useEffect(() => {
    if (selectedTagId === null) {
      return
    }

    if (tags.some((tag) => tag.id === selectedTagId)) {
      setExpandedTagId(selectedTagId)
    } else {
      setSelectedTagId(null)
    }
  }, [selectedTagId, setSelectedTagId, tags])

  useEffect(() => {
    if (openActionMenuId === null) {
      return
    }

    const handlePointerDown = (event: globalThis.MouseEvent) => {
      if (!actionMenuRootRef.current?.contains(event.target as Node)) {
        setOpenActionMenuId(null)
      }
    }
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpenActionMenuId(null)
      }
    }

    document.addEventListener("mousedown", handlePointerDown)
    document.addEventListener("keydown", handleKeyDown)
    return () => {
      document.removeEventListener("mousedown", handlePointerDown)
      document.removeEventListener("keydown", handleKeyDown)
    }
  }, [openActionMenuId])

  const getFilteredNoteCount = (category: CategoryRecord, items: DisplayNoteItem[]) =>
    selectedTag === null ? category.noteCount : items.length

  const toggleCategory = (categoryId: number) => {
    setOpenActionMenuId(null)
    setActiveMovePicker(null)
    if (categoryId === activeCategoryId) {
      return
    }
    setManuallyExpandedCategoryId(manuallyExpandedCategoryId === categoryId ? null : categoryId)
  }

  const toggleTag = (tagId: ExpandedTagId) => {
    setOpenActionMenuId(null)
    setActiveMovePicker(null)

    if (expandedTagId === tagId) {
      setExpandedTagId(null)
      if (tagId !== ALL_TAGS_EXPANDED_ID && selectedTagId === tagId) {
        setSelectedTagId(null)
      }
      return
    }

    setExpandedTagId(tagId)
    setSelectedTagId(tagId === ALL_TAGS_EXPANDED_ID ? null : tagId)
  }

  const handleResultEdit = (note: NoteRecord) => {
    onEditNote(note)
  }

  const closeMovePicker = () => {
    setActiveMovePicker(null)
  }

  const openCategoryMovePicker = (note: NoteRecord, categoryId: number) => {
    setOpenActionMenuId(null)
    setActiveMovePicker({
      kind: "category",
      note,
      id: `category-${categoryId}-note-${note.id}`,
    })
  }

  const openTagMovePicker = (note: NoteRecord, tagId: number) => {
    setOpenActionMenuId(null)
    setActiveMovePicker({
      kind: "tag",
      note,
      fromTagId: tagId,
      id: `tag-${tagId}-note-${note.id}`,
    })
  }

  const renderMovePicker = (note: NoteRecord, pickerId: string) => {
    if (activeMovePicker?.note.id !== note.id || activeMovePicker.id !== pickerId) {
      return null
    }

    if (activeMovePicker.kind === "category") {
      return (
        <NoteMovePicker
          mode="category"
          options={categories}
          currentOptionIds={[note.category.id]}
          inputPlaceholder="Enter new..."
          emptyMessage="No other categories."
          onClose={closeMovePicker}
          onSelect={(label) => onMoveNoteCategory(note, label)}
        />
      )
    }

    return (
      <NoteMovePicker
        mode="tag"
        options={tags}
        currentOptionIds={[activeMovePicker.fromTagId]}
        inputPlaceholder="Enter new..."
        emptyMessage="No other tags."
        onClose={closeMovePicker}
        onSelect={(label) => onMoveNoteTag(note, activeMovePicker.fromTagId, label)}
      />
    )
  }

  return (
    <div
      className={`${styles.resultsColumnShell} ${
        visible ? styles.resultsColumnShellOpen : styles.resultsColumnShellCollapsed
      }`}
    >
      <section className={styles.resultsColumn} style={columnStyle}>
        <div className={`${styles.header} ${styles.headerRight}`}>
          <div className={styles.resultsColumnHeaderSearch}>
            <TextInput
              size="l"
              placeholder="AI Search"
              value={searchQuery}
              onUpdate={(value) => setSearchQuery(toLowercaseInput(value))}
              className={styles.searchInput}
            />
            {trimmedSearchQuery !== "" && (
              <button
                type="button"
                className={styles.searchClearButton}
                aria-label="Clear search"
                title="Clear search"
                onClick={() => setSearchQuery("")}
              >
                <X size={14} weight="bold" />
              </button>
            )}
          </div>
          <Button
            view="flat"
            size="m"
            onClick={onClose}
            aria-label="Hide notes list"
            title="Hide notes list"
            className={styles.resultsColumnCloseButton}
          >
            <SidebarSimple size={18} weight="regular" className={styles.headerIcon} />
          </Button>
        </div>
        <div className={styles.noteResults} ref={actionMenuRootRef}>
          {searchMode && (
            <div className={styles.searchResultsSection}>
              <div className={styles.accordionHeading}>Search Results</div>
              <NoteResultsList
                items={searchItems}
                activeNoteId={activeNoteId}
                loading={searchLoading || notesLoading}
                emptyMessage={
                  selectedTag
                    ? `No search results in “${selectedTag.label}”.`
                    : "No search results."
                }
                onEdit={handleResultEdit}
              />
            </div>
          )}
          <div className={styles.categoryAccordion} role="list" aria-label="Notes by category">
            <div className={styles.accordionHeading}>Categories</div>
            {notesLoading ? (
              <div className={styles.categoryAccordionStatus}>
                <Text variant="body-1" color="secondary">
                  Loading…
                </Text>
              </div>
            ) : categories.length === 0 ? (
              <div className={styles.categoryAccordionStatus}>
                <Text variant="body-1" color="secondary">
                  No categories yet.
                </Text>
              </div>
            ) : (
              <>
                {visibleCategoryNoteGroups.map(({ category, items }) => {
                  const expanded =
                    activeCategoryId === category.id || manuallyExpandedCategoryId === category.id
                  const panelId = `category-notes-${category.id}`
                  const deleteDisabled = category.id === fallbackCategoryId
                  const addNoteActive = activeNoteId === null && activeCategoryId === category.id

                  return (
                    <div className={styles.categoryGroup} key={category.id} role="listitem">
                      <div className={styles.categoryRow}>
                        <button
                          type="button"
                          className={styles.categoryToggle}
                          aria-expanded={expanded}
                          aria-controls={panelId}
                          onClick={() => toggleCategory(category.id)}
                        >
                          <SectionTitle
                            count={getFilteredNoteCount(category, items)}
                            label={category.label}
                            active={activeCategoryId === category.id}
                          />
                        </button>
                        <SectionActionMenu
                          id={`category-${category.id}`}
                          label={category.label}
                          openActionMenuId={openActionMenuId}
                          onOpenActionMenuChange={setOpenActionMenuId}
                          onEdit={() => onEditCategory(category)}
                          onDelete={() => onDeleteCategory(category)}
                          deleteDisabled={deleteDisabled}
                          deleteTitle={
                            deleteDisabled ? "The default category cannot be deleted" : undefined
                          }
                        />
                      </div>
                      {expanded && (
                        <div id={panelId} className={styles.categoryPanel}>
                          <SectionAddNoteButton
                            label={`Add note in ${category.label}`}
                            active={addNoteActive}
                            onClick={() => onAddNoteForCategory(category)}
                          />
                          {items.length > 0 && (
                            <NoteResultsList
                              items={items}
                              activeNoteId={activeNoteId}
                              loading={false}
                              emptyMessage=""
                              onEdit={handleResultEdit}
                              renderAction={(note) => {
                                const pickerId = `category-${category.id}-note-${note.id}`
                                return (
                                  <NoteMoveAction
                                    active={activeMovePicker?.id === pickerId}
                                    label={`Move note from ${category.label} to another category`}
                                    onClose={closeMovePicker}
                                    onClick={() => openCategoryMovePicker(note, category.id)}
                                  >
                                    {renderMovePicker(note, pickerId)}
                                  </NoteMoveAction>
                                )
                              }}
                            />
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </>
            )}
          </div>
          {!notesLoading && (
            <div className={styles.tagAccordion} role="list" aria-label="Notes by tag">
              <div className={styles.accordionHeading}>Tags</div>

              {/* <div className={styles.categoryGroup} role="listitem">
                <div className={styles.categoryRow}>
                  <button
                    type="button"
                    className={styles.categoryToggle}
                    aria-expanded={expandedTagId === ALL_TAGS_EXPANDED_ID}
                    aria-controls="tag-notes-all"
                    onClick={() => toggleTag(ALL_TAGS_EXPANDED_ID)}
                  >
                    <SectionTitle count={notesCount} label="all tags" />
                  </button>
                </div>
                {expandedTagId === ALL_TAGS_EXPANDED_ID && (
                  <div id="tag-notes-all" className={styles.categoryPanel}>
                    <NoteResultsList
                      items={allTagItems}
                      activeNoteId={activeNoteId}
                      loading={false}
                      emptyMessage="No notes yet."
                      onEdit={onEditNote}
                    />
                  </div>
                )}
              </div> */}

              {tagNoteGroups.map(({ tag, items }) => {
                const expanded = expandedTagId === tag.id
                const panelId = `tag-notes-${tag.id}`

                return (
                  <div className={styles.categoryGroup} key={tag.id} role="listitem">
                    <div className={styles.categoryRow}>
                      <button
                        type="button"
                        className={styles.categoryToggle}
                        aria-expanded={expanded}
                        aria-controls={panelId}
                        onClick={() => toggleTag(tag.id)}
                      >
                        <SectionTitle count={tag.noteCount} label={tag.label} />
                      </button>
                      <SectionActionMenu
                        id={`tag-${tag.id}`}
                        label={tag.label}
                        openActionMenuId={openActionMenuId}
                        onOpenActionMenuChange={setOpenActionMenuId}
                        onEdit={() => onEditTag(tag)}
                        onDelete={() => onDeleteTag(tag)}
                      />
                    </div>
                    {expanded && (
                      <div id={panelId} className={styles.categoryPanel}>
                        <SectionAddNoteButton
                          label={`Add note tagged ${tag.label}`}
                          onClick={() => onAddNoteForTag(tag)}
                        />
                        {items.length > 0 && (
                          <NoteResultsList
                            items={items}
                            activeNoteId={activeNoteId}
                            loading={false}
                            emptyMessage=""
                            onEdit={handleResultEdit}
                            renderAction={(note) => {
                              const pickerId = `tag-${tag.id}-note-${note.id}`
                              return (
                                <NoteMoveAction
                                  active={activeMovePicker?.id === pickerId}
                                  label={`Move note from ${tag.label} to another tag`}
                                  onClose={closeMovePicker}
                                  onClick={() => openTagMovePicker(note, tag.id)}
                                >
                                  {renderMovePicker(note, pickerId)}
                                </NoteMoveAction>
                              )
                            }}
                          />
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
              {tags.length === 0 && (
                <div className={styles.categoryAccordionStatus}>
                  <Text variant="body-1" color="secondary">
                    No tags yet. Create one from the note form.
                  </Text>
                </div>
              )}
            </div>
          )}
        </div>
      </section>
    </div>
  )
}

interface SectionAddNoteButtonProps {
  label: string
  active?: boolean
  onClick: () => void
}

function SectionAddNoteButton({ label, active = false, onClick }: SectionAddNoteButtonProps) {
  return (
    <button
      type="button"
      className={`${styles.sectionAddNoteButton} ${active ? styles.sectionAddNoteButtonActive : ""}`}
      onClick={onClick}
      aria-label={label}
      aria-current={active ? "true" : undefined}
    >
      <Plus size={13} weight="regular" />
      <span>Add note</span>
    </button>
  )
}

interface SectionTitleProps {
  count: number
  label: string
  active?: boolean
}

function SectionTitle({ count, label, active = false }: SectionTitleProps) {
  return (
    <span className={styles.categoryLabel}>
      {/* <span className={styles.categoryCountText}>{count}</span>
      <sub className={styles.categoryPreposition}>in</sub> */}
      <span className={`${styles.categoryNameText} ${active ? styles.categoryNameTextActive : ""}`}>
        {label} <sup className={styles.categoryCountTextSup}>{count}</sup>
      </span>
    </span>
  )
}

interface SectionActionMenuProps {
  id: string
  label: string
  openActionMenuId: string | null
  onOpenActionMenuChange: (id: string | null) => void
  onEdit: () => void
  onDelete: () => void
  deleteDisabled?: boolean
  deleteTitle?: string
}

function SectionActionMenu({
  id,
  label,
  openActionMenuId,
  onOpenActionMenuChange,
  onEdit,
  onDelete,
  deleteDisabled = false,
  deleteTitle,
}: SectionActionMenuProps) {
  const open = openActionMenuId === id

  const handleMenuButtonClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    onOpenActionMenuChange(open ? null : id)
  }

  return (
    <div className={styles.categoryActionWrap} onClick={(event) => event.stopPropagation()}>
      <Button
        view="flat"
        size="xs"
        onClick={handleMenuButtonClick}
        aria-label={`More options for ${label}`}
        aria-haspopup="menu"
        aria-expanded={open}
        className={styles.categoryActionButton}
      >
        <DotsThreeVertical size={16} weight="bold" />
      </Button>
      {open && (
        <div className={styles.categoryActionMenu} role="menu">
          <button
            type="button"
            className={styles.categoryActionMenuItem}
            role="menuitem"
            onClick={() => {
              onOpenActionMenuChange(null)
              onEdit()
            }}
          >
            <PencilSimple size={14} weight="regular" />
            <span>Edit</span>
          </button>
          <button
            type="button"
            className={`${styles.categoryActionMenuItem} ${styles.categoryActionMenuItemDanger}`}
            role="menuitem"
            disabled={deleteDisabled}
            title={deleteTitle}
            onClick={() => {
              onOpenActionMenuChange(null)
              onDelete()
            }}
          >
            <Trash size={14} weight="regular" />
            <span>Delete</span>
          </button>
        </div>
      )}
    </div>
  )
}

interface NoteMoveActionProps {
  active: boolean
  label: string
  onClick: () => void
  onClose: () => void
  children: ReactNode
}

function NoteMoveAction({ active, label, onClick, onClose, children }: NoteMoveActionProps) {
  const buttonRef = useRef<HTMLButtonElement>(null)

  return (
    <div className={styles.noteMoveActionWrap} onClick={(event) => event.stopPropagation()}>
      <button
        ref={buttonRef}
        type="button"
        className={styles.noteMoveActionButton}
        onClick={onClick}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={active}
        title={label}
      >
        <ArrowsLeftRight size={14} weight="regular" />
      </button>
      <Popup
        anchorRef={buttonRef}
        open={active}
        onClose={onClose}
        placement={["bottom-end", "top-end", "bottom-start", "top-start"]}
        offset={6}
      >
        {children}
      </Popup>
    </div>
  )
}

interface NoteMovePickerProps {
  mode: "category" | "tag"
  options: Array<CategoryRecord | TagRecord>
  currentOptionIds: number[]
  inputPlaceholder: string
  emptyMessage: string
  onClose: () => void
  onSelect: (label: string) => void | Promise<void>
}

function NoteMovePicker({
  mode,
  options,
  currentOptionIds,
  inputPlaceholder,
  emptyMessage,
  onClose,
  onSelect,
}: NoteMovePickerProps) {
  const [inputValue, setInputValue] = useState("")
  const [pending, setPending] = useState(false)
  const currentOptionIdSet = useMemo(() => new Set(currentOptionIds), [currentOptionIds])
  const filteredOptions = useMemo(() => {
    const query = normalizeLabel(inputValue)

    return options.filter((option) => {
      if (currentOptionIdSet.has(option.id)) {
        return false
      }

      const normalized = normalizeLabel(option.label)
      return query === "" || normalized.includes(query)
    })
  }, [currentOptionIdSet, inputValue, options])

  const submitLabel = (rawLabel: string) => {
    const label = rawLabel.trim()
    if (label === "" || pending) {
      return
    }

    void (async () => {
      setPending(true)
      try {
        await onSelect(label)
        onClose()
      } finally {
        setPending(false)
      }
    })()
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault()
      onClose()
      return
    }
    if (event.key !== "Enter") {
      return
    }

    event.preventDefault()
    const label = inputValue.trim()
    if (label === "") {
      return
    }
    const matchingOption = options.find(
      (option) => normalizeLabel(option.label) === normalizeLabel(label),
    )
    submitLabel(matchingOption?.label ?? label)
  }

  return (
    <div
      className={styles.noteMovePicker}
      role="dialog"
      aria-label={`Move note to ${mode === "category" ? "category" : "tag"}`}
      onClick={(event) => event.stopPropagation()}
    >
      <div
        className={styles.noteMovePickerOptions}
        role="listbox"
        aria-label={mode === "category" ? "Category options" : "Tag options"}
      >
        {filteredOptions.length === 0 && inputValue.trim() !== "" ? (
          <div className={styles.noteMovePickerEmpty}>
            Press Enter to create &quot;{inputValue.trim()}&quot;
          </div>
        ) : (
          filteredOptions.map((option) => (
            <button
              key={option.id}
              type="button"
              className={styles.noteMovePickerOption}
              disabled={pending}
              onClick={() => submitLabel(option.label)}
              role="option"
              aria-selected={false}
            >
              {option.label}
            </button>
          ))
        )}
        {filteredOptions.length === 0 && inputValue.trim() === "" && (
          <div className={styles.noteMovePickerEmpty}>{emptyMessage}</div>
        )}
      </div>
      <input
        type="text"
        className={styles.noteMovePickerInput}
        placeholder={inputPlaceholder}
        value={inputValue}
        disabled={pending}
        onChange={(event) => setInputValue(toLowercaseInput(event.currentTarget.value))}
        onKeyDown={handleKeyDown}
      />
    </div>
  )
}
