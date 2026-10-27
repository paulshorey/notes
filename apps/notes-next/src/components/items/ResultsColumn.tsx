"use client"

import { getCategoryNameError, UNCATEGORIZED_LABEL } from "@lib/db-items/contracts/category-name"
import type { CategoryRecord, ItemRecord, StatusRecord, TagRecord } from "@lib/db-items"
import {
  ArrowsLeftRight,
  CaretRight,
  DotsThreeVertical,
  MagnifyingGlass,
  PencilSimple,
  Plus,
  Trash,
  X,
} from "@phosphor-icons/react"
import { Button, Popup, Text, TextInput } from "@gravity-ui/uikit"
import { firstLineLabel, normalizeLabel, toLowercaseInput } from "@/lib/strings"
import { useItemsAppStore } from "@/stores/itemsAppStore"
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
import type { OpenItemKey } from "@/stores/openItems"
import { ItemResultsList } from "./ItemResultsList"
import type { CategoryItemGroup, DisplayItemItem } from "@/lib/itemGroups"
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
      item: ItemRecord
    }
  | {
      kind: "tag"
      id: string
      item: ItemRecord
      fromTagId: number
    }

export interface TagItemGroup {
  tag: TagRecord
  items: DisplayItemItem[]
  sortTime: number
}
export interface StatusItemGroup {
  status: StatusRecord
  items: DisplayItemItem[]
}

interface ResultsColumnProps {
  visible: boolean
  columnStyle: CSSProperties
  tags: TagRecord[]
  itemsLoading: boolean
  categories: CategoryRecord[]
  statuses: StatusRecord[]
  statusItemGroups: StatusItemGroup[]
  activeStatusId: number | null
  fallbackTagId: number | null
  selectedTag: TagRecord | null
  searchMode: boolean
  searchItems: DisplayItemItem[]
  searchLoading: boolean
  categoryItemGroups: CategoryItemGroup[]
  noStatusItems: DisplayItemItem[]
  tagItemGroups: TagItemGroup[]
  activeItemId: number | null
  /** Notes with an open entry, marked distinctly from the active one. */
  openItemIds: number[]
  activeKey: OpenItemKey | null
  activeCategoryIds: number[]
  activeTagIds: number[]
  onEditItem: (item: ItemRecord) => void
  onAddItemForCategory: (category: CategoryRecord | null) => void
  onAddItemForTag: (tag: TagRecord) => void
  onMoveItemCategory: (item: ItemRecord, categoryLabel: string) => void | Promise<void>
  onMoveItemTag: (item: ItemRecord, fromTagId: number, tagLabel: string) => void | Promise<void>
  onDeleteItem: (itemId: number) => void
  deletingItemId: number | null
  onEditTag: (tag: TagRecord) => void
  onDeleteTag: (tag: TagRecord) => void
}

export function ResultsColumn({
  visible,
  columnStyle,
  tags,
  itemsLoading,
  categories,
  statuses,
  statusItemGroups,
  activeStatusId,
  fallbackTagId,
  selectedTag,
  searchMode,
  searchItems,
  searchLoading,
  categoryItemGroups,
  noStatusItems,
  tagItemGroups,
  activeItemId,
  openItemIds,
  activeKey,
  activeCategoryIds,
  activeTagIds,
  onEditItem,
  onAddItemForCategory,
  onAddItemForTag,
  onMoveItemCategory,
  onMoveItemTag,
  onDeleteItem,
  deletingItemId,
  onEditTag,
  onDeleteTag,
}: ResultsColumnProps) {
  const setItemGroupDialog = useItemsAppStore((state) => state.setItemGroupDialog)
  const [expandedSection, setExpandedSection] = useState<ResultsAccordionId>("categories")
  const searchQuery = useItemsAppStore((state) => state.searchQuery)
  const setSearchQuery = useItemsAppStore((state) => state.setSearchQuery)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const [expandedCategoryIds, setExpandedCategoryIds] = useState<number[]>([])
  const [expandedTagIds, setExpandedTagIds] = useState<number[]>([])
  const [expandedStatusIds, setExpandedStatusIds] = useState<number[]>([])
  const [uncategorizedExpanded, setUncategorizedExpanded] = useState(false)
  const [noStatusExpanded, setNoStatusExpanded] = useState(false)
  const [openActionMenuId, setOpenActionMenuId] = useState<string | null>(null)
  const [activeMovePicker, setActiveMovePicker] = useState<MovePickerState | null>(null)
  const prevActiveKeyRef = useRef<OpenItemKey | null | undefined>(undefined)
  const prevCategoryIdsRef = useRef<number[]>([])
  const prevStatusIdRef = useRef<number | null | undefined>(undefined)
  const prevTagIdsRef = useRef<number[]>([])

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
    const itemChanged = prevActiveKeyRef.current !== activeKey

    if (itemChanged) {
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
    if (expandedSection !== "search") return
    const frameId = window.requestAnimationFrame(() => searchInputRef.current?.focus())
    return () => window.cancelAnimationFrame(frameId)
  }, [expandedSection])

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

  const getFilteredItemCount = (category: CategoryRecord, items: DisplayItemItem[]) =>
    selectedTag === null ? category.itemCount : items.length

  const isCategoryExpanded = (categoryId: number) => expandedCategoryIds.includes(categoryId)

  const toggleCategoryGroup = (group: CategoryItemGroup) => {
    setOpenActionMenuId(null)
    setActiveMovePicker(null)
    if (group.kind === "category") {
      setExpandedCategoryIds((current) => toggleId(current, group.category.id))
    } else {
      setUncategorizedExpanded((value) => !value)
    }
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

  const handleResultEdit = (item: ItemRecord) => {
    onEditItem(item)
  }

  const closeMovePicker = () => {
    setActiveMovePicker(null)
  }

  const renderItemRowAction = (item: ItemRecord, id: string, fromTagId?: number) => (
    <ItemActionMenu
      id={id}
      itemLabel={item.description?.trim() || "Untitled"}
      openActionMenuId={openActionMenuId}
      onOpenActionMenuChange={setOpenActionMenuId}
      onAssignCategory={() => {
        setOpenActionMenuId(null)
        setActiveMovePicker({ kind: "category", item, id })
      }}
      onChangeTag={
        fromTagId === undefined
          ? undefined
          : () => {
              setOpenActionMenuId(null)
              setActiveMovePicker({ kind: "tag", item, fromTagId, id })
            }
      }
      onDelete={() => onDeleteItem(item.id)}
      deletePending={deletingItemId === item.id}
      movePickerActive={activeMovePicker?.id === id}
      movePickerContent={renderMovePicker(item, id)}
      onCloseMovePicker={closeMovePicker}
    />
  )

  const renderMovePicker = (item: ItemRecord, pickerId: string) => {
    if (activeMovePicker?.item.id !== item.id || activeMovePicker.id !== pickerId) {
      return null
    }

    if (activeMovePicker.kind === "category") {
      return (
        <ItemMovePicker
          mode="category"
          options={categories}
          currentOptionIds={item.categories.map((category) => category.id)}
          inputPlaceholder="Enter new..."
          emptyMessage="No other categories."
          onClose={closeMovePicker}
          onSelect={(label) => onMoveItemCategory(item, label)}
        />
      )
    }

    return (
      <ItemMovePicker
        mode="tag"
        options={tags}
        currentOptionIds={[activeMovePicker.fromTagId]}
        inputPlaceholder="Enter new..."
        emptyMessage="No other tags."
        onClose={closeMovePicker}
        onSelect={(label) => onMoveItemTag(item, activeMovePicker.fromTagId, label)}
      />
    )
  }

  return (
    <div
      className={`${styles.resultsColumnShell} ${
        visible ? styles.resultsColumnShellOpen : styles.resultsColumnShellCollapsed
      }`}
    >
      <section
        id="notes-navigation"
        aria-label="Notes navigation"
        className={styles.resultsColumn}
        style={columnStyle}
        inert={!visible}
      >
        <div className={styles.itemResults}>
          <AccordionSection
            id="search"
            title="Search"
            expanded={expandedSection === "search"}
            onExpand={() => setExpandedSection("search")}
          >
            <div className={styles.searchField}>
              <TextInput
                size="m"
                placeholder="AI Search"
                value={searchQuery}
                onUpdate={(value) => setSearchQuery(toLowercaseInput(value))}
                onKeyDown={(event) => {
                  if (event.key !== "Escape") return
                  event.preventDefault()
                  event.stopPropagation()
                  if (searchQuery.trim() !== "") {
                    setSearchQuery("")
                  } else {
                    setExpandedSection("categories")
                  }
                }}
                controlRef={searchInputRef}
                startContent={<MagnifyingGlass size={16} weight="regular" aria-hidden />}
                endContent={
                  searchMode ? (
                    <button
                      type="button"
                      className={styles.searchClearButton}
                      aria-label="Clear search"
                      title="Clear search"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => {
                        setSearchQuery("")
                        searchInputRef.current?.focus()
                      }}
                    >
                      <X size={14} weight="bold" />
                    </button>
                  ) : undefined
                }
                className={styles.searchInput}
                controlProps={{ "aria-label": "AI Search" }}
              />
            </div>
            {searchMode && (
              <div className={styles.searchResults}>
                <ItemResultsList
                  items={searchItems}
                  activeItemId={activeItemId}
                  openItemIds={openItemIds}
                  loading={searchLoading || itemsLoading}
                  emptyMessage={
                    selectedTag
                      ? `No search results in “${selectedTag.label}”.`
                      : "No search results."
                  }
                  onEdit={handleResultEdit}
                  renderAction={(item) => renderItemRowAction(item, `search-item-${item.id}`)}
                />
              </div>
            )}
          </AccordionSection>
          <AccordionSection
            id="categories"
            title="Categories"
            expanded={expandedSection === "categories"}
            onExpand={() => setExpandedSection("categories")}
            contentRole="list"
            contentLabel="Notes by category"
          >
            {itemsLoading ? (
              <div className={styles.accordionStatus}>
                <Text variant="body-1" color="secondary">
                  Loading…
                </Text>
              </div>
            ) : categoryItemGroups.length === 0 ? (
              <div className={styles.accordionStatus}>
                <Text variant="body-1" color="secondary">
                  &ensp;No categories yet
                </Text>
              </div>
            ) : (
              categoryItemGroups.map((group) => {
                const { items } = group
                const category = group.kind === "category" ? group.category : null
                const target = category
                  ? { kind: "category" as const, categoryId: category.id }
                  : { kind: "uncategorized" as const }
                const key = category ? `category-${category.id}` : "uncategorized"
                const expanded = category ? isCategoryExpanded(category.id) : uncategorizedExpanded
                const selected = category
                  ? activeCategoryIds.includes(category.id)
                  : activeCategoryIds.length === 0
                const panelId = category ? `category-items-${category.id}` : "uncategorized-items"
                return (
                  <div className={styles.categoryGroup} key={key} role="listitem">
                    <div className={styles.categoryRow}>
                      <SectionTitle
                        count={category ? getFilteredItemCount(category, items) : items.length}
                        label={category?.label ?? UNCATEGORIZED_LABEL}
                        active={expanded}
                        selected={selected}
                        expanded={expanded}
                        panelId={panelId}
                        onToggle={() => toggleCategoryGroup(group)}
                      >
                        <SectionAddItemButton
                          label={`Add note in ${category?.label ?? UNCATEGORIZED_LABEL}`}
                          active={expanded}
                          selected={selected}
                          onClick={() => {
                            if (category)
                              setExpandedCategoryIds((current) =>
                                addUniqueIds(current, [category.id]),
                              )
                            else setUncategorizedExpanded(true)
                            onAddItemForCategory(category)
                          }}
                        />
                        <SectionActionMenu
                          id={key}
                          label={category?.label ?? UNCATEGORIZED_LABEL}
                          editLabel="Rename"
                          openActionMenuId={openActionMenuId}
                          onOpenActionMenuChange={setOpenActionMenuId}
                          onEdit={() =>
                            setItemGroupDialog({
                              target,
                              label: category?.label ?? UNCATEGORIZED_LABEL,
                              intent: "rename",
                            })
                          }
                          onDelete={() =>
                            setItemGroupDialog({
                              target,
                              label: category?.label ?? UNCATEGORIZED_LABEL,
                              intent: "delete",
                            })
                          }
                        />
                      </SectionTitle>
                    </div>
                    {expanded && items.length > 0 && (
                      <ScrollableItemsPanel id={panelId}>
                        <ItemResultsList
                          items={items}
                          activeItemId={activeItemId}
                          openItemIds={openItemIds}
                          loading={false}
                          emptyMessage=""
                          onEdit={handleResultEdit}
                          renderAction={(item) =>
                            renderItemRowAction(item, `${key}-item-${item.id}`)
                          }
                        />
                      </ScrollableItemsPanel>
                    )}
                  </div>
                )
              })
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
            {itemsLoading ? (
              <div className={styles.accordionStatus}>
                <Text variant="body-1" color="secondary">
                  Loading…
                </Text>
              </div>
            ) : (
              <>
                {statusItemGroups.map(({ status, items }) => {
                  const expanded = expandedStatusIds.includes(status.id)
                  const panelId = `status-items-${status.id}`
                  return (
                    <div className={styles.categoryGroup} key={status.id} role="listitem">
                      <div className={styles.categoryRow}>
                        <SectionTitle
                          count={status.itemCount}
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
                        <ScrollableItemsPanel id={panelId}>
                          <ItemResultsList
                            items={items}
                            activeItemId={activeItemId}
                            openItemIds={openItemIds}
                            loading={false}
                            emptyMessage=""
                            onEdit={handleResultEdit}
                            renderAction={(item) =>
                              renderItemRowAction(item, `status-${status.id}-item-${item.id}`)
                            }
                          />
                        </ScrollableItemsPanel>
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
                        panelId="no-status-items"
                        onToggle={() => setNoStatusExpanded((value) => !value)}
                      >
                        <span />
                      </SectionTitle>
                    </div>
                    {noStatusExpanded && (
                      <ScrollableItemsPanel id="no-status-items">
                        <ItemResultsList
                          items={noStatusItems}
                          activeItemId={activeItemId}
                          openItemIds={openItemIds}
                          loading={false}
                          emptyMessage=""
                          onEdit={handleResultEdit}
                          renderAction={(item) =>
                            renderItemRowAction(item, `no-status-item-${item.id}`)
                          }
                        />
                      </ScrollableItemsPanel>
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
            {itemsLoading ? (
              <div className={styles.accordionStatus}>
                <Text variant="body-1" color="secondary">
                  Loading…
                </Text>
              </div>
            ) : (
              <>
                {tagItemGroups.map(({ tag, items }) => {
                  const expanded = expandedTagIds.includes(tag.id)
                  const panelId = `tag-items-${tag.id}`
                  const deleteDisabled = tag.id === fallbackTagId

                  return (
                    <div className={styles.categoryGroup} key={tag.id} role="listitem">
                      <div className={styles.categoryRow}>
                        <SectionTitle
                          count={tag.itemCount}
                          label={tag.label}
                          selected={activeTagIds.includes(tag.id)}
                          expanded={expanded}
                          panelId={panelId}
                          onToggle={() => toggleTag(tag.id)}
                        >
                          <SectionAddItemButton
                            label={`Add note tagged ${tag.label}`}
                            selected={activeTagIds.includes(tag.id)}
                            onClick={() => {
                              setExpandedTagIds((current) => addUniqueIds(current, [tag.id]))
                              onAddItemForTag(tag)
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
                        <ScrollableItemsPanel id={panelId}>
                          <ItemResultsList
                            items={items}
                            activeItemId={activeItemId}
                            openItemIds={openItemIds}
                            loading={false}
                            emptyMessage=""
                            onEdit={handleResultEdit}
                            renderAction={(item) =>
                              renderItemRowAction(item, `tag-${tag.id}-item-${item.id}`, tag.id)
                            }
                          />
                        </ScrollableItemsPanel>
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

interface ScrollableItemsPanelProps {
  id: string
  children: ReactNode
}

function ScrollableItemsPanel({ id, children }: ScrollableItemsPanelProps) {
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

interface SectionAddItemButtonProps {
  label: string
  active?: boolean
  selected?: boolean
  onClick: () => void
}

function SectionAddItemButton({
  label,
  active = false,
  selected = false,
  onClick,
}: SectionAddItemButtonProps) {
  return (
    <button
      type="button"
      className={`${styles.sectionAddItemButton} ${active ? styles.sectionAddItemButtonActive : ""} ${selected ? styles.sectionAddItemButtonSelected : ""}`}
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
  editLabel?: string
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
  editLabel = "Edit",
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
            <span>{editLabel}</span>
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

interface ItemActionMenuProps {
  id: string
  itemLabel: string
  openActionMenuId: string | null
  onOpenActionMenuChange: (id: string | null) => void
  onAssignCategory: () => void
  onChangeTag?: () => void
  onDelete: () => void
  deletePending?: boolean
  movePickerActive: boolean
  movePickerContent: ReactNode
  onCloseMovePicker: () => void
}

function ItemActionMenu({
  id,
  itemLabel,
  openActionMenuId,
  onOpenActionMenuChange,
  onAssignCategory,
  onChangeTag,
  onDelete,
  deletePending = false,
  movePickerActive,
  movePickerContent,
  onCloseMovePicker,
}: ItemActionMenuProps) {
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
        aria-label={`More options for ${firstLineLabel(itemLabel)}`}
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
              onAssignCategory()
            }}
          >
            <ArrowsLeftRight size={14} weight="regular" />
            <span>Assign category</span>
          </button>
          {onChangeTag && (
            <button
              type="button"
              className={styles.categoryActionMenuItem}
              role="menuitem"
              onClick={() => {
                onOpenActionMenuChange(null)
                onChangeTag()
              }}
            >
              <ArrowsLeftRight size={14} weight="regular" />
              <span>Change tag</span>
            </button>
          )}
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

interface ItemMovePickerProps {
  mode: "category" | "tag"
  options: Array<CategoryRecord | TagRecord>
  currentOptionIds: number[]
  inputPlaceholder: string
  emptyMessage: string
  onClose: () => void
  onSelect: (label: string) => void | Promise<void>
}

function ItemMovePicker({
  mode,
  options,
  currentOptionIds,
  inputPlaceholder,
  emptyMessage,
  onClose,
  onSelect,
}: ItemMovePickerProps) {
  const [inputValue, setInputValue] = useState("")
  const [pending, setPending] = useState(false)
  const inputError = mode === "category" ? getCategoryNameError(inputValue) : null
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
    if (label === "" || pending || (mode === "category" && getCategoryNameError(label))) {
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
      className={styles.itemMovePicker}
      role="dialog"
      aria-label={`Move note to ${mode === "category" ? "category" : "tag"}`}
      onClick={(event) => event.stopPropagation()}
    >
      <div
        className={styles.itemMovePickerOptions}
        role="listbox"
        aria-label={mode === "category" ? "Category options" : "Tag options"}
      >
        {inputError ? (
          <div className={styles.itemMovePickerEmpty} role="alert">
            {inputError}
          </div>
        ) : filteredOptions.length === 0 && inputValue.trim() !== "" ? (
          <div className={styles.itemMovePickerEmpty}>
            Press Enter to create &quot;{inputValue.trim()}&quot;
          </div>
        ) : (
          filteredOptions.map((option) => (
            <button
              key={option.id}
              type="button"
              className={styles.itemMovePickerOption}
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
          <div className={styles.itemMovePickerEmpty}>{emptyMessage}</div>
        )}
      </div>
      <input
        type="text"
        className={styles.itemMovePickerInput}
        aria-invalid={Boolean(inputError)}
        placeholder={inputPlaceholder}
        value={inputValue}
        disabled={pending}
        onChange={(event) => setInputValue(toLowercaseInput(event.currentTarget.value))}
        onKeyDown={handleKeyDown}
      />
    </div>
  )
}
