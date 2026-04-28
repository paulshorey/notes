"use client"

import type { CategoryRecord, NoteRecord, TagRecord } from "@lib/db-marketing"
import { CaretDown, PencilSimple, Trash, X } from "@phosphor-icons/react"
import { Button, Text, TextInput } from "@gravity-ui/uikit"
import {
  type CSSProperties,
  type MouseEvent,
  useEffect,
  useState,
} from "react"
import { FilterBanners } from "./FilterBanners"
import { NoteResultsList, type DisplayNoteItem } from "./NoteResultsList"
import styles from "./NotesApp.module.css"

const ALL_CATEGORIES_EXPANDED_ID = "all-categories"

type ExpandedCategoryId = number | typeof ALL_CATEGORIES_EXPANDED_ID

export interface CategoryNoteGroup {
  category: CategoryRecord
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
  searchQuery: string
  searchMode: boolean
  searchItems: DisplayNoteItem[]
  searchLoading: boolean
  allCategoryItems: DisplayNoteItem[]
  allCategoriesNoteCount: number
  categoryNoteGroups: CategoryNoteGroup[]
  activeNoteId: number | null
  onSearchQueryChange: (value: string) => void
  onEditNote: (note: NoteRecord) => void
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
  searchQuery,
  searchMode,
  searchItems,
  searchLoading,
  allCategoryItems,
  allCategoriesNoteCount,
  categoryNoteGroups,
  activeNoteId,
  onSearchQueryChange,
  onEditNote,
  onEditCategory,
  onDeleteCategory,
  onEditTag,
  onDeleteTag,
  onClose,
}: ResultsColumnProps) {
  const [expandedCategoryId, setExpandedCategoryId] = useState<ExpandedCategoryId | null>(null)

  useEffect(() => {
    setExpandedCategoryId((current) => {
      if (current === ALL_CATEGORIES_EXPANDED_ID) {
        return current
      }

      if (current !== null && categories.some((category) => category.id === current)) {
        return current
      }

      return fallbackCategoryId
    })
  }, [categories, fallbackCategoryId])

  const getFilteredNoteCount = (category: CategoryRecord, items: DisplayNoteItem[]) =>
    selectedTag === null ? category.noteCount : items.length

  return (
    <div
      className={`${styles.resultsColumnShell} ${
        visible ? styles.resultsColumnShellOpen : styles.resultsColumnShellCollapsed
      }`}
    >
      <section className={styles.resultsColumn} style={columnStyle}>
        <div className={`${styles.header} ${styles.headerRight}`}>
          <Button
            view="flat"
            size="s"
            onClick={onClose}
            aria-label="Hide notes list"
            title="Hide notes list"
            className={styles.resultsColumnCloseButton}
          >
            <X size={16} weight="regular" />
          </Button>
        </div>
        <FilterBanners
          tags={tags}
          notesCount={notesCount}
          onEditTag={onEditTag}
          onDeleteTag={onDeleteTag}
        />
        <div className={styles.searchForm}>
          <div className={styles.searchRow}>
            <TextInput
              size="l"
              placeholder="Search"
              value={searchQuery}
              onUpdate={onSearchQueryChange}
              className={styles.searchInput}
            />
          </div>
        </div>
        <div className={styles.noteResults}>
          <div className={styles.categoryAccordion} role="list" aria-label="Notes by category">
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
                <div className={styles.categoryGroup} role="listitem">
                  <div className={styles.categoryRow}>
                    <button
                      type="button"
                      className={styles.categoryToggle}
                      aria-expanded={expandedCategoryId === ALL_CATEGORIES_EXPANDED_ID}
                      aria-controls="category-notes-all"
                      onClick={() => setExpandedCategoryId(ALL_CATEGORIES_EXPANDED_ID)}
                    >
                      <span
                        className={`${styles.categoryToggleIcon} ${
                          expandedCategoryId === ALL_CATEGORIES_EXPANDED_ID
                            ? styles.categoryToggleIconExpanded
                            : ""
                        }`}
                      >
                        <CaretDown size={14} weight="regular" />
                      </span>
                      <span className={styles.categoryLabel}>All categories</span>
                      <span className={styles.categoryCount}>{allCategoriesNoteCount}</span>
                    </button>
                  </div>
                  {expandedCategoryId === ALL_CATEGORIES_EXPANDED_ID && (
                    <div id="category-notes-all" className={styles.categoryPanel}>
                      <NoteResultsList
                        items={allCategoryItems}
                        activeNoteId={activeNoteId}
                        loading={false}
                        emptyMessage={
                          selectedTag
                            ? `No notes in “${selectedTag.label}” for any category.`
                            : "No notes yet."
                        }
                        onEdit={onEditNote}
                      />
                    </div>
                  )}
                </div>

                {categoryNoteGroups.map(({ category, items }) => {
                  const expanded = expandedCategoryId === category.id
                  const panelId = `category-notes-${category.id}`
                  const deleteDisabled = category.id === fallbackCategoryId

                  return (
                    <div className={styles.categoryGroup} key={category.id} role="listitem">
                      <div className={styles.categoryRow}>
                        <button
                          type="button"
                          className={styles.categoryToggle}
                          aria-expanded={expanded}
                          aria-controls={panelId}
                          onClick={() => setExpandedCategoryId(category.id)}
                        >
                          <span
                            className={`${styles.categoryToggleIcon} ${
                              expanded ? styles.categoryToggleIconExpanded : ""
                            }`}
                          >
                            <CaretDown size={14} weight="regular" />
                          </span>
                          <span className={styles.categoryLabel}>{category.label}</span>
                          <span className={styles.categoryCount}>
                            {getFilteredNoteCount(category, items)}
                          </span>
                        </button>
                        <Button
                          view="flat"
                          size="xs"
                          onClick={(event: MouseEvent<HTMLButtonElement>) => {
                            event.stopPropagation()
                            onEditCategory(category)
                          }}
                          aria-label={`Edit ${category.label}`}
                          className={styles.categoryActionButton}
                        >
                          <PencilSimple size={14} weight="regular" />
                        </Button>
                        <Button
                          view="flat"
                          size="xs"
                          disabled={deleteDisabled}
                          title={
                            deleteDisabled ? "The default category cannot be deleted" : undefined
                          }
                          onClick={(event: MouseEvent<HTMLButtonElement>) => {
                            event.stopPropagation()
                            onDeleteCategory(category)
                          }}
                          aria-label={`Delete ${category.label}`}
                          className={styles.categoryActionButton}
                        >
                          <Trash size={14} weight="regular" />
                        </Button>
                      </div>
                      {expanded && (
                        <div id={panelId} className={styles.categoryPanel}>
                          <NoteResultsList
                            items={items}
                            activeNoteId={activeNoteId}
                            loading={false}
                            emptyMessage={
                              selectedTag
                                ? `No notes in “${selectedTag.label}” for this category.`
                                : `No notes in category “${category.label}”.`
                            }
                            onEdit={onEditNote}
                          />
                        </div>
                      )}
                    </div>
                  )
                })}
              </>
            )}
          </div>
          {searchMode && (
            <div className={styles.searchResultsSection}>
              <NoteResultsList
                items={searchItems}
                activeNoteId={activeNoteId}
                loading={searchLoading || notesLoading}
                emptyMessage={
                  selectedTag ? `No search results in “${selectedTag.label}”.` : "No search results."
                }
                onEdit={onEditNote}
              />
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
