"use client"

import { Button, Icon, Text } from "@gravity-ui/uikit"
import { Pencil, TrashBin } from "@gravity-ui/icons"
import type { CategoryRecord, TagRecord } from "@lib/db-marketing"
import styles from "./NotesApp.module.css"

interface NotesSidebarProps {
  categories: CategoryRecord[]
  tags: TagRecord[]
  notesCount: number
  selectedCategoryId: number | null
  selectedTagId: number | null
  fallbackCategoryId: number | null
  hidden: boolean
  onHide: () => void
  onSelectCategory: (id: number | null) => void
  onSelectTag: (id: number | null) => void
  onEditCategory: (category: CategoryRecord) => void
  onDeleteCategory: (category: CategoryRecord) => void
  onEditTag: (tag: TagRecord) => void
  onDeleteTag: (tag: TagRecord) => void
}

export function NotesSidebar({
  categories,
  tags,
  notesCount,
  selectedCategoryId,
  selectedTagId,
  fallbackCategoryId,
  hidden,
  onHide,
  onSelectCategory,
  onSelectTag,
  onEditCategory,
  onDeleteCategory,
  onEditTag,
  onDeleteTag,
}: NotesSidebarProps) {
  return (
    <aside
      className={`${styles.sidebarColumn} ${hidden ? styles.columnCollapsed : ""}`}
      aria-hidden={hidden}
    >
      <div className={styles.header}>
        <Button view="flat" size="s" onClick={onHide}>
          Hide
        </Button>
      </div>
      <div className={styles.tagList}>
          <div
            className={`${styles.tagRow} ${styles.tagRowAll} ${
              selectedCategoryId === null ? styles.tagRowActive : ""
            }`}
          >
            <button
              type="button"
              className={styles.tagLabel}
              onClick={() => onSelectCategory(null)}
            >
              <Text variant="body-2" as="span">
                All categories
              </Text>
            </button>
            <div className={styles.tagMeta}>
              <span className={styles.tagCount}>{notesCount}</span>
              <span className={styles.tagActionSlot} aria-hidden="true" />
              <span className={styles.tagActionSlot} aria-hidden="true" />
            </div>
          </div>
          {categories.map((category) => {
            const isActive = selectedCategoryId === category.id
            return (
              <div
                key={category.id}
                className={`${styles.tagRow} ${isActive ? styles.tagRowActive : ""}`}
              >
                <button
                  type="button"
                  className={styles.tagLabel}
                  onClick={() => onSelectCategory(isActive ? null : category.id)}
                  title={category.label}
                >
                  <Text variant="body-2" as="span">
                    {category.label}
                  </Text>
                </button>
                <div className={styles.tagMeta}>
                  <span className={styles.tagCount}>{category.noteCount}</span>
                  <div className={styles.tagActionSlot}>
                    <Button
                      view="flat"
                      size="xs"
                      onClick={() => onEditCategory(category)}
                      aria-label={`Edit ${category.label}`}
                    >
                      <Icon data={Pencil} size={14} />
                    </Button>
                  </div>
                  <div className={styles.tagActionSlot}>
                    {category.id !== fallbackCategoryId ? (
                      <Button
                        view="flat"
                        size="xs"
                        onClick={() => onDeleteCategory(category)}
                        aria-label={`Delete ${category.label}`}
                      >
                        <Icon data={TrashBin} size={14} />
                      </Button>
                    ) : null}
                  </div>
                </div>
              </div>
            )
          })}
          {categories.length === 0 && (
            <Text variant="caption-1" color="secondary">
              No categories yet. Create one from the note form.
            </Text>
          )}
        </div>

        <div className={styles.tagList}>
          <div
            className={`${styles.tagRow} ${styles.tagRowAll} ${
              selectedTagId === null ? styles.tagRowActive : ""
            }`}
          >
            <button
              type="button"
              className={styles.tagLabel}
              onClick={() => onSelectTag(null)}
            >
              <Text variant="body-2" as="span">
                All notes
              </Text>
            </button>
            <div className={styles.tagMeta}>
              <span className={styles.tagCount}>{notesCount}</span>
              <span className={styles.tagActionSlot} aria-hidden="true" />
              <span className={styles.tagActionSlot} aria-hidden="true" />
            </div>
          </div>
          {tags.map((tag) => {
            const isActive = selectedTagId === tag.id
            return (
              <div
                key={tag.id}
                className={`${styles.tagRow} ${isActive ? styles.tagRowActive : ""}`}
              >
                <button
                  type="button"
                  className={styles.tagLabel}
                  onClick={() => onSelectTag(isActive ? null : tag.id)}
                  title={tag.label}
                >
                  <Text variant="body-2" as="span">
                    {tag.label}
                  </Text>
                </button>
                <div className={styles.tagMeta}>
                  <span className={styles.tagCount}>{tag.noteCount}</span>
                  <div className={styles.tagActionSlot}>
                    <Button
                      view="flat"
                      size="xs"
                      onClick={() => onEditTag(tag)}
                      aria-label={`Edit ${tag.label}`}
                    >
                      <Icon data={Pencil} size={14} />
                    </Button>
                  </div>
                  <div className={styles.tagActionSlot}>
                    <Button
                      view="flat"
                      size="xs"
                      onClick={() => onDeleteTag(tag)}
                      aria-label={`Delete ${tag.label}`}
                    >
                      <Icon data={TrashBin} size={14} />
                    </Button>
                  </div>
                </div>
              </div>
            )
          })}
          {tags.length === 0 && (
            <Text variant="caption-1" color="secondary">
              No tags yet. Create one from the note form.
            </Text>
          )}
        </div>
    </aside>
  )
}
