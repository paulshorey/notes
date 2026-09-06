"use client"

import type { NoteRecord } from "@lib/db-notes"
import { Text } from "@gravity-ui/uikit"
import type { ReactNode } from "react"
import { noteHeadline } from "@/lib/strings"
import styles from "./NoteResultsList.module.css"

export interface DisplayNoteItem {
  note: NoteRecord
  relevance?: number | null
}

interface NoteResultsListProps {
  items: DisplayNoteItem[]
  activeNoteId: number | null
  openNoteIds: number[]
  loading: boolean
  emptyMessage: string
  onEdit: (note: NoteRecord) => void
  renderAction?: (note: NoteRecord) => ReactNode
}

const formatSimilarity = (value: number | null | undefined) => {
  if (typeof value !== "number") return null
  return `${Math.max(0, Math.min(100, Math.round(value * 100)))}%`
}

export function NoteResultsList({
  items,
  activeNoteId,
  openNoteIds,
  loading,
  emptyMessage,
  onEdit,
  renderAction,
}: NoteResultsListProps) {
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
    <div className={styles.noteList}>
      {items.map(({ note, relevance }) => {
        const isActive = activeNoteId === note.id
        const isOpen = !isActive && openNoteIds.includes(note.id)
        const relevanceLabel = formatSimilarity(relevance)

        return (
          <div
            className={`${styles.noteItem} ${isActive ? styles.noteItemActive : ""} ${
              isOpen ? styles.noteItemOpen : ""
            }`}
            key={note.id}
            onClick={() => onEdit(note)}
            role="button"
            tabIndex={0}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault()
                onEdit(note)
              }
            }}
            aria-label={`Edit note: ${noteHeadline(note.description)}`}
          >
            <div className={styles.noteLine}>
              <div className={styles.noteTitleCollapsed}>{noteHeadline(note.description)}</div>
              {relevanceLabel && <span className={styles.similarityBadge}>{relevanceLabel}</span>}
              {renderAction && (
                <div className={styles.noteAction} onClick={(event) => event.stopPropagation()}>
                  {renderAction(note)}
                </div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
