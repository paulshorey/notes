"use client"

import { Button, Icon, Text } from "@gravity-ui/uikit"
import { Pencil, TrashBin } from "@gravity-ui/icons"
import type { TagRecord } from "@lib/db-marketing"
import { type KeyboardEvent, type MouseEvent, useEffect, useRef, useState } from "react"
import { CaretDownIcon } from "@/components/ui/icons/CaretDownIcon"
import { useNotesAppStore } from "@/stores/notesAppStore"
import styles from "./FilterBanners.module.css"

interface FilterBannersProps {
  tags: TagRecord[]
  notesCount: number
  onEditTag: (tag: TagRecord) => void
  onDeleteTag: (tag: TagRecord) => void
}

export function FilterBanners({
  tags,
  notesCount,
  onEditTag,
  onDeleteTag,
}: FilterBannersProps) {
  const [openDropdown, setOpenDropdown] = useState<"tag" | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const { selectedTagId, setSelectedTagId } = useNotesAppStore()
  const selectedTag =
    selectedTagId === null ? null : (tags.find((tag) => tag.id === selectedTagId) ?? null)

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
    dropdown: "tag",
  ) => {
    if (event.key === "ArrowDown") {
      event.preventDefault()
      setOpenDropdown(dropdown)
    }
  }

  const handleClearClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    setSelectedTagId(null)
    setOpenDropdown(null)
  }

  return (
    <div className={styles.filterBanners} ref={rootRef}>
      <div className={styles.selectorWrap}>
        <Text variant="body-2" as="span" className={styles.filterText}>
          {selectedTag && (
            <button
              type="button"
              className={styles.clearInline}
              onClick={handleClearClick}
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
                setSelectedTagId(null)
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
                  setSelectedTagId(selectedTagId === tag.id ? null : tag.id)
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
