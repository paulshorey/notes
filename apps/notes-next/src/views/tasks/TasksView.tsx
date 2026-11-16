"use client"

import type { ItemRecord, StatusRecord } from "@lib/db-items"
import { ArrowLeft } from "@phosphor-icons/react"
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react"
import { itemListLabel } from "@/capabilities/draftParts"
import { ItemEditor } from "@/components/items/ItemEditor"
import { itemFilingLabel } from "@/lib/itemFiling"
import { useItemsWorkspace } from "@/workspace/ItemsWorkspaceProvider"
import { dueLabel, isOverdue, taskBoardColumns, taskList } from "./taskLists"
import styles from "./TasksView.module.css"

const DRAG_TYPE = "application/x-item-id"

/**
 * The Tasks view: the workspace's tasks as a board by status or a list by due date.
 * A card opens the shared editor in place of the board, so its text is the text the
 * Notes view edits.
 */
export function TasksView() {
  const {
    activeEntry,
    handleOpenItemFromResults,
    handleQuickAddItem,
    handleSetItemStatus,
    matchesSelectedTag,
    statuses,
    viewItems,
  } = useItemsWorkspace()

  const [layout, setLayout] = useState<"board" | "list">("board")
  const [editorOpen, setEditorOpen] = useState(false)

  // The editor opens when the user opens an item here, from a card or the sidebar.
  // Each such action hands the entry to this view and marks it activated.
  const openedAt = activeEntry?.view === "task" ? activeEntry.lastActivatedAt : null
  const seenOpenedAt = useRef(openedAt)
  useEffect(() => {
    if (openedAt === seenOpenedAt.current) return
    seenOpenedAt.current = openedAt
    if (openedAt !== null) setEditorOpen(true)
  }, [openedAt])

  const tasks = useMemo(() => viewItems.filter(matchesSelectedTag), [matchesSelectedTag, viewItems])
  const columns = useMemo(() => taskBoardColumns(tasks, statuses), [statuses, tasks])
  const list = useMemo(() => taskList(tasks), [tasks])

  const openTask = (task: ItemRecord) => {
    handleOpenItemFromResults(task)
    setEditorOpen(true)
  }

  if (editorOpen && activeEntry) {
    return (
      <div className={styles.view}>
        <div className={styles.toolbar}>
          <button type="button" className={styles.back} onClick={() => setEditorOpen(false)}>
            <ArrowLeft size={14} weight="bold" aria-hidden />
            Tasks
          </button>
        </div>
        <ItemEditor />
      </div>
    )
  }

  return (
    <div className={styles.view}>
      <div className={styles.toolbar} role="tablist" aria-label="Task layout">
        {(["board", "list"] as const).map((option) => (
          <button
            key={option}
            type="button"
            role="tab"
            aria-selected={layout === option}
            className={`${styles.layoutTab} ${layout === option ? styles.layoutTabActive : ""}`}
            onClick={() => setLayout(option)}
          >
            {option === "board" ? "Board" : "List"}
          </button>
        ))}
      </div>

      {layout === "board" ? (
        <div className={styles.board}>
          {columns.length === 0 && (
            <p className={styles.empty}>
              Add a status from a note&apos;s More menu to start a board.
            </p>
          )}
          {columns.map((column) => (
            <TaskColumnView
              key={column.status?.id ?? "none"}
              status={column.status}
              tasks={column.items}
              onOpen={openTask}
              onDropTask={(task) => void handleSetItemStatus(task, column.status?.id ?? null)}
              onQuickAdd={(text) =>
                handleQuickAddItem(text, { statusId: column.status?.id ?? null })
              }
              findTask={(id) => tasks.find((task) => task.id === id) ?? null}
            />
          ))}
        </div>
      ) : (
        <div className={styles.list} role="list" aria-label="Tasks by due date">
          {list.length === 0 && <p className={styles.empty}>No tasks yet.</p>}
          {list.map((task) => (
            <TaskCard key={task.id} task={task} onOpen={openTask} showStatus />
          ))}
        </div>
      )}
    </div>
  )
}

function TaskColumnView({
  status,
  tasks,
  onOpen,
  onDropTask,
  onQuickAdd,
  findTask,
}: {
  status: StatusRecord | null
  tasks: ItemRecord[]
  onOpen: (task: ItemRecord) => void
  onDropTask: (task: ItemRecord) => void
  onQuickAdd: (text: string) => Promise<boolean>
  findTask: (id: number) => ItemRecord | null
}) {
  const [dropTarget, setDropTarget] = useState(false)
  const [quickAddText, setQuickAddText] = useState("")
  const [adding, setAdding] = useState(false)
  const label = status?.label ?? "No status"

  const submitQuickAdd = async (event: FormEvent) => {
    event.preventDefault()
    const text = quickAddText.trim()
    if (text === "" || adding) return
    setAdding(true)
    try {
      if (await onQuickAdd(text)) setQuickAddText("")
    } finally {
      setAdding(false)
    }
  }

  return (
    <section
      className={`${styles.column} ${dropTarget ? styles.columnDropTarget : ""}`}
      aria-label={`${label} column`}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes(DRAG_TYPE)) return
        event.preventDefault()
        event.dataTransfer.dropEffect = "move"
        setDropTarget(true)
      }}
      onDragLeave={() => setDropTarget(false)}
      onDrop={(event) => {
        setDropTarget(false)
        const task = findTask(Number(event.dataTransfer.getData(DRAG_TYPE)))
        if (!task) return
        event.preventDefault()
        onDropTask(task)
      }}
    >
      <header className={styles.columnHeader}>
        <span>{label}</span>
        <span className={styles.columnCount}>{tasks.length}</span>
      </header>
      <div className={styles.cards} role="list">
        {tasks.map((task) => (
          <TaskCard key={task.id} task={task} onOpen={onOpen} draggable />
        ))}
      </div>
      {/* A task enters the last column by having a date, so nothing is added there. */}
      {status && (
        <form className={styles.quickAdd} onSubmit={(event) => void submitQuickAdd(event)}>
          <input
            className={styles.quickAddInput}
            value={quickAddText}
            onChange={(event) => setQuickAddText(event.target.value)}
            placeholder="Add a task..."
            aria-label={`Add a task to ${label}`}
            disabled={adding}
          />
        </form>
      )}
    </section>
  )
}

function TaskCard({
  task,
  onOpen,
  draggable = false,
  showStatus = false,
}: {
  task: ItemRecord
  onOpen: (task: ItemRecord) => void
  draggable?: boolean
  showStatus?: boolean
}) {
  const title = itemListLabel(task)
  const due = dueLabel(task)
  // Read the clock once per mount: a card is redrawn whenever its item changes.
  const [now] = useState(() => Date.now())
  const filing = itemFilingLabel(task)

  return (
    <div
      role="listitem"
      className={styles.card}
      draggable={draggable}
      onDragStart={(event) => {
        event.dataTransfer.setData(DRAG_TYPE, String(task.id))
        event.dataTransfer.effectAllowed = "move"
      }}
    >
      <button
        type="button"
        className={styles.cardButton}
        onClick={() => onOpen(task)}
        aria-label={`Open task: ${title}`}
      >
        <span className={styles.cardTitle}>{title}</span>
        <span className={styles.cardMeta}>
          {showStatus && task.status && <span>{task.status.label}</span>}
          {due && (
            <span className={isOverdue(task, now) ? styles.overdue : undefined}>Due {due}</span>
          )}
          {filing && <span>{filing}</span>}
        </span>
      </button>
    </div>
  )
}
