"use client"

import type { ItemRecord } from "@lib/db-items"
import { Text } from "@gravity-ui/uikit"
import type { ReactNode } from "react"
import { itemHeadline } from "@/lib/strings"
import type { DisplayItemItem } from "@/lib/itemGroups"
import styles from "./ItemResultsList.module.css"

interface ItemResultsListProps {
  items: DisplayItemItem[]
  activeItemId: number | null
  openItemIds: number[]
  loading: boolean
  emptyMessage: string
  onEdit: (item: ItemRecord) => void
  renderAction: (item: ItemRecord) => ReactNode
}

const formatSimilarity = (value: number | null | undefined) => {
  if (typeof value !== "number") return null
  return `${Math.max(0, Math.min(100, Math.round(value * 100)))}%`
}

export function ItemResultsList({
  items,
  activeItemId,
  openItemIds,
  loading,
  emptyMessage,
  onEdit,
  renderAction,
}: ItemResultsListProps) {
  if (loading) {
    return (
      <div className={styles.listStatus}>
        <Text variant="body-1" color="secondary">
          Loading…
        </Text>
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div className={styles.listStatus}>
        <Text variant="body-1" color="secondary">
          {emptyMessage}
        </Text>
      </div>
    )
  }

  return (
    <div className={styles.itemList}>
      {items.map(({ item, relevance }) => {
        const isActive = activeItemId === item.id
        const isOpen = openItemIds.includes(item.id)
        const relevanceLabel = formatSimilarity(relevance)

        return (
          <div
            className={`${styles.itemItem} ${isActive ? styles.itemItemActive : ""} ${
              isOpen ? styles.itemItemOpen : ""
            }`}
            key={item.id}
            onClick={() => onEdit(item)}
            role="button"
            tabIndex={0}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault()
                onEdit(item)
              }
            }}
            aria-label={`Edit note: ${itemHeadline(item.description)}`}
          >
            <div className={styles.itemLine}>
              <div className={styles.itemTitleCollapsed}>{itemHeadline(item.description)}</div>
              {relevanceLabel && <span className={styles.similarityBadge}>{relevanceLabel}</span>}
              <div
                className={styles.itemAction}
                onClick={(event) => event.stopPropagation()}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") event.stopPropagation()
                }}
              >
                {renderAction(item)}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
