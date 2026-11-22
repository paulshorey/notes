import type { ItemInput } from "./items-app"

export const TIME_BLOCK_ORDER_ERROR = "A time block cannot end before it starts."

export class TimeBlockOrderError extends Error {
  constructor() {
    super(TIME_BLOCK_ORDER_ERROR)
  }
}

type TimeBlockFields = Pick<ItemInput, "timeStart" | "timeEnd">

/**
 * A time block always has a start and an end, which may be the same instant. Given
 * only one, the other takes its value. Naming neither field says nothing about the
 * time block, and the result names neither.
 */
export const normalizeTimeBlock = <Item extends TimeBlockFields>(item: Item): Item => {
  if (item.timeStart === undefined && item.timeEnd === undefined) return item
  const timeStart = item.timeStart ?? item.timeEnd ?? null
  const timeEnd = item.timeEnd ?? item.timeStart ?? null
  if (timeStart === null || timeEnd === null) return { ...item, timeStart: null, timeEnd: null }
  if (new Date(timeEnd).getTime() < new Date(timeStart).getTime()) throw new TimeBlockOrderError()
  return { ...item, timeStart, timeEnd }
}
