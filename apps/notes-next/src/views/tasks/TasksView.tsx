"use client"

import type { ItemRecord, StatusRecord } from "@lib/db-items"
import { Modal } from "@gravity-ui/uikit"
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react"
import { itemListLabel } from "@/capabilities/draftParts"
import { ItemEditor } from "@/components/items/ItemEditor"
import { itemFilingLabel } from "@/lib/itemFiling"
import { useItemsAppStore } from "@/stores/itemsAppStore"
import type { OpenItemKey } from "@/stores/openItems"
import { useItemsWorkspace } from "@/workspace/ItemsWorkspaceProvider"
import { dueLabel, isOverdue, taskBoardColumns, taskList } from "./taskLists"
import styles from "./TasksView.module.css"

const DRAG_TYPE = "application/x-item-id"

/**
 * The `task` view shows the workspace's tasks in a board by status or a list by due date.
 * A card opens the shared editor in a dialog over the board, so its text is the text
 * the `note` view edits.
 */
export function TasksView() {
  const {
    activeEntry,
    activeKey,
    handleOpenItemFromResults,
    handleQuickAddItem,
    handleSetItemStatus,
    matchesSelectedTag,
    statuses,
    viewItems,
  } = useItemsWorkspace()

  const workspaceMoveOpen = useItemsAppStore(
    (state) => state.itemGroupDialog?.intent === "move-to-workspace",
  )
  const [layout, setLayout] = useState<"board" | "list">("board")

  // The editor shows the entry the user last opened here, from a card, the sidebar,
  // or the header. Every such action counts as an open request, including one for the
  // entry that is already active. When another entry becomes active without one (the
  // open entry was closed), the board comes back.
  const openRequestCount = useItemsAppStore((state) => state.openRequestCount)
  const seenOpenRequests = useRef(openRequestCount)
  const [editorKey, setEditorKey] = useState<OpenItemKey | null>(null)
  useEffect(() => {
    if (openRequestCount === seenOpenRequests.current) return
    seenOpenRequests.current = openRequestCount
    setEditorKey(useItemsAppStore.getState().activeKey)
  }, [openRequestCount])
  // The editor waits for this view to take the entry over. Until edits made under
  // another view are stored, that view's rule still applies to it, so it stays out
  // of this editor and the board stays up.
  const editorOpen = editorKey !== null && editorKey === activeKey && activeEntry?.view === "task"

  // Overdue is relative to now, so the clock moves while the view stays open.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  const tasks = useMemo(() => viewItems.filter(matchesSelectedTag), [matchesSelectedTag, viewItems])
  const columns = useMemo(() => taskBoardColumns(tasks, statuses), [statuses, tasks])
  const list = useMemo(() => taskList(tasks), [tasks])

  const openTask = (task: ItemRecord) => handleOpenItemFromResults(task)
  const closeEditor = () => setEditorKey(null)

  // A status makes a task, so a drag only ever moves a card between statuses. The
  // last column holds no status to move to.
  const moveTask = (task: ItemRecord, status: StatusRecord | null) => {
    if (status !== null) void handleSetItemStatus(task, status.id)
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
              now={now}
              onDropTask={(task) => moveTask(task, column.status)}
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
            <TaskCard key={task.id} task={task} now={now} onOpen={openTask} showStatus />
          ))}
        </div>
      )}

      {/* A card opens over the board, so closing it returns to the same place. */}
      <Modal
        open={editorOpen}
        onClose={closeEditor}
        disableOutsideClick={workspaceMoveOpen}
        disableEscapeKeyDown={workspaceMoveOpen}
        aria-label="task"
      >
        <div className={styles.editorDialog} inert={workspaceMoveOpen}>
          {editorOpen && <ItemEditor onClose={closeEditor} />}
        </div>
      </Modal>
    </div>
  )
}

function TaskColumnView({
  status,
  tasks,
  now,
  onOpen,
  onDropTask,
  onQuickAdd,
  findTask,
}: {
  status: StatusRecord | null
  tasks: ItemRecord[]
  now: number
  onOpen: (task: ItemRecord) => void
  onDropTask: (task: ItemRecord) => void
  onQuickAdd: (text: string) => Promise<boolean>
  findTask: (id: number) => ItemRecord | null
}) {
  const [dropTarget, setDropTarget] = useState(false)
  const [quickAddText, setQuickAddText] = useState("")
  const [adding, setAdding] = useState(false)
  const label = status?.label ?? "Other"

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
          <TaskCard key={task.id} task={task} now={now} onOpen={onOpen} draggable />
        ))}
      </div>
      {/* The last column has no status to give a new task. */}
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
  now,
  onOpen,
  draggable = false,
  showStatus = false,
}: {
  task: ItemRecord
  now: number
  onOpen: (task: ItemRecord) => void
  draggable?: boolean
  showStatus?: boolean
}) {
  const title = itemListLabel(task)
  const due = dueLabel(task)
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
