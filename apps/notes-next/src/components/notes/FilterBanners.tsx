"use client"

import { Text } from "@gravity-ui/uikit"
import type { CategoryRecord, TagRecord } from "@lib/db-marketing"
import styles from "./FilterBanners.module.css"

interface FilterBannersProps {
  selectedCategory: CategoryRecord | null
  selectedTag: TagRecord | null
  onClearCategory: () => void
  onClearTag: () => void
}

export function FilterBanners({
  selectedCategory,
  selectedTag,
  onClearCategory,
  onClearTag,
}: FilterBannersProps) {
  if (!selectedCategory && !selectedTag) {
    return null
  }

  return (
    <div className={styles.filterBanners}>
      {selectedCategory && (
        <div>
          <Text variant="body-2" as="span" className={styles.filterText}>
            <button
              type="button"
              className={styles.clearInline}
              onClick={onClearCategory}
              aria-label="Clear category filter"
            >
              x
            </button>
            <span>category: </span>{selectedCategory.label}<span> {selectedCategory.noteCount}</span>
          </Text>
        </div>
      )}
      {selectedTag && (
        <div>
          <Text variant="body-2" as="span" className={styles.filterText}>
            <button
              type="button"
              className={styles.clearInline}
              onClick={onClearTag}
              aria-label="Clear tag filter"
            >
              x
            </button>
            <span>tags: </span>{selectedTag.label}<span> {selectedTag.noteCount}</span>
          </Text>
        </div>
      )}
    </div>
  )
}
