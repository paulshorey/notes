import type { ItemRecord } from "@lib/db-items"

/** How much time the view shows at once. */
export type TimeRange = "hours" | "day" | "week" | "month"

export const TIME_RANGES: readonly { key: TimeRange; label: string }[] = [
  { key: "hours", label: "Now" },
  { key: "day", label: "Day" },
  { key: "week", label: "Week" },
  { key: "month", label: "Month" },
]

const DAY_MINUTES = 24 * 60
/** A block is drawn at least this tall, so one that starts and ends together shows. */
export const MIN_BLOCK_MINUTES = 20
/** The "Now" range shows this many hours before and after the current hour. */
const HOURS_AROUND_NOW = 3

export const startOfDay = (date: Date): Date =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate())

export const addDays = (date: Date, days: number): Date =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate() + days)

/** The Monday on or before the date: a week starts on Monday. */
export const startOfWeek = (date: Date): Date => addDays(date, -((date.getDay() + 6) % 7))

export const isSameDay = (left: Date, right: Date): boolean =>
  startOfDay(left).getTime() === startOfDay(right).getTime()

/** The days a range shows, each as its local midnight, oldest first. */
export const rangeDays = (range: TimeRange, anchor: Date): Date[] => {
  if (range === "hours" || range === "day") return [startOfDay(anchor)]
  if (range === "week") {
    const monday = startOfWeek(anchor)
    return Array.from({ length: 7 }, (_, index) => addDays(monday, index))
  }
  // Whole weeks, so the grid's first column is always Monday.
  const first = startOfWeek(new Date(anchor.getFullYear(), anchor.getMonth(), 1))
  const lastOfMonth = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0)
  const days: Date[] = []
  for (let day = first; day <= lastOfMonth || days.length % 7 !== 0; day = addDays(day, 1))
    days.push(day)
  return days
}

/** The anchor one range earlier or later. */
export const shiftAnchor = (range: TimeRange, anchor: Date, direction: -1 | 1): Date =>
  range === "month"
    ? new Date(anchor.getFullYear(), anchor.getMonth() + direction, 1)
    : addDays(anchor, direction * (range === "week" ? 7 : 1))

/** The hours of the day a timeline range draws, as `[first, last)`. */
export const visibleHours = (range: TimeRange, now: Date): [number, number] => {
  if (range !== "hours") return [0, 24]
  const first = Math.max(
    0,
    Math.min(24 - (2 * HOURS_AROUND_NOW + 1), now.getHours() - HOURS_AROUND_NOW),
  )
  return [first, first + 2 * HOURS_AROUND_NOW + 1]
}

export type TimeBlockItem = ItemRecord & { timeStart: string; timeEnd: string }

export const isTimeBlock = (item: ItemRecord): item is TimeBlockItem =>
  item.timeStart !== null && item.timeEnd !== null

/** The part of a block that falls on one day, in minutes from that day's midnight. */
export interface DaySegment {
  item: TimeBlockItem
  startMinute: number
  /** At least `MIN_BLOCK_MINUTES` after the start, so the segment can be drawn. */
  endMinute: number
  /** Which of `columns` side-by-side lanes the segment sits in. */
  column: number
  columns: number
}

const minutesInto = (day: Date, instant: Date): number =>
  (instant.getTime() - day.getTime()) / 60_000

/**
 * The blocks that touch a day, clipped to it and laid out so that overlapping blocks
 * sit side by side. A block that crosses midnight appears on each day it touches. One
 * that ends exactly at midnight belongs to the day before only.
 */
export const daySegments = (items: readonly ItemRecord[], day: Date): DaySegment[] => {
  const clipped = items
    .filter(isTimeBlock)
    .map((item) => {
      const start = minutesInto(day, new Date(item.timeStart))
      const end = minutesInto(day, new Date(item.timeEnd))
      return { item, start, end }
    })
    .filter(({ start, end }) =>
      start === end ? start >= 0 && start < DAY_MINUTES : end > 0 && start < DAY_MINUTES,
    )
    .map(({ item, start, end }) => {
      const startMinute = Math.max(0, Math.min(start, DAY_MINUTES - MIN_BLOCK_MINUTES))
      return {
        item,
        startMinute,
        endMinute: Math.min(DAY_MINUTES, Math.max(end, startMinute + MIN_BLOCK_MINUTES)),
      }
    })
    .sort(
      (left, right) =>
        left.startMinute - right.startMinute ||
        right.endMinute - left.endMinute ||
        left.item.id - right.item.id,
    )

  // Blocks that overlap, directly or through others, form a cluster that shares a
  // width. Inside it each block takes the first lane free when it starts.
  const segments: DaySegment[] = []
  let cluster: DaySegment[] = []
  let laneEnds: number[] = []
  let clusterEnd = 0
  const closeCluster = () => {
    for (const segment of cluster) segment.columns = laneEnds.length
    segments.push(...cluster)
    cluster = []
    laneEnds = []
  }
  for (const block of clipped) {
    if (cluster.length > 0 && block.startMinute >= clusterEnd) closeCluster()
    let column = laneEnds.findIndex((end) => end <= block.startMinute)
    if (column === -1) column = laneEnds.length
    laneEnds[column] = block.endMinute
    clusterEnd = Math.max(clusterEnd, block.endMinute)
    cluster.push({ ...block, column, columns: 1 })
  }
  closeCluster()
  return segments
}

/** What a month cell says about a day: how many blocks touch it and their total time. */
export const daySummary = (
  items: readonly ItemRecord[],
  day: Date,
): { count: number; minutes: number } => {
  let count = 0
  let minutes = 0
  for (const item of items) {
    if (!isTimeBlock(item)) continue
    const start = minutesInto(day, new Date(item.timeStart))
    const end = minutesInto(day, new Date(item.timeEnd))
    const touches =
      start === end ? start >= 0 && start < DAY_MINUTES : end > 0 && start < DAY_MINUTES
    if (!touches) continue
    count += 1
    minutes += Math.min(end, DAY_MINUTES) - Math.max(start, 0)
  }
  return { count, minutes: Math.round(minutes) }
}

/** `90` as "1h 30m", `60` as "1h", `20` as "20m", and nothing for no time. */
export const formatDuration = (minutes: number): string => {
  if (minutes <= 0) return ""
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return [hours > 0 ? `${hours}h` : "", rest > 0 ? `${rest}m` : ""].filter(Boolean).join(" ")
}

/** The text a block shows: its first line, or "no text" for a block without any. */
export const blockLabel = (item: ItemRecord): string => {
  const firstLine = (item.description ?? "").trim().split(/\r?\n/)[0]?.trim() ?? ""
  return firstLine === "" ? "no text" : firstLine
}

/** The form's two ends as instants, or why they cannot be saved. */
export const parseBlockTimes = (
  start: string,
  end: string,
): { timeStart: string; timeEnd: string } | { error: string } => {
  const parse = (value: string) => (value === "" ? null : new Date(value))
  const from = parse(start) ?? parse(end)
  const to = parse(end) ?? parse(start)
  if (!from || !to) return { error: "Enter a start or an end time." }
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()))
    return { error: "Enter a valid date and time." }
  if (to.getTime() < from.getTime()) return { error: "A time block cannot end before it starts." }
  return { timeStart: from.toISOString(), timeEnd: to.toISOString() }
}
