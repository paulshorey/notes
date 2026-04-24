"use client"

import { Button, Text } from "@gravity-ui/uikit"
import type { CategoryRecord, TagRecord } from "@lib/db-marketing"
import styles from "./NotesApp.module.css"

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
        <div className={styles.filterBanner}>
          <Text variant="body-2">
            Filtered by category <strong>{selectedCategory.label}</strong> ·{" "}
            {selectedCategory.noteCount}{" "}
            {selectedCategory.noteCount === 1 ? "note" : "notes"}
          </Text>
          <Button view="flat" size="xs" onClick={onClearCategory}>
            Clear
          </Button>
        </div>
      )}
      {selectedTag && (
        <div className={styles.filterBanner}>
          <Text variant="body-2">
            Filtered by <strong>{selectedTag.label}</strong> · {selectedTag.noteCount}{" "}
            {selectedTag.noteCount === 1 ? "note" : "notes"}
          </Text>
          <Button view="flat" size="xs" onClick={onClearTag}>
            Clear
          </Button>
        </div>
      )}
    </div>
  )
}
