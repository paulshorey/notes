"use client"

import { getCategoryNameError, UNCATEGORIZED_LABEL } from "@lib/db-items/contracts/category-name"
import type {
  CategoryRecord,
  ItemRecord,
  StatusRecord,
  SubcategoryRecord,
  TagRecord,
} from "@lib/db-items"
import {
  ArrowBendDownRight,
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
import { FilterablePickerPopup } from "@/components/ui/FilterablePickerPopup"
import { getErrorMessage } from "@/lib/api"
import { type ItemFiling, isSameFiling, NO_FILING } from "@/lib/itemFiling"
import { firstLineLabel, normalizeLabel, toLowercaseInput } from "@/lib/strings"
import { useItemsAppStore } from "@/stores/itemsAppStore"
import {
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type RefObject,
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

type MovePickerState = { id: string; itemId: number } & (
  | { kind: "filing"; anchorRef: RefObject<HTMLElement | null> }
  | { kind: "tag"; fromTagId: number }
)

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
  workspacePicker: ReactNode
  workspaceId: number | null
  tags: TagRecord[]
  itemsLoading: boolean
  categories: CategoryRecord[]
  createCategoryPending: boolean
  onCreateCategory: (label: string) => Promise<CategoryRecord | null>
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
  activeCategoryId: number | null
  activeSubcategoryId: number | null
  activeTagIds: number[]
  onEditItem: (item: ItemRecord) => void
  onAddItemForCategory: (
    category: CategoryRecord | null,
    subcategory?: SubcategoryRecord | null,
  ) => void
  onAddItemForTag: (tag: TagRecord) => void
  onMoveItemFiling: (item: ItemRecord, filing: ItemFiling) => Promise<boolean>
  onMoveItemTag: (item: ItemRecord, fromTagId: number, tagLabel: string) => void | Promise<void>
  onDeleteItem: (itemId: number) => void
  deletingItemId: number | null
  onEditTag: (tag: TagRecord) => void
  onDeleteTag: (tag: TagRecord) => void
}

export function ResultsColumn({
  visible,
  columnStyle,
  workspacePicker,
  workspaceId,
  tags,
  itemsLoading,
  categories,
  createCategoryPending,
  onCreateCategory,
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
  activeCategoryId,
  activeSubcategoryId,
  activeTagIds,
  onEditItem,
  onAddItemForCategory,
  onAddItemForTag,
  onMoveItemFiling,
  onMoveItemTag,
  onDeleteItem,
  deletingItemId,
  onEditTag,
  onDeleteTag,
}: ResultsColumnProps) {
  const setItemGroupDialog = useItemsAppStore((state) => state.setItemGroupDialog)
  const openWorkspaceMovePicker = useItemsAppStore((state) => state.openWorkspaceMovePicker)
  const [expandedSection, setExpandedSection] = useState<ResultsAccordionId | null>("categories")
  const searchQuery = useItemsAppStore((state) => state.searchQuery)
  const setSearchQuery = useItemsAppStore((state) => state.setSearchQuery)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const [expandedCategoryIds, setExpandedCategoryIds] = useState<number[]>([])
  const [expandedSubcategoryIds, setExpandedSubcategoryIds] = useState<number[]>([])
  const [expandedTagIds, setExpandedTagIds] = useState<number[]>([])
  const [expandedStatusIds, setExpandedStatusIds] = useState<number[]>([])
  const [uncategorizedExpanded, setUncategorizedExpanded] = useState(false)
  const [noStatusExpanded, setNoStatusExpanded] = useState(false)
  const [openActionMenuId, setOpenActionMenuId] = useState<string | null>(null)
  const [activeMovePicker, setActiveMovePicker] = useState<MovePickerState | null>(null)
  const prevActiveKeyRef = useRef<OpenItemKey | null | undefined>(undefined)
  const prevFilingRef = useRef<string | undefined>(undefined)
  const prevStatusIdRef = useRef<number | null | undefined>(undefined)
  const prevTagIdsRef = useRef<number[]>([])

  const toggleSection = (section: ResultsAccordionId) =>
    setExpandedSection((current) => (current === section ? null : section))

  useEffect(() => {
    const validIds = new Set(categories.map((category) => category.id))
    setExpandedCategoryIds((current) => retainValidIds(current, validIds))
    const validSubcategoryIds = new Set(
      categories.flatMap((category) => category.subcategories.map((entry) => entry.id)),
    )
    setExpandedSubcategoryIds((current) => retainValidIds(current, validSubcategoryIds))
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
    // Reveal where the active note is filed: its category, and its subcategory inside it.
    const filing = `${activeCategoryId ?? ""}/${activeSubcategoryId ?? ""}`
    const revealFiling = () => {
      if (activeCategoryId === null) {
        setUncategorizedExpanded(true)
        return
      }
      setExpandedCategoryIds((current) => addUniqueIds(current, [activeCategoryId]))
      if (activeSubcategoryId !== null)
        setExpandedSubcategoryIds((current) => addUniqueIds(current, [activeSubcategoryId]))
    }

    if (itemChanged) {
      revealFiling()

      if (activeStatusId === null) {
        setNoStatusExpanded(true)
      } else {
        setExpandedStatusIds((current) => addUniqueIds(current, [activeStatusId]))
      }

      if (activeTagIds.length > 0) {
        setExpandedTagIds((current) => addUniqueIds(current, activeTagIds))
      }
    } else {
      // Refiling the open note reveals its new place; clearing its category does not
      // force the uncategorized group open.
      if (filing !== prevFilingRef.current && activeCategoryId !== null) revealFiling()

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
    prevFilingRef.current = filing
    prevStatusIdRef.current = activeStatusId
    prevTagIdsRef.current = [...activeTagIds]
  }, [activeCategoryId, activeSubcategoryId, activeKey, activeStatusId, activeTagIds])

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

  /** Without a tag filter the server's count is exact even before every note has loaded. */
  const getFilteredItemCount = (record: { itemCount: number }, visibleCount: number) =>
    selectedTag === null ? record.itemCount : visibleCount

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

  const closeMovePicker = () =>
    setActiveMovePicker((current) => (current === activeMovePicker ? null : current))

  const renderItemRowAction = (item: ItemRecord, id: string, fromTagId?: number) => (
    <ItemActionMenu
      id={id}
      itemLabel={item.description?.trim() || "Untitled"}
      openActionMenuId={openActionMenuId}
      onOpenActionMenuChange={setOpenActionMenuId}
      onMove={(anchorRef) =>
        setActiveMovePicker({ kind: "filing", itemId: item.id, id, anchorRef })
      }
      onChangeTag={
        fromTagId === undefined
          ? undefined
          : () => setActiveMovePicker({ kind: "tag", itemId: item.id, fromTagId, id })
      }
      onDelete={() => onDeleteItem(item.id)}
      deletePending={deletingItemId === item.id}
      movePickerActive={activeMovePicker?.id === id}
      movePickerContent={renderMovePicker(item, id)}
      onCloseMovePicker={closeMovePicker}
    />
  )

  const renderMovePicker = (item: ItemRecord, pickerId: string) => {
    if (activeMovePicker?.itemId !== item.id || activeMovePicker.id !== pickerId) {
      return null
    }

    if (activeMovePicker.kind === "filing") {
      return (
        <ItemFilingPicker
          categories={categories}
          currentFiling={{
            categoryId: item.category?.id ?? null,
            subcategoryId: item.subcategory?.id ?? null,
          }}
          onClose={closeMovePicker}
          onSelect={(filing) => onMoveItemFiling(item, filing)}
          onMoveToWorkspace={() => {
            closeMovePicker()
            openWorkspaceMovePicker({ kind: "item", itemId: item.id }, activeMovePicker.anchorRef)
          }}
        />
      )
    }

    return (
      <ItemTagPicker
        tags={tags}
        currentTagId={activeMovePicker.fromTagId}
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
          <div className={styles.workspacePicker}>{visible && workspacePicker}</div>
          <AccordionSection
            id="categories"
            title="Categories"
            expanded={expandedSection === "categories"}
            onToggle={() => toggleSection("categories")}
            action={
              visible &&
              workspaceId !== null && (
                <CreateCategoryButton
                  key={workspaceId}
                  categories={categories}
                  pending={createCategoryPending}
                  onCreate={onCreateCategory}
                  onCreated={(category) => {
                    setExpandedSection("categories")
                    onAddItemForCategory(category)
                  }}
                />
              )
            }
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
                  ? activeCategoryId === category.id
                  : activeCategoryId === null
                const subgroups = group.kind === "category" ? group.subgroups : []
                const panelId = category ? `category-items-${category.id}` : "uncategorized-items"
                return (
                  <div className={styles.categoryGroup} key={key} role="listitem">
                    <div className={styles.categoryRow}>
                      <SectionTitle
                        count={
                          category ? getFilteredItemCount(category, group.itemCount) : items.length
                        }
                        label={category?.label ?? UNCATEGORIZED_LABEL}
                        active={expanded}
                        selected={selected}
                        expanded={expanded}
                        showCaret
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
                          editLabel={category ? "Rename category" : "Rename"}
                          deleteLabel={category ? "Delete category" : "Delete"}
                          openActionMenuId={openActionMenuId}
                          onOpenActionMenuChange={setOpenActionMenuId}
                          onEdit={() =>
                            setItemGroupDialog({
                              target,
                              label: category?.label ?? UNCATEGORIZED_LABEL,
                              intent: "rename",
                            })
                          }
                          onMove={
                            category
                              ? () =>
                                  setItemGroupDialog({
                                    target,
                                    label: category.label,
                                    intent: "move",
                                  })
                              : undefined
                          }
                          onMoveToWorkspace={(anchorRef) =>
                            openWorkspaceMovePicker(target, anchorRef)
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
                    {expanded &&
                      category &&
                      subgroups.map(({ subcategory, items: nestedItems }) => {
                        const subKey = `subcategory-${subcategory.id}`
                        const subPanelId = `subcategory-items-${subcategory.id}`
                        const subExpanded = expandedSubcategoryIds.includes(subcategory.id)
                        const subSelected = activeSubcategoryId === subcategory.id
                        const subTarget = {
                          kind: "subcategory" as const,
                          subcategoryId: subcategory.id,
                        }
                        return (
                          <div className={styles.subcategoryGroup} key={subKey}>
                            <div className={styles.categoryRow}>
                              <SectionTitle
                                count={getFilteredItemCount(subcategory, nestedItems.length)}
                                label={subcategory.label}
                                active={subExpanded}
                                selected={subSelected}
                                expanded={subExpanded}
                                showCaret
                                panelId={subPanelId}
                                onToggle={() => {
                                  setOpenActionMenuId(null)
                                  setActiveMovePicker(null)
                                  setExpandedSubcategoryIds((current) =>
                                    toggleId(current, subcategory.id),
                                  )
                                }}
                              >
                                <SectionAddItemButton
                                  label={`Add note in ${category.label} › ${subcategory.label}`}
                                  active={subExpanded}
                                  selected={subSelected}
                                  onClick={() => {
                                    setExpandedSubcategoryIds((current) =>
                                      addUniqueIds(current, [subcategory.id]),
                                    )
                                    onAddItemForCategory(category, subcategory)
                                  }}
                                />
                                <SectionActionMenu
                                  id={subKey}
                                  label={subcategory.label}
                                  editLabel="Rename subcategory"
                                  deleteLabel="Delete subcategory"
                                  openActionMenuId={openActionMenuId}
                                  onOpenActionMenuChange={setOpenActionMenuId}
                                  onEdit={() =>
                                    setItemGroupDialog({
                                      target: subTarget,
                                      label: subcategory.label,
                                      intent: "rename",
                                    })
                                  }
                                  onMove={() =>
                                    setItemGroupDialog({
                                      target: subTarget,
                                      label: subcategory.label,
                                      intent: "move",
                                    })
                                  }
                                  onMoveToWorkspace={(anchorRef) =>
                                    openWorkspaceMovePicker(subTarget, anchorRef)
                                  }
                                  onDelete={() =>
                                    setItemGroupDialog({
                                      target: subTarget,
                                      label: subcategory.label,
                                      intent: "delete",
                                    })
                                  }
                                />
                              </SectionTitle>
                            </div>
                            {subExpanded && nestedItems.length > 0 && (
                              <ScrollableItemsPanel id={subPanelId}>
                                <ItemResultsList
                                  items={nestedItems}
                                  activeItemId={activeItemId}
                                  openItemIds={openItemIds}
                                  loading={false}
                                  emptyMessage=""
                                  onEdit={handleResultEdit}
                                  renderAction={(item) =>
                                    renderItemRowAction(item, `${subKey}-item-${item.id}`)
                                  }
                                />
                              </ScrollableItemsPanel>
                            )}
                          </div>
                        )
                      })}
                  </div>
                )
              })
            )}
          </AccordionSection>
          <AccordionSection
            id="statuses"
            title="Statuses"
            expanded={expandedSection === "statuses"}
            onToggle={() => toggleSection("statuses")}
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
            onToggle={() => toggleSection("tags")}
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
          <AccordionSection
            id="search"
            title="Search"
            expanded={expandedSection === "search"}
            onToggle={() => toggleSection("search")}
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
        </div>
      </section>
    </div>
  )
}

interface AccordionSectionProps {
  id: string
  title: string
  expanded: boolean
  onToggle: () => void
  action?: ReactNode
  children: ReactNode
  contentRole?: "list"
  contentLabel?: string
}

function AccordionSection({
  id,
  title,
  expanded,
  onToggle,
  action,
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
      <div className={styles.accordionHeader}>
        <button
          type="button"
          id={headingId}
          className={styles.accordionHeading}
          aria-expanded={expanded}
          aria-controls={panelId}
          onClick={onToggle}
        >
          <CaretRight className={styles.accordionHeadingIcon} size={16} weight="bold" aria-hidden />
          {title}
        </button>
        {action}
      </div>
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

interface CreateCategoryButtonProps {
  categories: CategoryRecord[]
  pending: boolean
  onCreate: (label: string) => Promise<CategoryRecord | null>
  onCreated: (category: CategoryRecord) => void
}

function CreateCategoryButton({
  categories,
  pending,
  onCreate,
  onCreated,
}: CreateCategoryButtonProps) {
  const buttonRef = useRef<HTMLButtonElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const inputRevisionRef = useRef(0)
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState("")
  const [requestError, setRequestError] = useState<string | null>(null)
  const label = normalizeLabel(value)
  const duplicate = categories.some((category) => normalizeLabel(category.label) === label)
  const error = getCategoryNameError(label) ?? (duplicate ? "This category already exists." : null)

  const close = () => {
    inputRevisionRef.current += 1
    setOpen(false)
    setValue("")
    setRequestError(null)
  }

  const create = async () => {
    if (!open || label === "" || pending || error) return
    inputRef.current?.focus()
    const inputRevision = inputRevisionRef.current
    try {
      const category = await onCreate(label)
      if (!category || inputRevisionRef.current !== inputRevision || !buttonRef.current) return
      close()
      onCreated(category)
    } catch (error) {
      if (inputRevisionRef.current !== inputRevision || !buttonRef.current) return
      setRequestError(getErrorMessage(error))
      inputRef.current?.focus()
    }
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={`${styles.sectionAddItemButton} ${styles.createCategoryButton}`}
        aria-label="Add category"
        title="Add category"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-disabled={pending && !open}
        onClick={() => {
          if (open) close()
          else if (!pending) {
            setRequestError(null)
            setOpen(true)
          }
        }}
      >
        <Plus size={16} weight="regular" aria-hidden />
      </button>
      <FilterablePickerPopup
        anchorRef={buttonRef}
        open={open}
        onClose={close}
        placement={["bottom-end", "top-end"]}
        listboxAriaLabel="Add category"
        description={requestError ?? undefined}
        input={{
          ref: inputRef,
          value,
          placeholder: "Enter new category...",
          ariaLabel: "Category name",
          submitAriaLabel: "Create category",
          submitDisabled: pending,
          error,
          onChange: (value) => {
            inputRevisionRef.current += 1
            setValue(value)
            setRequestError(null)
          },
          onKeyDown: (event) => {
            if (event.key === "Enter" && !event.nativeEvent.isComposing) {
              event.preventDefault()
              void create()
            }
          },
          onSubmit: () => void create(),
        }}
      />
    </>
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
  showCaret?: boolean
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
  showCaret = false,
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
          <span
            className={`${styles.categoryNameText} ${active ? styles.categoryNameTextActive : ""} ${selected ? styles.categoryNameTextSelected : ""}`}
          >
            {label}
          </span>
          <span className={styles.categoryIndicator}>
            {showCaret && (
              <CaretRight className={styles.categoryCaret} size={12} weight="bold" aria-hidden />
            )}
            <sup className={styles.categoryCountTextSup}>{count}</sup>
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
  /** Offered only for groups that have a place in the hierarchy to move from. */
  onMove?: () => void
  onMoveToWorkspace?: (anchorRef: RefObject<HTMLElement | null>) => void
  onDelete: () => void
  deleteDisabled?: boolean
  deleteTitle?: string
  editLabel?: string
  deleteLabel?: string
}

function SectionActionMenu({
  id,
  label,
  openActionMenuId,
  onOpenActionMenuChange,
  onEdit,
  onMove,
  onMoveToWorkspace,
  onDelete,
  deleteDisabled = false,
  deleteTitle,
  editLabel = "Edit",
  deleteLabel = "Delete",
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
          {onMoveToWorkspace && (
            <button
              type="button"
              className={styles.categoryActionMenuItem}
              role="menuitem"
              onClick={() => {
                onOpenActionMenuChange(null)
                onMoveToWorkspace(buttonRef)
              }}
            >
              <ArrowsLeftRight size={14} weight="regular" />
              <span>Move to workspace</span>
            </button>
          )}
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
          {onMove && (
            <button
              type="button"
              className={styles.categoryActionMenuItem}
              role="menuitem"
              onClick={() => {
                onOpenActionMenuChange(null)
                onMove()
              }}
            >
              <ArrowBendDownRight size={14} weight="regular" />
              <span>Move into another category</span>
            </button>
          )}
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
            <span>{deleteLabel}</span>
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
  onMove: (anchorRef: RefObject<HTMLElement | null>) => void
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
  onMove,
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
              onMove(buttonRef)
            }}
          >
            <ArrowsLeftRight size={14} weight="regular" />
            <span>Move</span>
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

interface ItemFilingPickerProps {
  categories: CategoryRecord[]
  currentFiling: ItemFiling
  onClose: () => void
  onSelect: (filing: ItemFiling) => Promise<boolean>
  onMoveToWorkspace: () => void
}

function ItemFilingPicker({
  categories,
  currentFiling,
  onClose,
  onSelect,
  onMoveToWorkspace,
}: ItemFilingPickerProps) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const [pending, setPending] = useState(false)

  useEffect(() => {
    dialogRef.current?.focus({ preventScroll: true })
  }, [])

  const select = async (filing: ItemFiling) => {
    if (pending) return
    setPending(true)
    try {
      if (await onSelect(filing)) onClose()
    } finally {
      setPending(false)
    }
  }

  const destination = (label: string, filing: ItemFiling, parentLabel?: string) => (
    <button
      type="button"
      className={styles.itemMovePickerOption}
      aria-label={parentLabel ? `${parentLabel} › ${label}` : undefined}
      aria-current={isSameFiling(filing, currentFiling) || undefined}
      disabled={pending}
      onClick={() => void select(filing)}
    >
      {label}
    </button>
  )

  return (
    <div
      ref={dialogRef}
      className={styles.itemMovePicker}
      role="dialog"
      aria-label="Move item"
      tabIndex={-1}
      onClick={(event) => event.stopPropagation()}
    >
      <ul className={styles.itemMoveTree} role="list" aria-label="Filing destinations">
        <li>{destination(UNCATEGORIZED_LABEL, NO_FILING)}</li>
        {categories.map((category) => (
          <li key={category.id}>
            {destination(category.label, { categoryId: category.id, subcategoryId: null })}
            {category.subcategories.length > 0 && (
              <ul className={styles.itemMoveSubcategories} role="list">
                {category.subcategories.map((subcategory) => (
                  <li key={subcategory.id}>
                    {destination(
                      subcategory.label,
                      { categoryId: category.id, subcategoryId: subcategory.id },
                      category.label,
                    )}
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
      <button
        type="button"
        className={styles.categoryActionMenuItem}
        disabled={pending}
        onClick={onMoveToWorkspace}
      >
        <ArrowsLeftRight size={14} weight="regular" />
        <span>Move to workspace</span>
      </button>
    </div>
  )
}

interface ItemTagPickerProps {
  tags: TagRecord[]
  currentTagId: number
  onClose: () => void
  onSelect: (label: string) => void | Promise<void>
}

function ItemTagPicker({ tags, currentTagId, onClose, onSelect }: ItemTagPickerProps) {
  const [inputValue, setInputValue] = useState("")
  const [pending, setPending] = useState(false)
  const filteredTags = useMemo(() => {
    const query = normalizeLabel(inputValue)
    return tags.filter(
      (tag) => tag.id !== currentTagId && normalizeLabel(tag.label).includes(query),
    )
  }, [currentTagId, inputValue, tags])

  const submitLabel = (rawLabel: string) => {
    const label = rawLabel.trim()
    if (label === "" || pending) return
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
    const matchingTag = tags.find((tag) => normalizeLabel(tag.label) === normalizeLabel(label))
    submitLabel(matchingTag?.label ?? label)
  }

  return (
    <div
      className={styles.itemMovePicker}
      role="dialog"
      aria-label="Move note to tag"
      onClick={(event) => event.stopPropagation()}
    >
      <div className={styles.itemMovePickerOptions} role="listbox" aria-label="Tag options">
        {filteredTags.length === 0 && inputValue.trim() !== "" ? (
          <div className={styles.itemMovePickerEmpty}>
            Press Enter to create &quot;{inputValue.trim()}&quot;
          </div>
        ) : (
          filteredTags.map((tag) => (
            <button
              key={tag.id}
              type="button"
              className={styles.itemMovePickerOption}
              disabled={pending}
              onClick={() => submitLabel(tag.label)}
              role="option"
              aria-selected={false}
            >
              {tag.label}
            </button>
          ))
        )}
        {filteredTags.length === 0 && inputValue.trim() === "" && (
          <div className={styles.itemMovePickerEmpty}>No other tags.</div>
        )}
      </div>
      <input
        type="text"
        className={styles.itemMovePickerInput}
        placeholder="Enter new..."
        value={inputValue}
        disabled={pending}
        onChange={(event) => setInputValue(toLowercaseInput(event.currentTarget.value))}
        onKeyDown={handleKeyDown}
      />
    </div>
  )
}
