import assert from "node:assert/strict"
import test from "node:test"
import type { ItemRecord, StatusRecord } from "@lib/db-items"
import { createEmptyItemDraft, draftHoldsContent } from "../src/capabilities/draftParts"
import { isOverdue, taskBoardColumns, taskList } from "../src/views/tasks/taskLists"
import { ITEM_VIEWS, canSaveEntry, viewForKind, viewForPath } from "../src/views/registry"

const status = (id: number, label: string, position: number): StatusRecord => ({
  id,
  workspaceId: 1,
  label,
  position,
  itemCount: 0,
  lastUsedAt: null,
})

const task = (id: number, overrides: Partial<ItemRecord> = {}): ItemRecord => ({
  id,
  workspaceId: 1,
  category: null,
  subcategory: null,
  status: null,
  tags: [],
  description: `task ${id}`,
  timeDue: null,
  timeRemind: null,
  timeCreated: "2026-01-01T00:00:00.000Z",
  timeModified: "2026-01-01T00:00:00.000Z",
  ...overrides,
})

const todo = status(1, "todo", 2)
const doing = status(2, "doing", 1)
const done = status(3, "done", 3)
const ids = (items: ItemRecord[]) => items.map((item) => item.id)

test("the board has one column per status in position order", () => {
  const columns = taskBoardColumns(
    [
      task(1, { status: { id: 1, label: "todo" } }),
      task(2, { status: { id: 3, label: "done" } }),
      task(3, { status: { id: 1, label: "todo" } }),
    ],
    [todo, doing, done],
  )
  assert.deepEqual(
    columns.map((column) => [column.status?.label, ids(column.items)]),
    [
      ["doing", []],
      ["todo", [1, 3]],
      ["done", [2]],
    ],
  )
})

test("tasks with a date and no status get a last column, only when there are some", () => {
  const dated = task(4, { timeDue: "2026-02-01T00:00:00.000Z" })
  assert.equal(taskBoardColumns([], [todo]).length, 1)
  const columns = taskBoardColumns([dated, task(5, { status: { id: 1, label: "todo" } })], [todo])
  assert.deepEqual(
    columns.map((column) => [column.status?.label ?? null, ids(column.items)]),
    [
      ["todo", [5]],
      [null, [4]],
    ],
  )
})

test("cards order by due date, then by the most recent change", () => {
  const sorted = taskList([
    task(1, { timeModified: "2026-01-05T00:00:00.000Z" }),
    task(2, { timeDue: "2026-03-01T00:00:00.000Z" }),
    task(3, { timeDue: "2026-02-01T00:00:00.000Z" }),
    task(4, { timeModified: "2026-01-09T00:00:00.000Z" }),
  ])
  assert.deepEqual(ids(sorted), [3, 2, 4, 1], "undated tasks follow dated ones, newest first")
})

test("a task is overdue once its due date has passed", () => {
  const now = new Date("2026-02-15T00:00:00.000Z").getTime()
  assert.equal(isOverdue(task(1, { timeDue: "2026-02-01T00:00:00.000Z" }), now), true)
  assert.equal(isOverdue(task(2, { timeDue: "2026-03-01T00:00:00.000Z" }), now), false)
  assert.equal(isOverdue(task(3), now), false)
})

test("a draft holds content when a save would store a capability", () => {
  const empty = createEmptyItemDraft()
  assert.equal(draftHoldsContent(empty), false)
  assert.equal(draftHoldsContent({ ...empty, selectedCategoryId: 7, selectedTagIds: [5] }), false)
  assert.equal(draftHoldsContent({ ...empty, description: "x" }), true)
  assert.equal(draftHoldsContent({ ...empty, selectedStatusId: 4 }), true)
  assert.equal(
    draftHoldsContent({ ...empty, dueExpanded: true, timeDue: "2026-03-04T10:30" }),
    true,
  )
  assert.equal(
    draftHoldsContent({ ...empty, dueExpanded: false, timeDue: "2026-03-04T10:30" }),
    false,
    "a collapsed date is not sent",
  )
})

test("the same stored item is judged by the view its entry belongs to", () => {
  const statusOnly = { ...createEmptyItemDraft(), selectedStatusId: 4 }
  assert.equal(canSaveEntry({ view: "note", itemId: 9, form: statusOnly }), false)
  assert.equal(canSaveEntry({ view: "task", itemId: 9, form: statusOnly }), true)
  assert.equal(canSaveEntry({ view: "task", itemId: 9, form: createEmptyItemDraft() }), false)
})

test("a blank draft creates nothing in any view", () => {
  const empty = createEmptyItemDraft()
  const preset = { ...empty, selectedStatusId: 4, selectedCategoryId: 7 }
  assert.equal(canSaveEntry({ view: "task", itemId: null, form: preset }), false)
  assert.equal(canSaveEntry({ view: "note", itemId: null, form: preset }), false)
  assert.equal(
    canSaveEntry({
      view: "task",
      itemId: null,
      form: { ...preset, dueExpanded: true, timeDue: "2026-03-04T10:30" },
    }),
    true,
    "a date the user added makes a task worth creating",
  )
  assert.equal(
    canSaveEntry({ view: "task", itemId: null, form: { ...preset, description: "x" } }),
    true,
  )
})

test("the Tasks view is registered beside Notes", () => {
  assert.deepEqual(
    ITEM_VIEWS.map((view) => [view.kind, view.route]),
    [
      ["note", "/"],
      ["task", "/tasks"],
    ],
  )
  assert.equal(viewForPath("/tasks").kind, "task")
  assert.equal(viewForPath("/tasks/12").kind, "task")
  assert.equal(viewForPath("/").kind, "note")
  const tasks = viewForKind("task")
  assert.equal(tasks.alwaysShowsEditor, false)
  assert.deepEqual(tasks.quickAddDefaults?.({ statusId: 9 }), { selectedStatusId: 9 })
  assert.deepEqual(tasks.editorProminent, ["status", "schedule"], "a task is status and dates")
  assert.deepEqual(viewForKind("note").editorProminent, ["filing", "tags"])
})
