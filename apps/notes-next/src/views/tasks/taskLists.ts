import type { ItemRecord, StatusRecord } from "@lib/db-items"

export interface TaskColumn {
  /** null for the column of tasks whose status is not in the workspace's list. */
  status: StatusRecord | null
  items: ItemRecord[]
}

const time = (value: string | null) => (value === null ? null : new Date(value).getTime())

/** Soonest due first, items with no due date after them, then most recently changed. */
export const compareTasks = (left: ItemRecord, right: ItemRecord): number => {
  const leftDue = time(left.timeDue)
  const rightDue = time(right.timeDue)
  if (leftDue !== rightDue) {
    if (leftDue === null) return 1
    if (rightDue === null) return -1
    return leftDue - rightDue
  }
  return (time(right.timeModified) ?? 0) - (time(left.timeModified) ?? 0) || left.id - right.id
}

/**
 * The board: one column per workspace status in position order. A task whose status is
 * missing from that list, as when the list is older than the task, goes in a last
 * column that appears only then.
 */
export const taskBoardColumns = (tasks: ItemRecord[], statuses: StatusRecord[]): TaskColumn[] => {
  const columns: TaskColumn[] = [...statuses]
    .sort((left, right) => left.position - right.position || left.id - right.id)
    .map((status) => ({
      status,
      items: tasks.filter((task) => task.status?.id === status.id).sort(compareTasks),
    }))
  const known = new Set(statuses.map((status) => status.id))
  const unsorted = tasks
    .filter((task) => task.status !== null && !known.has(task.status.id))
    .sort(compareTasks)
  return unsorted.length > 0 ? [...columns, { status: null, items: unsorted }] : columns
}

/** The list: every task by due date, so overdue tasks come first. */
export const taskList = (tasks: ItemRecord[]): ItemRecord[] => [...tasks].sort(compareTasks)

export const isOverdue = (task: ItemRecord, now: number): boolean => {
  const due = time(task.timeDue)
  return due !== null && due < now
}

export const dueLabel = (task: ItemRecord): string | null =>
  task.timeDue === null
    ? null
    : new Date(task.timeDue).toLocaleDateString(undefined, { month: "short", day: "numeric" })
