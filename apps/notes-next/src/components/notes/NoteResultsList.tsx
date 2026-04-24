"use client"

import type { NoteRecord } from "@lib/db-marketing"
import { Text } from "@gravity-ui/uikit"
import styles from "./NotesApp.module.css"

export interface DisplayNoteItem {
  note: NoteRecord
  relevance?: number | null
}

interface NoteResultsListProps {
  items: DisplayNoteItem[]
  activeNoteId: number | null
  loading: boolean
  emptyMessage: string
  onEdit: (note: NoteRecord) => void
}

const formatSimilarity = (value: number | null | undefined) => {
  if (typeof value !== "number") return null
  return `${Math.max(0, Math.min(100, Math.round(value * 100)))}%`
}

function noteHeadline(note: NoteRecord): string {
  const raw = note.description?.trim() ?? ""
  if (raw === "") return "Untitled"
  const firstLine = raw.split(/\r?\n/)[0] ?? ""
  if (firstLine.length <= 100) return firstLine
  return firstLine.slice(0, 100) + "…"
}

export function NoteResultsList({
  items,
  activeNoteId,
  loading,
  emptyMessage,
  onEdit,
}: NoteResultsListProps) {
  if (loading) {
    return (
      <Text variant="body-1" color="secondary">
        Loading…
      </Text>
    )
  }

  if (items.length === 0) {
    return (
      <Text variant="body-1" color="secondary">
        {emptyMessage}
      </Text>
    )
  }

  return (
    <div className={styles.noteList}>
      {items.map(({ note, relevance }) => {
        const isActive = activeNoteId === note.id
        const relevanceLabel = formatSimilarity(relevance)

        return (
          <div
            className={`${styles.noteItem} ${isActive ? styles.noteItemActive : ""}`}
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
            aria-label={`Edit note: ${noteHeadline(note)}`}
          >
            <div className={styles.noteLine}>
              <div className={styles.noteTitleCollapsed}>
                {noteHeadline(note)}
              </div>
              {relevanceLabel && <span className={styles.similarityBadge}>{relevanceLabel}</span>}
            </div>
          </div>
        )
      })}
    </div>
  )
}
