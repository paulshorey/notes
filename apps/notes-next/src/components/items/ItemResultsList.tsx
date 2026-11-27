"use client"

import type { ItemRecord } from "@lib/db-items"
import { CalendarBlank, Clock } from "@phosphor-icons/react"
import { isKind } from "@lib/db-items/contracts/item-kinds"
import { Text } from "@gravity-ui/uikit"
import type { ReactNode } from "react"
import { itemListLabel } from "@/capabilities/draftParts"
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
        const label = itemListLabel(item)
        const task = isKind(item, "task")
        const time = isKind(item, "time")
        const kinds = [task && "task", time && "time"].filter(Boolean).join(", ")
        const isActive = activeItemId === item.id
        const isOpen = openItemIds.includes(item.id)
        const relevanceLabel = formatSimilarity(relevance)

        return (
          <div
            className={`${styles.itemItem} ${isActive ? styles.itemItemActive : ""} ${
              isOpen ? styles.itemItemOpen : ""
            }`}
            key={item.id}
          >
            <button
              type="button"
              className={styles.itemLine}
              onClick={() => onEdit(item)}
              aria-label={`Edit item: ${label}${kinds ? `, ${kinds}` : ""}`}
            >
              <span className={styles.itemTitleCollapsed}>{label}</span>
              {task && (
                <CalendarBlank className={styles.kindIcon} size={14} aria-label="Task" role="img" />
              )}
              {time && <Clock className={styles.kindIcon} size={14} aria-label="Time" role="img" />}
              {relevanceLabel && <span className={styles.similarityBadge}>{relevanceLabel}</span>}
            </button>
            {renderAction(item)}
          </div>
        )
      })}
    </div>
  )
}
