"use client"

import type { CategoryRecord, NoteRecord, StatusRecord, TagRecord } from "@lib/db-notes"
import {
  ArrowsLeftRight,
  CaretRight,
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
import type { OpenNoteKey } from "@/stores/openNotes"
import { NoteResultsList, type DisplayNoteItem } from "./NoteResultsList"
import styles from "./ResultsColumn.module.css"

type ResultsAccordionId = "search" | "categories" | "statuses" | "tags"

const addUniqueIds = (current: number[], ids: number[]) => {
  const missing = ids.filter((id) => !current.includes(id))
  return missing.length === 0 ? current : [...current, ...missing]
}

const toggleId = (current: number[], id: number) =>
  current.includes(id) ? current.filter((item) => item !== id) : [...current, id]

const retainValidIds = (current: number[], validIds: ReadonlySet<number>) => {
  const next = current.filter((id) => validIds.has(id))
  return next.length === current.length ? current : next
}

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
export interface StatusNoteGroup {
  status: StatusRecord
  items: DisplayNoteItem[]
}

interface ResultsColumnProps {
  visible: boolean
  columnStyle: CSSProperties
  tags: TagRecord[]
  notesLoading: boolean
  categories: CategoryRecord[]
  statuses: StatusRecord[]
  statusNoteGroups: StatusNoteGroup[]
  activeStatusId: number | null
  fallbackCategoryId: number | null
  fallbackTagId: number | null
  selectedTag: TagRecord | null
  searchMode: boolean
  searchItems: DisplayNoteItem[]
  searchLoading: boolean
  categoryNoteGroups: CategoryNoteGroup[]
  uncategorizedItems: DisplayNoteItem[]
  noStatusItems: DisplayNoteItem[]
  tagNoteGroups: TagNoteGroup[]
  activeNoteId: number | null
  /** Notes with an open entry, marked distinctly from the active one. */
  openNoteIds: number[]
  activeKey: OpenNoteKey | null
  activeCategoryIds: number[]
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
  notesLoading,
  categories,
  statuses,
  statusNoteGroups,
  activeStatusId,
  fallbackCategoryId,
  fallbackTagId,
  selectedTag,
  searchMode,
  searchItems,
  searchLoading,
  categoryNoteGroups,
  uncategorizedItems,
  noStatusItems,
  tagNoteGroups,
  activeNoteId,
  openNoteIds,
  activeKey,
  activeCategoryIds,
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
  const [expandedSection, setExpandedSection] = useState<ResultsAccordionId>(
    searchMode ? "search" : "categories",
  )
  const [expandedCategoryIds, setExpandedCategoryIds] = useState<number[]>([])
  const [expandedTagIds, setExpandedTagIds] = useState<number[]>([])
  const [expandedStatusIds, setExpandedStatusIds] = useState<number[]>([])
  const [uncategorizedExpanded, setUncategorizedExpanded] = useState(false)
  const [noStatusExpanded, setNoStatusExpanded] = useState(false)
  const [openActionMenuId, setOpenActionMenuId] = useState<string | null>(null)
  const [activeMovePicker, setActiveMovePicker] = useState<MovePickerState | null>(null)
  const prevActiveKeyRef = useRef<OpenNoteKey | null | undefined>(undefined)
  const prevCategoryIdsRef = useRef<number[]>([])
  const prevStatusIdRef = useRef<number | null | undefined>(undefined)
  const prevTagIdsRef = useRef<number[]>([])
  const visibleCategoryNoteGroups = categoryNoteGroups

  useEffect(() => {
    const validIds = new Set(categories.map((category) => category.id))
    setExpandedCategoryIds((current) => retainValidIds(current, validIds))
  }, [categories])

  useEffect(() => {
    const validIds = new Set(statuses.map((status) => status.id))
    setExpandedStatusIds((current) => retainValidIds(current, validIds))
  }, [statuses])

  useEffect(() => {
    const validIds = new Set(tags.map((tag) => tag.id))
    setExpandedTagIds((current) => retainValidIds(current, validIds))
  }, [tags])

  useEffect(() => {
    const noteChanged = prevActiveKeyRef.current !== activeKey

    if (noteChanged) {
      if (activeCategoryIds.length === 0) {
        setUncategorizedExpanded(true)
      } else {
        setExpandedCategoryIds((current) => addUniqueIds(current, activeCategoryIds))
      }

      if (activeStatusId === null) {
        setNoStatusExpanded(true)
      } else {
        setExpandedStatusIds((current) => addUniqueIds(current, [activeStatusId]))
      }

      if (activeTagIds.length > 0) {
        setExpandedTagIds((current) => addUniqueIds(current, activeTagIds))
      }
    } else {
      const addedCategoryIds = activeCategoryIds.filter(
        (id) => !prevCategoryIdsRef.current.includes(id),
      )
      if (addedCategoryIds.length > 0) {
        setExpandedCategoryIds((current) => addUniqueIds(current, addedCategoryIds))
      }

      if (activeStatusId !== prevStatusIdRef.current) {
        if (activeStatusId === null) {
          setNoStatusExpanded(true)
        } else {
          setExpandedStatusIds((current) => addUniqueIds(current, [activeStatusId]))
        }
      }

      const addedTagIds = activeTagIds.filter((id) => !prevTagIdsRef.current.includes(id))
      if (addedTagIds.length > 0) {
        setExpandedTagIds((current) => addUniqueIds(current, addedTagIds))
      }
    }

    prevActiveKeyRef.current = activeKey
    prevCategoryIdsRef.current = [...activeCategoryIds]
    prevStatusIdRef.current = activeStatusId
    prevTagIdsRef.current = [...activeTagIds]
  }, [activeCategoryIds, activeKey, activeStatusId, activeTagIds])

  useEffect(() => {
    if (searchMode) {
      setExpandedSection("search")
      return
    }

    setExpandedSection((current) => (current === "search" ? "categories" : current))
  }, [searchMode])

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

  const isCategoryExpanded = (categoryId: number) => expandedCategoryIds.includes(categoryId)

  const toggleCategory = (categoryId: number) => {
    setOpenActionMenuId(null)
    setActiveMovePicker(null)
    setExpandedCategoryIds((current) => toggleId(current, categoryId))
  }

  const toggleStatus = (statusId: number) => {
    setOpenActionMenuId(null)
    setActiveMovePicker(null)
    setExpandedStatusIds((current) => toggleId(current, statusId))
  }

  const toggleTag = (tagId: number) => {
    setOpenActionMenuId(null)
    setActiveMovePicker(null)
    setExpandedTagIds((current) => toggleId(current, tagId))
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
          currentOptionIds={note.categories.map((category) => category.id)}
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
            <AccordionSection
              id="search"
              title="Search Results"
              expanded={expandedSection === "search"}
              onExpand={() => setExpandedSection("search")}
            >
              <NoteResultsList
                items={searchItems}
                activeNoteId={activeNoteId}
                openNoteIds={openNoteIds}
                loading={searchLoading || notesLoading}
                emptyMessage={
                  selectedTag
                    ? `No search results in “${selectedTag.label}”.`
                    : "No search results."
                }
                onEdit={handleResultEdit}
              />
            </AccordionSection>
          )}
          <AccordionSection
            id="categories"
            title="Categories"
            expanded={expandedSection === "categories"}
            onExpand={() => setExpandedSection("categories")}
            contentRole="list"
            contentLabel="Notes by category"
          >
            {notesLoading ? (
              <div className={styles.accordionStatus}>
                <Text variant="body-1" color="secondary">
                  Loading…
                </Text>
              </div>
            ) : categories.length === 0 ? (
              <div className={styles.accordionStatus}>
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
                          selected={activeCategoryIds.includes(category.id)}
                          expanded={expanded}
                          panelId={panelId}
                          onToggle={() => toggleCategory(category.id)}
                        >
                          <SectionAddNoteButton
                            label={`Add note in ${category.label}`}
                            active={expanded}
                            selected={activeCategoryIds.includes(category.id)}
                            onClick={() => {
                              setExpandedCategoryIds((current) => addUniqueIds(current, [category.id]))
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
                            openNoteIds={openNoteIds}
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
            {!notesLoading && uncategorizedItems.length > 0 && (
              <div className={styles.categoryGroup} role="listitem">
                <div className={styles.categoryRow}>
                  <SectionTitle
                    count={uncategorizedItems.length}
                    label="No category"
                    expanded={uncategorizedExpanded}
                    panelId="uncategorized-notes"
                    onToggle={() => setUncategorizedExpanded((value) => !value)}
                  >
                    <span />
                  </SectionTitle>
                </div>
                {uncategorizedExpanded && (
                  <ScrollableNotesPanel id="uncategorized-notes">
                    <NoteResultsList
                      items={uncategorizedItems}
                      activeNoteId={activeNoteId}
                      openNoteIds={openNoteIds}
                      loading={false}
                      emptyMessage=""
                      onEdit={handleResultEdit}
                    />
                  </ScrollableNotesPanel>
                )}
              </div>
            )}
          </AccordionSection>
          <AccordionSection
            id="statuses"
            title="Statuses"
            expanded={expandedSection === "statuses"}
            onExpand={() => setExpandedSection("statuses")}
            contentRole="list"
            contentLabel="Notes by status"
          >
            {notesLoading ? (
              <div className={styles.accordionStatus}>
                <Text variant="body-1" color="secondary">
                  Loading…
                </Text>
              </div>
            ) : (
              <>
                {statusNoteGroups.map(({ status, items }) => {
                  const expanded = expandedStatusIds.includes(status.id)
                  const panelId = `status-notes-${status.id}`
                  return (
                    <div className={styles.categoryGroup} key={status.id} role="listitem">
                      <div className={styles.categoryRow}>
                        <SectionTitle
                          count={status.noteCount}
                          label={status.label}
                          selected={activeStatusId === status.id}
                          expanded={expanded}
                          panelId={panelId}
                          onToggle={() => toggleStatus(status.id)}
                        >
                          <span />
                        </SectionTitle>
                      </div>
                      {expanded && items.length > 0 && (
                        <ScrollableNotesPanel id={panelId}>
                          <NoteResultsList
                            items={items}
                            activeNoteId={activeNoteId}
                            openNoteIds={openNoteIds}
                            loading={false}
                            emptyMessage=""
                            onEdit={handleResultEdit}
                          />
                        </ScrollableNotesPanel>
                      )}
                    </div>
                  )
                })}
                {statuses.length === 0 && (
                  <div className={styles.accordionStatus}>
                    <Text variant="body-1" color="secondary">
                      &ensp;No statuses yet
                    </Text>
                  </div>
                )}
                {noStatusItems.length > 0 && (
                  <div className={styles.categoryGroup} role="listitem">
                    <div className={styles.categoryRow}>
                      <SectionTitle
                        count={noStatusItems.length}
                        label="No status"
                        selected={activeStatusId === null}
                        expanded={noStatusExpanded}
                        panelId="no-status-notes"
                        onToggle={() => setNoStatusExpanded((value) => !value)}
                      >
                        <span />
                      </SectionTitle>
                    </div>
                    {noStatusExpanded && (
                      <ScrollableNotesPanel id="no-status-notes">
                        <NoteResultsList
                          items={noStatusItems}
                          activeNoteId={activeNoteId}
                          openNoteIds={openNoteIds}
                          loading={false}
                          emptyMessage=""
                          onEdit={handleResultEdit}
                        />
                      </ScrollableNotesPanel>
                    )}
                  </div>
                )}
              </>
            )}
          </AccordionSection>
          <AccordionSection
            id="tags"
            title="Tags"
            expanded={expandedSection === "tags"}
            onExpand={() => setExpandedSection("tags")}
            contentRole="list"
            contentLabel="Notes by tag"
          >
            {notesLoading ? (
              <div className={styles.accordionStatus}>
                <Text variant="body-1" color="secondary">
                  Loading…
                </Text>
              </div>
            ) : (
              <>
                {tagNoteGroups.map(({ tag, items }) => {
                  const expanded = expandedTagIds.includes(tag.id)
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
                            onClick={() => {
                              setExpandedTagIds((current) => addUniqueIds(current, [tag.id]))
                              onAddNoteForTag(tag)
                            }}
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
                            openNoteIds={openNoteIds}
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
                  <div className={styles.accordionStatus}>
                    <Text variant="body-1" color="secondary">
                      &ensp;No tags yet
                    </Text>
                  </div>
                )}
              </>
            )}
          </AccordionSection>
        </div>
      </section>
    </div>
  )
}

interface AccordionSectionProps {
  id: string
  title: string
  expanded: boolean
  onExpand: () => void
  children: ReactNode
  contentRole?: "list"
  contentLabel?: string
}

function AccordionSection({
  id,
  title,
  expanded,
  onExpand,
  children,
  contentRole,
  contentLabel,
}: AccordionSectionProps) {
  const headingId = `${id}-heading`
  const panelId = `${id}-panel`

  return (
    <div
      className={`${styles.accordionSection} ${expanded ? styles.accordionSectionExpanded : ""}`}
    >
      <button
        type="button"
        id={headingId}
        className={styles.accordionHeading}
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={onExpand}
      >
        {title}
        <CaretRight
          className={`${styles.accordionHeadingIcon} ${
            expanded ? styles.accordionHeadingIconExpanded : ""
          }`}
          size={12}
          aria-hidden
        />
      </button>
      <div
        id={panelId}
        role={contentRole ?? "region"}
        aria-labelledby={headingId}
        aria-label={contentLabel}
        className={styles.accordionContent}
        hidden={expanded ? undefined : true}
      >
        {children}
      </div>
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
