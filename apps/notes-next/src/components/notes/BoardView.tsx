"use client"

import type { CSSProperties, ReactNode } from "react"
import type { NoteRecord, WorkflowStatusRecord } from "@lib/db-marketing"
import { Button, Popup, Text } from "@gravity-ui/uikit"
import { CaretDown, PencilSimple, SidebarSimple } from "@phosphor-icons/react"
import { useMemo, useRef, useState } from "react"
import styles from "./BoardView.module.css"

export interface BoardStatusGroup {
  status: WorkflowStatusRecord
  notes: NoteRecord[]
}

interface BoardViewProps {
  visible: boolean
  columnStyle: CSSProperties
  loading: boolean
  workflowStatuses: WorkflowStatusRecord[]
  statusGroups: BoardStatusGroup[]
  activeNoteId: number | null
  onEditNote: (note: NoteRecord) => void
  onMoveNoteToStatus: (note: NoteRecord, workflowStatusId: number) => void | Promise<void>
  onRemoveNoteFromBoard: (note: NoteRecord) => void | Promise<void>
  onEditWorkflowStatus: (status: WorkflowStatusRecord) => void
  onClose: () => void
}

function noteHeadline(note: NoteRecord): string {
  const raw = note.description?.trim() ?? ""
  if (raw === "") return "Untitled"
  const firstLine = (raw.split(/\r?\n/)[0] ?? "").replaceAll(/[^\w\s]/g, "").trim()
  if (firstLine.length <= 80) return firstLine
  return `${firstLine.slice(0, 80)}…`
}

function BoardNoteCard({
  note,
  isActive,
  workflowStatuses,
  onEditNote,
  onMoveNoteToStatus,
  onRemoveNoteFromBoard,
}: {
  note: NoteRecord
  isActive: boolean
  workflowStatuses: WorkflowStatusRecord[]
  onEditNote: (note: NoteRecord) => void
  onMoveNoteToStatus: (note: NoteRecord, workflowStatusId: number) => void | Promise<void>
  onRemoveNoteFromBoard: (note: NoteRecord) => void | Promise<void>
}) {
  const moveTriggerRef = useRef<HTMLButtonElement | null>(null)
  const [moveMenuOpen, setMoveMenuOpen] = useState(false)

  const moveTargets = workflowStatuses.filter(
    (status) => status.id !== note.workflowStatus?.id,
  )

  return (
    <div
      className={`${styles.noteCard} ${isActive ? styles.noteCardActive : ""}`}
      onClick={() => onEditNote(note)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault()
          onEditNote(note)
        }
      }}
      role="button"
      tabIndex={0}
    >
      <Text variant="body-2" className={styles.noteCardTitle}>
        {noteHeadline(note)}
      </Text>
      <div className={styles.noteCardMeta}>
        <span className={styles.noteCardBadge}>{note.category.label}</span>
        {note.timeDue && <span className={styles.noteCardBadge}>due</span>}
        {note.timeRemind && <span className={styles.noteCardBadge}>remind</span>}
      </div>
      <div
        className={styles.cardActions}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
      >
        <Button
          ref={moveTriggerRef}
          view="flat"
          size="xs"
          onClick={() => setMoveMenuOpen((open) => !open)}
          aria-expanded={moveMenuOpen}
          aria-haspopup="menu"
        >
          Move
          <CaretDown size={12} weight="regular" />
        </Button>
        <Popup
          anchorRef={moveTriggerRef}
          open={moveMenuOpen}
          onClose={() => setMoveMenuOpen(false)}
          placement={["bottom-end", "top-end"]}
          offset={4}
          role="menu"
        >
          <div className={styles.moveMenu}>
            {moveTargets.map((status) => (
              <button
                key={status.id}
                type="button"
                className={styles.moveMenuItem}
                onClick={() => {
                  setMoveMenuOpen(false)
                  void onMoveNoteToStatus(note, status.id)
                }}
                role="menuitem"
              >
                {status.label}
              </button>
            ))}
            <button
              type="button"
              className={styles.moveMenuItem}
              onClick={() => {
                setMoveMenuOpen(false)
                void onRemoveNoteFromBoard(note)
              }}
              role="menuitem"
            >
              Remove from board
            </button>
          </div>
        </Popup>
      </div>
    </div>
  )
}

export function BoardView({
  visible,
  columnStyle,
  loading,
  workflowStatuses,
  statusGroups,
  activeNoteId,
  onEditNote,
  onMoveNoteToStatus,
  onRemoveNoteFromBoard,
  onEditWorkflowStatus,
  onClose,
}: BoardViewProps) {
  const shellClassName = `${styles.boardShell} ${visible ? "" : styles.boardShellCollapsed}`

  const body = useMemo<ReactNode>(() => {
    if (loading) {
      return (
        <div className={styles.listStatus}>
          <Text variant="body-1" color="secondary">
            Loading board…
          </Text>
        </div>
      )
    }

    if (workflowStatuses.length === 0) {
      return (
        <div className={styles.listStatus}>
          <Text variant="body-1" color="secondary">
            No board columns yet.
          </Text>
        </div>
      )
    }

    return (
      <div className={styles.boardBody}>
        {statusGroups.map(({ status, notes }) => (
          <section key={status.id} className={styles.statusColumn} aria-label={status.label}>
            <div className={styles.statusHeader}>
              <Text variant="subheader-1" className={styles.statusTitle}>
                {status.label}
              </Text>
              <div className={styles.statusActions}>
                <Text variant="caption-2" color="secondary" className={styles.statusCount}>
                  {notes.length}
                </Text>
                <Button
                  view="flat"
                  size="xs"
                  aria-label={`Edit ${status.label} column`}
                  onClick={() => onEditWorkflowStatus(status)}
                >
                  <PencilSimple size={14} weight="regular" />
                </Button>
              </div>
            </div>
            <div className={styles.statusCards}>
              {notes.length === 0 ? (
                <Text variant="caption-1" color="secondary" className={styles.emptyColumn}>
                  Empty
                </Text>
              ) : (
                notes.map((note) => (
                  <BoardNoteCard
                    key={note.id}
                    note={note}
                    isActive={activeNoteId === note.id}
                    workflowStatuses={workflowStatuses}
                    onEditNote={onEditNote}
                    onMoveNoteToStatus={onMoveNoteToStatus}
                    onRemoveNoteFromBoard={onRemoveNoteFromBoard}
                  />
                ))
              )}
            </div>
          </section>
        ))}
      </div>
    )
  }, [
    activeNoteId,
    loading,
    onEditNote,
    onEditWorkflowStatus,
    onMoveNoteToStatus,
    onRemoveNoteFromBoard,
    statusGroups,
    workflowStatuses,
  ])

  return (
    <div className={shellClassName} style={columnStyle}>
      <section className={styles.boardColumn}>
        <header className={styles.header}>
          <Button
            view="flat"
            size="m"
            onClick={onClose}
            aria-label="Hide board"
            className={styles.closeButton}
          >
            <SidebarSimple size={18} weight="regular" />
          </Button>
        </header>
        {body}
      </section>
    </div>
  )
}
