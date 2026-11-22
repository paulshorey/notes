import assert from "node:assert/strict"
import test from "node:test"
import type { ItemRecord } from "@lib/db-items"
import { timePart } from "../src/capabilities/time/draft"
import {
  createEmptyItemDraft,
  itemDraftFromItem,
  itemDraftRequest,
} from "../src/capabilities/draftParts"
import { entrySaveAction, viewForKind } from "../src/views/registry"
import {
  blockLabel,
  daySegments,
  daySummary,
  formatDuration,
  parseBlockTimes,
  rangeDays,
  shiftAnchor,
  startOfWeek,
  visibleHours,
} from "../src/views/time/timeLayout"

const at = (day: number, hour: number, minute = 0) => new Date(2026, 10, day, hour, minute)

const block = (
  id: number,
  start: Date,
  end: Date,
  values: Partial<ItemRecord> = {},
): ItemRecord => ({
  id,
  uid: `00000000-0000-4000-8000-${String(id).padStart(12, "0")}`,
  workspaceId: 1,
  category: null,
  subcategory: null,
  status: null,
  tags: [],
  description: null,
  timeStart: start.toISOString(),
  timeEnd: end.toISOString(),
  timePlanned: false,
  timeDue: null,
  timeRemind: null,
  timeCreated: "2026-01-01T00:00:00.000Z",
  timeModified: "2026-01-01T00:00:00.000Z",
  ...values,
})

const layout = (items: ItemRecord[], day: Date) =>
  daySegments(items, day).map(({ item, startMinute, endMinute, column, columns }) => [
    item.id,
    startMinute,
    endMinute,
    column,
    columns,
  ])

test("a week starts on Monday and a month shows whole weeks", () => {
  // 2026-11-25 is a Wednesday.
  assert.equal(startOfWeek(at(25, 15)).getDate(), 23)
  assert.equal(startOfWeek(at(29, 15)).getDate(), 23, "Sunday belongs to the week before")
  assert.deepEqual(
    rangeDays("week", at(25, 15)).map((day) => day.getDate()),
    [23, 24, 25, 26, 27, 28, 29],
  )
  assert.deepEqual(rangeDays("day", at(25, 15)), [at(25, 0)])
  assert.deepEqual(rangeDays("hours", at(25, 15)), [at(25, 0)])
  const month = rangeDays("month", at(25, 15))
  assert.equal(month.length % 7, 0)
  assert.equal(month[0]!.getDay(), 1)
  assert.deepEqual([month[0]!.getMonth(), month[0]!.getDate()], [9, 26])
  assert.deepEqual([month.at(-1)!.getMonth(), month.at(-1)!.getDate()], [11, 6])
})

test("moving a range steps by its own length", () => {
  assert.equal(shiftAnchor("day", at(25, 15), 1).getDate(), 26)
  assert.equal(shiftAnchor("hours", at(25, 15), -1).getDate(), 24)
  assert.equal(shiftAnchor("week", at(25, 15), -1).getDate(), 18)
  assert.deepEqual(
    [shiftAnchor("month", at(30, 15), 1).getMonth(), shiftAnchor("month", at(30, 15), 1).getDate()],
    [11, 1],
  )
})

test("the now range shows a few hours around the current one, inside the day", () => {
  assert.deepEqual(visibleHours("hours", at(25, 15)), [12, 19])
  assert.deepEqual(visibleHours("hours", at(25, 1)), [0, 7])
  assert.deepEqual(visibleHours("hours", at(25, 23)), [17, 24])
  assert.deepEqual(visibleHours("week", at(25, 15)), [0, 24])
})

test("a block is placed by its minutes, and one with no length is still drawn", () => {
  assert.deepEqual(layout([block(1, at(25, 9), at(25, 10, 30))], at(25, 0)), [[1, 540, 630, 0, 1]])
  assert.deepEqual(layout([block(2, at(25, 9), at(25, 9))], at(25, 0)), [[2, 540, 560, 0, 1]])
  assert.deepEqual(
    layout([block(3, at(25, 23, 55), at(25, 23, 55))], at(25, 0)),
    [[3, 1420, 1440, 0, 1]],
    "a late instant still fits in its day",
  )
})

test("a block that crosses midnight shows on each day it touches", () => {
  const overnight = block(1, at(25, 22), at(26, 2))
  assert.deepEqual(layout([overnight], at(25, 0)), [[1, 1320, 1440, 0, 1]])
  assert.deepEqual(layout([overnight], at(26, 0)), [[1, 0, 120, 0, 1]])
  assert.deepEqual(layout([overnight], at(27, 0)), [])
  // Ending exactly at midnight is the day before only; starting there is the day after.
  assert.deepEqual(layout([block(2, at(25, 22), at(26, 0))], at(26, 0)), [])
  assert.deepEqual(layout([block(3, at(26, 0), at(26, 0))], at(26, 0)), [[3, 0, 20, 0, 1]])
  assert.deepEqual(layout([block(3, at(26, 0), at(26, 0))], at(25, 0)), [])
})

test("overlapping blocks sit side by side, and a later one reuses a free lane", () => {
  const items = [
    block(1, at(25, 9), at(25, 11)),
    block(2, at(25, 10), at(25, 12)),
    block(3, at(25, 11), at(25, 12)),
    block(4, at(25, 14), at(25, 15)),
    block(5, at(25, 8), at(25, 8), { timeStart: null, timeEnd: null }),
  ]
  assert.deepEqual(layout(items, at(25, 0)), [
    [1, 540, 660, 0, 2],
    [2, 600, 720, 1, 2],
    [3, 660, 720, 0, 2],
    [4, 840, 900, 0, 1],
  ])
})

test("a month cell counts the blocks that touch a day and the time they take on it", () => {
  const items = [
    block(1, at(25, 9), at(25, 10, 30)),
    block(2, at(25, 22), at(26, 2)),
    block(3, at(25, 12), at(25, 12)),
  ]
  assert.deepEqual(daySummary(items, at(25, 0)), { count: 3, minutes: 210 })
  assert.deepEqual(daySummary(items, at(26, 0)), { count: 1, minutes: 120 })
  assert.deepEqual(daySummary(items, at(27, 0)), { count: 0, minutes: 0 })
  assert.equal(formatDuration(210), "3h 30m")
  assert.equal(formatDuration(60), "1h")
  assert.equal(formatDuration(20), "20m")
  assert.equal(formatDuration(0), "")
})

test("a block shows its first line, or says it has no text", () => {
  assert.equal(blockLabel(block(1, at(25, 9), at(25, 10))), "no text")
  assert.equal(blockLabel(block(1, at(25, 9), at(25, 10), { description: "  " })), "no text")
  assert.equal(
    blockLabel(block(1, at(25, 9), at(25, 10), { description: "Standup\nnotes" })),
    "Standup",
  )
})

test("the form fills a missing end from the other and refuses an end before the start", () => {
  const nine = "2026-11-25T09:00"
  const ten = "2026-11-25T10:00"
  const iso = (value: string) => new Date(value).toISOString()
  assert.deepEqual(parseBlockTimes(nine, ten), { timeStart: iso(nine), timeEnd: iso(ten) })
  assert.deepEqual(parseBlockTimes(nine, ""), { timeStart: iso(nine), timeEnd: iso(nine) })
  assert.deepEqual(parseBlockTimes("", ten), { timeStart: iso(ten), timeEnd: iso(ten) })
  assert.deepEqual(parseBlockTimes(nine, nine), { timeStart: iso(nine), timeEnd: iso(nine) })
  assert.deepEqual(parseBlockTimes("", ""), { error: "Enter a start or an end time." })
  assert.deepEqual(parseBlockTimes(ten, nine), {
    error: "A time block cannot end before it starts.",
  })
})

test("a time block is content in a draft, and an item without one sends no time fields", () => {
  const empty = createEmptyItemDraft()
  assert.equal("timeStart" in itemDraftRequest(empty), false)
  assert.equal(timePart.holds?.(empty), false)

  const stored = block(7, at(25, 9), at(25, 10), { timePlanned: true })
  const draft = itemDraftFromItem(stored)
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(itemDraftRequest(draft)).filter(([key]) => key.startsWith("time")),
    ),
    {
      timeDue: null,
      timeRemind: null,
      timeStart: stored.timeStart,
      timeEnd: stored.timeEnd,
      timePlanned: true,
    },
  )
  // The text is gone and the block remains, so the item is kept, in every view.
  for (const view of ["note", "task", "time"] as const)
    assert.equal(entrySaveAction({ view, itemId: 7, form: draft }), "update")
  // Removing the block of an item that had one is sent, so the server removes it too.
  const cleared = { ...draft, timeStart: null, timeEnd: null }
  assert.deepEqual(
    [itemDraftRequest(cleared).timeStart, itemDraftRequest(cleared).timePlanned],
    [null, false],
  )
  assert.equal(entrySaveAction({ view: "time", itemId: 7, form: cleared }), "delete")

  // A draft kept in the browser from before time blocks has none of these fields.
  const old = { ...empty, description: "an older draft" } as Record<string, unknown>
  for (const key of ["timeStart", "timeEnd", "timePlanned", "timeBlockKnown"]) delete old[key]
  assert.deepEqual(
    itemDraftRequest(old as unknown as typeof empty),
    itemDraftRequest({ ...empty, description: "an older draft" }),
  )

  // An older draft of a time-block item holds only its start. It sends no time fields,
  // so it matches the signature saved with it and cannot write a block with no end.
  const legacyBlock = {
    ...empty,
    description: "an older block",
    timeStart: at(25, 9).toISOString(),
  }
  delete (legacyBlock as Record<string, unknown>).timeEnd
  delete (legacyBlock as Record<string, unknown>).timePlanned
  delete (legacyBlock as Record<string, unknown>).timeBlockKnown
  assert.deepEqual(timePart.toRequest(legacyBlock as unknown as typeof empty), {})
  // A never-saved draft started from a block in the time view has both ends and is sent.
  const started = { ...empty, timeStart: at(25, 9).toISOString(), timeEnd: at(25, 9).toISOString() }
  assert.equal(timePart.toRequest(started).timeEnd, started.timeEnd)
})

test("the time view starts an item from a time block and lists time blocks only", () => {
  const time = viewForKind("time")
  const empty = createEmptyItemDraft()
  assert.equal(time.route, "/time")
  assert.equal(time.canCreate({ ...empty, description: "text only" }), false)
  assert.equal(
    time.canCreate({
      ...empty,
      timeStart: at(25, 9).toISOString(),
      timeEnd: at(25, 9).toISOString(),
    }),
    true,
  )
  const context = { notesViewHiddenKinds: [] }
  const withText = block(1, at(25, 9), at(25, 10), { description: "Standup" })
  assert.equal(time.selects(block(2, at(25, 9), at(25, 10)), context), true)
  assert.equal(time.selects(withText, context), true)
  assert.equal(time.selects({ ...withText, timeStart: null, timeEnd: null }, context), false)
  // A block with text is also a note, unless time blocks are left out of notes.
  const notes = viewForKind("note")
  assert.deepEqual(notes.optionalKinds, ["task", "time"])
  assert.equal(notes.selects(withText, context), true)
  assert.equal(notes.selects(withText, { notesViewHiddenKinds: ["time"] }), false)
  assert.equal(notes.selects(block(2, at(25, 9), at(25, 10)), context), false)
})
