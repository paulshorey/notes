"use client"

import { Button, Icon, Text } from "@gravity-ui/uikit"
import { Pencil, TrashBin } from "@gravity-ui/icons"
import type { CategoryRecord, TagRecord } from "@lib/db-marketing"
import { type KeyboardEvent, type MouseEvent, useEffect, useRef, useState } from "react"
import { CaretDownIcon } from "@/components/ui/icons/CaretDownIcon"
import styles from "./FilterBanners.module.css"

interface FilterBannersProps {
  categories: CategoryRecord[]
  tags: TagRecord[]
  notesCount: number
  selectedCategory: CategoryRecord | null
  selectedTag: TagRecord | null
  selectedCategoryId: number | null
  selectedTagId: number | null
  fallbackCategoryId: number | null
  onSelectCategory: (id: number | null) => void
  onSelectTag: (id: number | null) => void
  onEditCategory: (category: CategoryRecord) => void
  onDeleteCategory: (category: CategoryRecord) => void
  onEditTag: (tag: TagRecord) => void
  onDeleteTag: (tag: TagRecord) => void
}

export function FilterBanners({
  categories,
  tags,
  notesCount,
  selectedCategory,
  selectedTag,
  selectedCategoryId,
  selectedTagId,
  fallbackCategoryId,
  onSelectCategory,
  onSelectTag,
  onEditCategory,
  onDeleteCategory,
  onEditTag,
  onDeleteTag,
}: FilterBannersProps) {
  const [openDropdown, setOpenDropdown] = useState<"category" | "tag" | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!openDropdown) return

    const handlePointerDown = (event: globalThis.MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpenDropdown(null)
      }
    }
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpenDropdown(null)
      }
    }

    document.addEventListener("mousedown", handlePointerDown)
    document.addEventListener("keydown", handleKeyDown)
    return () => {
      document.removeEventListener("mousedown", handlePointerDown)
      document.removeEventListener("keydown", handleKeyDown)
    }
  }, [openDropdown])

  const handleSelectorKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    dropdown: "category" | "tag",
  ) => {
    if (event.key === "ArrowDown") {
      event.preventDefault()
      setOpenDropdown(dropdown)
    }
  }

  const handleClearClick = (event: MouseEvent<HTMLButtonElement>, kind: "category" | "tag") => {
    event.stopPropagation()
    if (kind === "category") {
      onSelectCategory(null)
    } else {
      onSelectTag(null)
    }
    setOpenDropdown(null)
  }

  return (
    <div className={styles.filterBanners} ref={rootRef}>
      <div className={styles.selectorWrap}>
        <Text variant="body-2" as="span" className={styles.filterText}>
          {selectedCategory && (
            <button
              type="button"
              className={styles.clearInline}
              onClick={(event) => handleClearClick(event, "category")}
              aria-label="Clear category filter"
            >
              x
            </button>
          )}
          <button
            type="button"
            className={styles.selectorButton}
            onClick={() =>
              setOpenDropdown((current) => (current === "category" ? null : "category"))
            }
            onKeyDown={(event) => handleSelectorKeyDown(event, "category")}
            aria-expanded={openDropdown === "category"}
            aria-haspopup="true"
          >
            <span className={styles.selectorLabel}>
              {selectedCategory ? (
                <>
                  <span>category: </span>
                  {selectedCategory.label}
                  <span> {selectedCategory.noteCount}</span>
                </>
              ) : (
                "all categories"
              )}
            </span>
            <CaretDownIcon size={14} />
          </button>
        </Text>

        {openDropdown === "category" && (
          <div className={styles.dropdown} role="list" aria-label="Category filter">
            <FilterRow
              active={selectedCategoryId === null}
              label="All categories"
              count={notesCount}
              bold
              onSelect={() => {
                onSelectCategory(null)
                setOpenDropdown(null)
              }}
            />
            {categories.map((category) => (
              <FilterRow
                key={category.id}
                active={selectedCategoryId === category.id}
                label={category.label}
                count={category.noteCount}
                onSelect={() => {
                  onSelectCategory(selectedCategoryId === category.id ? null : category.id)
                  setOpenDropdown(null)
                }}
                onEdit={() => {
                  setOpenDropdown(null)
                  onEditCategory(category)
                }}
                onDelete={
                  category.id !== fallbackCategoryId
                    ? () => {
                        setOpenDropdown(null)
                        onDeleteCategory(category)
                      }
                    : undefined
                }
              />
            ))}
            {categories.length === 0 && (
              <Text variant="caption-1" color="secondary" className={styles.emptyText}>
                No categories yet. Create one from the note form.
              </Text>
            )}
          </div>
        )}
      </div>

      <div className={styles.selectorWrap}>
        <Text variant="body-2" as="span" className={styles.filterText}>
          {selectedTag && (
            <button
              type="button"
              className={styles.clearInline}
              onClick={(event) => handleClearClick(event, "tag")}
              aria-label="Clear tag filter"
            >
              x
            </button>
          )}
          <button
            type="button"
            className={styles.selectorButton}
            onClick={() => setOpenDropdown((current) => (current === "tag" ? null : "tag"))}
            onKeyDown={(event) => handleSelectorKeyDown(event, "tag")}
            aria-expanded={openDropdown === "tag"}
            aria-haspopup="true"
          >
            <span className={styles.selectorLabel}>
              {selectedTag ? (
                <>
                  <span>tag: </span>
                  {selectedTag.label}
                  <span> {selectedTag.noteCount}</span>
                </>
              ) : (
                "all tags"
              )}
            </span>
            <CaretDownIcon size={14} />
          </button>
        </Text>

        {openDropdown === "tag" && (
          <div className={styles.dropdown} role="list" aria-label="Tag filter">
            <FilterRow
              active={selectedTagId === null}
              label="All tags"
              count={notesCount}
              bold
              onSelect={() => {
                onSelectTag(null)
                setOpenDropdown(null)
              }}
            />
            {tags.map((tag) => (
              <FilterRow
                key={tag.id}
                active={selectedTagId === tag.id}
                label={tag.label}
                count={tag.noteCount}
                onSelect={() => {
                  onSelectTag(selectedTagId === tag.id ? null : tag.id)
                  setOpenDropdown(null)
                }}
                onEdit={() => {
                  setOpenDropdown(null)
                  onEditTag(tag)
                }}
                onDelete={() => {
                  setOpenDropdown(null)
                  onDeleteTag(tag)
                }}
              />
            ))}
            {tags.length === 0 && (
              <Text variant="caption-1" color="secondary" className={styles.emptyText}>
                No tags yet. Create one from the note form.
              </Text>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

interface FilterRowProps {
  active: boolean
  label: string
  count: number
  bold?: boolean
  onSelect: () => void
  onEdit?: () => void
  onDelete?: () => void
}

function FilterRow({
  active,
  label,
  count,
  bold = false,
  onSelect,
  onEdit,
  onDelete,
}: FilterRowProps) {
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault()
      onSelect()
    }
  }

  return (
    <div
      className={`${styles.tagRow} ${bold ? styles.tagRowAll : ""} ${
        active ? styles.tagRowActive : ""
      }`}
      onClick={onSelect}
      onKeyDown={handleKeyDown}
      role="listitem"
      tabIndex={0}
      title={label}
    >
      <div className={styles.tagLabel}>
        <Text variant="body-2" as={bold ? "b" : "span"}>
          {label}
        </Text>
      </div>
      <div className={styles.tagMeta}>
        <span className={styles.tagCount}>{count}</span>
        <div className={styles.tagActionSlot}>
          {onEdit && (
            <Button
              view="flat"
              size="xs"
              onClick={(event) => {
                event.stopPropagation()
                onEdit()
              }}
              aria-label={`Edit ${label}`}
            >
              <Icon data={Pencil} size={14} />
            </Button>
          )}
        </div>
        <div className={styles.tagActionSlot}>
          {onDelete && (
            <Button
              view="flat"
              size="xs"
              onClick={(event) => {
                event.stopPropagation()
                onDelete()
              }}
              aria-label={`Delete ${label}`}
            >
              <Icon data={TrashBin} size={14} />
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
