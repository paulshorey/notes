"use client"

import type { CategoryRecord, NoteRecord, TagRecord } from "@lib/db-marketing"
import {
  ArrowsLeftRight,
  DotsThreeVertical,
  PencilSimple,
  Plus,
  Trash,
} from "@phosphor-icons/react"
import { Button, Popup, Text } from "@gravity-ui/uikit"
import { firstLineLabel, normalizeLabel, toLowercaseInput } from "@/lib/strings"
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
  fallbackTagId: number | null
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
  activeTagIds: number[]
  onEditNote: (note: NoteRecord) => void
  onAddNoteForCategory: (category: CategoryRecord) => void
  onAddNoteForTag: (tag: TagRecord) => void
  onMoveNoteCategory: (note: NoteRecord, categoryLabel: string) => void | Promise<void>
  onMoveNoteTag: (note: NoteRecord, fromTagId: number, tagLabel: string) => void | Promise<void>
  onDeleteNote: (noteId: number) => void
  deletingNoteId: number | null
  onEditCategory: (category: CategoryRecord) => void
  onDeleteCategory: (category: CategoryRecord) => void
  onEditTag: (tag: TagRecord) => void
  onDeleteTag: (tag: TagRecord) => void
}

export function ResultsColumn({
  visible,
  columnStyle,
  tags,
  notesCount,
  notesLoading,
  categories,
  fallbackCategoryId,
  fallbackTagId,
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
  activeTagIds,
  onEditNote,
  onAddNoteForCategory,
  onAddNoteForTag,
  onMoveNoteCategory,
  onMoveNoteTag,
  onDeleteNote,
  deletingNoteId,
  onEditCategory,
  onDeleteCategory,
  onEditTag,
  onDeleteTag,
}: ResultsColumnProps) {
  const [expandedTagId, setExpandedTagId] = useState<ExpandedTagId | null>(null)
  const [openActionMenuId, setOpenActionMenuId] = useState<string | null>(null)
  const [activeMovePicker, setActiveMovePicker] = useState<MovePickerState | null>(null)
  const didExpandActiveCategoryOnLoadRef = useRef(false)
  const {
    manuallyExpandedCategoryId,
    setManuallyExpandedCategoryId,
    selectedTagId,
    setSelectedTagId,
  } = useNotesAppStore()
  const visibleCategoryNoteGroups = categoryNoteGroups

  useEffect(() => {
    if (didExpandActiveCategoryOnLoadRef.current) {
      return
    }

    if (activeCategoryId === null) {
      return
    }

    if (!categories.some((category) => category.id === activeCategoryId)) {
      return
    }

    didExpandActiveCategoryOnLoadRef.current = true
    setManuallyExpandedCategoryId(activeCategoryId)
  }, [activeCategoryId, categories, setManuallyExpandedCategoryId])

  useEffect(() => {
    if (manuallyExpandedCategoryId === null) {
      return
    }

    if (categories.some((category) => category.id === manuallyExpandedCategoryId)) {
      return
    }

    setManuallyExpandedCategoryId(null)
  }, [categories, manuallyExpandedCategoryId, setManuallyExpandedCategoryId])

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

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpenActionMenuId(null)
      }
    }

    document.addEventListener("keydown", handleKeyDown)
    return () => {
      document.removeEventListener("keydown", handleKeyDown)
    }
  }, [openActionMenuId])

  const getFilteredNoteCount = (category: CategoryRecord, items: DisplayNoteItem[]) =>
    selectedTag === null ? category.noteCount : items.length

  const isCategoryExpanded = (categoryId: number) => manuallyExpandedCategoryId === categoryId

  const toggleCategory = (categoryId: number) => {
    setOpenActionMenuId(null)
    setActiveMovePicker(null)
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

  const renderNoteRowAction = (
    note: NoteRecord,
    menuId: string,
    pickerId: string,
    onOpenMovePicker: () => void,
  ) => (
    <NoteActionMenu
      id={menuId}
      noteLabel={note.description?.trim() || "Untitled"}
      openActionMenuId={openActionMenuId}
      onOpenActionMenuChange={setOpenActionMenuId}
      onMove={onOpenMovePicker}
      onDelete={() => onDeleteNote(note.id)}
      deletePending={deletingNoteId === note.id}
      movePickerActive={activeMovePicker?.id === pickerId}
      movePickerContent={renderMovePicker(note, pickerId)}
      onCloseMovePicker={closeMovePicker}
    />
  )

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
        <div className={styles.noteResults}>
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
                  &ensp;No categories yet
                </Text>
              </div>
            ) : (
              <>
                {visibleCategoryNoteGroups.map(({ category, items }) => {
                  const expanded = isCategoryExpanded(category.id)
                  const panelId = `category-notes-${category.id}`
                  const deleteDisabled = category.id === fallbackCategoryId
                  return (
                    <div className={styles.categoryGroup} key={category.id} role="listitem">
                      <div className={styles.categoryRow}>
                        <SectionTitle
                          count={getFilteredNoteCount(category, items)}
                          label={category.label}
                          active={expanded}
                          selected={activeCategoryId === category.id}
                          expanded={expanded}
                          panelId={panelId}
                          onToggle={() => toggleCategory(category.id)}
                        >
                          <SectionAddNoteButton
                            label={`Add note in ${category.label}`}
                            active={expanded}
                            selected={activeCategoryId === category.id}
                            onClick={() => {
                              setManuallyExpandedCategoryId(category.id)
                              onAddNoteForCategory(category)
                            }}
                          />
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
                        </SectionTitle>
                      </div>
                      {expanded && items.length > 0 && (
                        <ScrollableNotesPanel id={panelId}>
                          <NoteResultsList
                            items={items}
                            activeNoteId={activeNoteId}
                            loading={false}
                            emptyMessage=""
                            onEdit={handleResultEdit}
                            renderAction={(note) =>
                              renderNoteRowAction(
                                note,
                                `category-${category.id}-note-${note.id}`,
                                `category-${category.id}-note-${note.id}`,
                                () => openCategoryMovePicker(note, category.id),
                              )
                            }
                          />
                        </ScrollableNotesPanel>
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

              {tagNoteGroups.map(({ tag, items }) => {
                const expanded = expandedTagId === tag.id
                const panelId = `tag-notes-${tag.id}`
                const deleteDisabled = tag.id === fallbackTagId

                return (
                  <div className={styles.categoryGroup} key={tag.id} role="listitem">
                    <div className={styles.categoryRow}>
                      <SectionTitle
                        count={tag.noteCount}
                        label={tag.label}
                        selected={activeTagIds.includes(tag.id)}
                        expanded={expanded}
                        panelId={panelId}
                        onToggle={() => toggleTag(tag.id)}
                      >
                        <SectionAddNoteButton
                          label={`Add note tagged ${tag.label}`}
                          selected={activeTagIds.includes(tag.id)}
                          onClick={() => onAddNoteForTag(tag)}
                        />
                        <SectionActionMenu
                          id={`tag-${tag.id}`}
                          label={tag.label}
                          openActionMenuId={openActionMenuId}
                          onOpenActionMenuChange={setOpenActionMenuId}
                          onEdit={() => onEditTag(tag)}
                          onDelete={() => onDeleteTag(tag)}
                          deleteDisabled={deleteDisabled}
                          deleteTitle={
                            deleteDisabled ? "The default tag cannot be deleted" : undefined
                          }
                        />
                      </SectionTitle>
                    </div>
                    {expanded && items.length > 0 && (
                      <ScrollableNotesPanel id={panelId}>
                        <NoteResultsList
                          items={items}
                          activeNoteId={activeNoteId}
                          loading={false}
                          emptyMessage=""
                          onEdit={handleResultEdit}
                          renderAction={(note) =>
                            renderNoteRowAction(
                              note,
                              `tag-${tag.id}-note-${note.id}`,
                              `tag-${tag.id}-note-${note.id}`,
                              () => openTagMovePicker(note, tag.id),
                            )
                          }
                        />
                      </ScrollableNotesPanel>
                    )}
                  </div>
                )
              })}
              {tags.length === 0 && (
                <div className={styles.categoryAccordionStatus}>
                  <Text variant="body-1" color="secondary">
                    &ensp;No tags yet
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

interface ScrollableNotesPanelProps {
  id: string
  children: ReactNode
}

function ScrollableNotesPanel({ id, children }: ScrollableNotesPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [canScrollDown, setCanScrollDown] = useState(false)

  useEffect(() => {
    const element = scrollRef.current
    if (element === null) {
      return
    }

    const updateOverflow = () => {
      const remaining = element.scrollHeight - element.scrollTop - element.clientHeight
      setCanScrollDown(remaining > 2)
    }

    updateOverflow()
    element.addEventListener("scroll", updateOverflow, { passive: true })

    const resizeObserver = new ResizeObserver(updateOverflow)
    resizeObserver.observe(element)
    const content = element.firstElementChild
    if (content !== null) {
      resizeObserver.observe(content)
    }

    const mutationObserver = new MutationObserver(() => {
      const nextContent = element.firstElementChild
      if (nextContent !== null) {
        resizeObserver.observe(nextContent)
      }
      updateOverflow()
    })
    mutationObserver.observe(element, { childList: true, subtree: true })

    return () => {
      element.removeEventListener("scroll", updateOverflow)
      resizeObserver.disconnect()
      mutationObserver.disconnect()
    }
  }, [])

  return (
    <div className={styles.categoryResults}>
      <div id={id} ref={scrollRef} className={styles.categoryResultsScroll}>
        {children}
      </div>
      {canScrollDown && (
        <div className={styles.categoryResultsFade} aria-hidden="true">
          <span className={styles.categoryResultsMoreHint}>...</span>
        </div>
      )}
    </div>
  )
}

interface SectionAddNoteButtonProps {
  label: string
  active?: boolean
  selected?: boolean
  onClick: () => void
}

function SectionAddNoteButton({
  label,
  active = false,
  selected = false,
  onClick,
}: SectionAddNoteButtonProps) {
  return (
    <button
      type="button"
      className={`${styles.sectionAddNoteButton} ${active ? styles.sectionAddNoteButtonActive : ""} ${selected ? styles.sectionAddNoteButtonSelected : ""}`}
      onClick={(event) => {
        event.stopPropagation()
        onClick()
      }}
      aria-label={label}
      aria-current={active ? "true" : undefined}
      title={label}
    >
      <Plus size={14} weight="regular" />
    </button>
  )
}

interface SectionTitleProps {
  count: number
  label: string
  active?: boolean
  selected?: boolean
  expanded: boolean
  panelId: string
  onToggle: () => void
  children: ReactNode
}

function SectionTitle({
  count,
  label,
  active = false,
  selected = false,
  expanded,
  panelId,
  onToggle,
  children,
}: SectionTitleProps) {
  return (
    <>
      <button
        type="button"
        className={styles.categoryToggle}
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={onToggle}
      >
        <span className={styles.categoryLabel}>
          {/* <span className={styles.categoryCountText}>{count}</span>
          <sub className={styles.categoryPreposition}>in</sub> */}
          <span
            className={`${styles.categoryNameText} ${active ? styles.categoryNameTextActive : ""} ${selected ? styles.categoryNameTextSelected : ""}`}
          >
            {label} <sup className={styles.categoryCountTextSup}>{count}</sup>
          </span>
        </span>
      </button>
      <div className={styles.sectionTitleActions}>{children}</div>
    </>
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
  const buttonRef = useRef<HTMLButtonElement>(null)

  const handleMenuButtonClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    onOpenActionMenuChange(open ? null : id)
  }

  return (
    <div className={styles.categoryActionWrap} onClick={(event) => event.stopPropagation()}>
      <Button
        ref={buttonRef}
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
      <Popup
        anchorRef={buttonRef}
        open={open}
        onClose={() => onOpenActionMenuChange(null)}
        placement={["bottom-end", "top-end", "bottom-start", "top-start"]}
        offset={2}
        role="menu"
      >
        <div className={styles.categoryActionMenu} onClick={(event) => event.stopPropagation()}>
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
      </Popup>
    </div>
  )
}

interface NoteActionMenuProps {
  id: string
  noteLabel: string
  openActionMenuId: string | null
  onOpenActionMenuChange: (id: string | null) => void
  onMove: () => void
  onDelete: () => void
  deletePending?: boolean
  movePickerActive: boolean
  movePickerContent: ReactNode
  onCloseMovePicker: () => void
}

function NoteActionMenu({
  id,
  noteLabel,
  openActionMenuId,
  onOpenActionMenuChange,
  onMove,
  onDelete,
  deletePending = false,
  movePickerActive,
  movePickerContent,
  onCloseMovePicker,
}: NoteActionMenuProps) {
  const open = openActionMenuId === id
  const buttonRef = useRef<HTMLButtonElement>(null)

  const handleMenuButtonClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    onOpenActionMenuChange(open ? null : id)
  }

  return (
    <div className={styles.categoryActionWrap} onClick={(event) => event.stopPropagation()}>
      <Button
        ref={buttonRef}
        view="flat"
        size="xs"
        onClick={handleMenuButtonClick}
        aria-label={`More options for ${firstLineLabel(noteLabel)}`}
        aria-haspopup="menu"
        aria-expanded={open}
        className={styles.categoryActionButton}
      >
        <DotsThreeVertical size={16} weight="bold" />
      </Button>
      <Popup
        anchorRef={buttonRef}
        open={open}
        onClose={() => onOpenActionMenuChange(null)}
        placement={["bottom-end", "top-end", "bottom-start", "top-start"]}
        offset={2}
        role="menu"
      >
        <div className={styles.categoryActionMenu} onClick={(event) => event.stopPropagation()}>
          <button
            type="button"
            className={styles.categoryActionMenuItem}
            role="menuitem"
            onClick={() => {
              onOpenActionMenuChange(null)
              onMove()
            }}
          >
            <ArrowsLeftRight size={14} weight="regular" />
            <span>Move</span>
          </button>
          <button
            type="button"
            className={`${styles.categoryActionMenuItem} ${styles.categoryActionMenuItemDanger}`}
            role="menuitem"
            disabled={deletePending}
            onClick={() => {
              onOpenActionMenuChange(null)
              onDelete()
            }}
          >
            <Trash size={14} weight="regular" />
            <span>Delete</span>
          </button>
        </div>
      </Popup>
      <Popup
        anchorRef={buttonRef}
        open={movePickerActive}
        onClose={onCloseMovePicker}
        placement={["bottom-end", "top-end", "bottom-start", "top-start"]}
        offset={6}
      >
        {movePickerContent}
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
