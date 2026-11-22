"use client"

import type { ItemRecord } from "@lib/db-items"
import { Button, Checkbox, Modal, Text } from "@gravity-ui/uikit"
import { type FormEvent, type MouseEvent, useEffect, useMemo, useRef, useState } from "react"
import { FilterablePicker } from "@/components/ui/FilterablePicker"
import { toDateTimeLocalValue } from "@/lib/dates"
import { newPublicUid } from "@/lib/publicUid"
import { useItemsAppStore } from "@/stores/itemsAppStore"
import { useItemsWorkspace } from "@/workspace/ItemsWorkspaceProvider"
import styles from "./TimeView.module.css"
import {
  blockLabel,
  daySegments,
  daySummary,
  formatDuration,
  isSameDay,
  parseBlockTimes,
  rangeDays,
  shiftAnchor,
  TIME_RANGES,
  type TimeRange,
  visibleHours,
} from "./timeLayout"

/** What the form is editing: a stored block, or a new one starting at `start`. */
type Editing = { item: ItemRecord | null; start: Date }

const dayLabel = (day: Date) =>
  day.toLocaleDateString(undefined, { weekday: "short", day: "numeric" })

const rangeTitle = (range: TimeRange, days: Date[], anchor: Date) => {
  if (range === "month")
    return anchor.toLocaleDateString(undefined, { month: "long", year: "numeric" })
  const first = days[0]!
  if (days.length === 1)
    return first.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })
  const last = days.at(-1)!
  const short = (day: Date) => day.toLocaleDateString(undefined, { month: "short", day: "numeric" })
  return `${short(first)} – ${short(last)}`
}

/** The nearest half hour at or before an instant. */
const roundToHalfHour = (date: Date) => {
  const rounded = new Date(date)
  rounded.setMinutes(date.getMinutes() < 30 ? 0 : 30, 0, 0)
  return rounded
}

/**
 * The `time` view shows the workspace's time blocks on a timeline at one of four fixed
 * ranges. A block is created and edited in a form, which stores it directly.
 */
export function TimeView() {
  // The server and the browser disagree about today, so the timeline waits for the browser.
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  return mounted ? <TimeViewContent /> : null
}

function TimeViewContent() {
  const { categories, handleDeleteItem, handleSaveTimeBlock, viewItems } = useItemsWorkspace()
  const [range, setRange] = useState<TimeRange>("week")
  const [anchor, setAnchor] = useState(() => new Date())
  const [editing, setEditing] = useState<Editing | null>(null)

  // The now line and the hours shown around now move while the view stays open.
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  // Opening a block from the sidebar or the header shows it here: the timeline moves
  // to its day and its form opens. Every such action counts as an open request.
  const openRequestCount = useItemsAppStore((state) => state.openRequestCount)
  const seenOpenRequests = useRef(openRequestCount)
  useEffect(() => {
    if (openRequestCount === seenOpenRequests.current) return
    seenOpenRequests.current = openRequestCount
    const { activeKey, openItems } = useItemsAppStore.getState()
    const itemId = openItems.find((entry) => entry.key === activeKey)?.itemId
    const item = viewItems.find((candidate) => candidate.id === itemId)
    if (!item?.timeStart) return
    const start = new Date(item.timeStart)
    setAnchor(start)
    setEditing({ item, start })
  }, [openRequestCount, viewItems])

  // The Now range follows the clock, so it moves to the new day at midnight.
  const shownAnchor = range === "hours" ? now : anchor
  const days = useMemo(() => rangeDays(range, shownAnchor), [range, shownAnchor])
  const [firstHour, lastHour] = visibleHours(range, now)
  const hours = lastHour - firstHour

  // A day or a week opens at the working day, not at midnight.
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller || range === "month" || range === "hours") return
    scroller.scrollTop = (scroller.scrollHeight / 24) * 7
  }, [range])

  const goToday = () => setAnchor(new Date())
  const showDay = (day: Date) => {
    setAnchor(day)
    setRange("day")
  }

  const addAt = (day: Date, event: MouseEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return
    const bounds = event.currentTarget.getBoundingClientRect()
    const minutes = firstHour * 60 + ((event.clientY - bounds.top) / bounds.height) * hours * 60
    const start = new Date(day)
    start.setMinutes(Math.floor(minutes / 30) * 30)
    setEditing({ item: null, start })
  }

  return (
    <div className={styles.view}>
      <div className={styles.toolbar}>
        <div role="tablist" aria-label="Time range">
          {TIME_RANGES.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={range === key}
              className={`${styles.tab} ${range === key ? styles.tabActive : ""}`}
              onClick={() => {
                setRange(key)
                if (key === "hours") goToday()
              }}
            >
              {label}
            </button>
          ))}
        </div>
        {range !== "hours" && (
          <>
            <button
              type="button"
              className={styles.tab}
              aria-label="Earlier"
              onClick={() => setAnchor(shiftAnchor(range, anchor, -1))}
            >
              ‹
            </button>
            <button type="button" className={styles.tab} onClick={goToday}>
              Today
            </button>
            <button
              type="button"
              className={styles.tab}
              aria-label="Later"
              onClick={() => setAnchor(shiftAnchor(range, anchor, 1))}
            >
              ›
            </button>
          </>
        )}
        <Text className={styles.title}>{rangeTitle(range, days, shownAnchor)}</Text>
        <span className={styles.spacer} />
        <Button
          view="action"
          size="s"
          onClick={() => setEditing({ item: null, start: roundToHalfHour(new Date()) })}
        >
          Add time
        </Button>
      </div>

      {range === "month" ? (
        <div className={styles.month} role="grid" aria-label="Month">
          {days.map((day) => {
            const { count, minutes } = daySummary(viewItems, day)
            const outside = day.getMonth() !== anchor.getMonth()
            return (
              <button
                key={day.getTime()}
                type="button"
                className={`${styles.monthCell} ${outside ? styles.monthCellOutside : ""}`}
                onClick={() => showDay(day)}
                aria-label={`${day.toDateString()}, ${count} time ${count === 1 ? "block" : "blocks"}`}
              >
                <span className={isSameDay(day, now) ? styles.today : undefined}>
                  {day.getDate() === 1
                    ? day.toLocaleDateString(undefined, { month: "short", day: "numeric" })
                    : day.getDate()}
                </span>
                {count > 0 && (
                  <span className={styles.monthSummary}>
                    {count} {count === 1 ? "block" : "blocks"}
                    {minutes > 0 ? ` · ${formatDuration(minutes)}` : ""}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      ) : (
        <>
          <div className={styles.dayHeads}>
            {days.map((day) => (
              <button
                key={day.getTime()}
                type="button"
                className={`${styles.dayHead} ${isSameDay(day, now) ? styles.today : ""}`}
                onClick={() => showDay(day)}
              >
                {dayLabel(day)}
              </button>
            ))}
          </div>
          <div className={styles.scroller} ref={scrollerRef}>
            <div
              className={styles.grid}
              style={
                {
                  "--hours": hours,
                  "--hour-height": range === "hours" ? `${100 / hours}%` : "44px",
                } as React.CSSProperties
              }
            >
              <div className={styles.gutter} aria-hidden>
                {Array.from({ length: hours - 1 }, (_, index) => firstHour + index + 1).map(
                  (hour) => (
                    <span
                      key={hour}
                      className={styles.hourLabel}
                      style={{ top: `${((hour - firstHour) / hours) * 100}%` }}
                    >
                      {new Date(2000, 0, 1, hour).toLocaleTimeString(undefined, {
                        hour: "numeric",
                      })}
                    </span>
                  ),
                )}
              </div>
              {days.map((day) => (
                <DayColumn
                  key={day.getTime()}
                  day={day}
                  items={viewItems}
                  firstHour={firstHour}
                  hours={hours}
                  now={now}
                  onAdd={(event) => addAt(day, event)}
                  onOpen={(item) => setEditing({ item, start: new Date(item.timeStart!) })}
                />
              ))}
            </div>
          </div>
        </>
      )}

      {editing && (
        <TimeBlockForm
          key={editing.item?.id ?? `new-${editing.start.getTime()}`}
          editing={editing}
          categories={categories.map(({ id, label }) => ({ id, label }))}
          onClose={() => setEditing(null)}
          onSave={handleSaveTimeBlock}
          onDelete={handleDeleteItem}
          findItem={(itemId) => viewItems.find((candidate) => candidate.id === itemId)}
        />
      )}
    </div>
  )
}

function DayColumn({
  day,
  items,
  firstHour,
  hours,
  now,
  onAdd,
  onOpen,
}: {
  day: Date
  items: ItemRecord[]
  firstHour: number
  hours: number
  now: Date
  onAdd: (event: MouseEvent<HTMLDivElement>) => void
  onOpen: (item: ItemRecord) => void
}) {
  const segments = useMemo(() => daySegments(items, day), [day, items])
  const firstMinute = firstHour * 60
  const totalMinutes = hours * 60
  const percent = (minute: number) => ((minute - firstMinute) / totalMinutes) * 100
  const nowMinute = now.getHours() * 60 + now.getMinutes()

  return (
    <div
      className={styles.column}
      role="list"
      aria-label={`Time blocks on ${day.toDateString()}`}
      onClick={onAdd}
    >
      {segments
        .filter(
          (segment) =>
            segment.endMinute > firstMinute && segment.startMinute < firstMinute + totalMinutes,
        )
        .map(({ item, startMinute, endMinute, column, columns }) => {
          const label = blockLabel(item)
          const category = [item.category?.label, item.subcategory?.label]
            .filter(Boolean)
            .join(" / ")
          return (
            <button
              key={item.id}
              type="button"
              role="listitem"
              className={`${styles.block} ${item.timePlanned ? styles.blockPlanned : ""}`}
              style={{
                top: `${Math.max(0, percent(startMinute))}%`,
                height: `${Math.min(100, percent(endMinute)) - Math.max(0, percent(startMinute))}%`,
                left: `${(column / columns) * 100}%`,
                width: `${100 / columns}%`,
              }}
              onClick={() => onOpen(item)}
              aria-label={`${item.timePlanned ? "Planned: " : ""}${label}${category ? `, ${category}` : ""}`}
            >
              <span className={item.description ? undefined : styles.blockNoText}>{label}</span>
              {category && <span className={styles.blockCategory}>{category}</span>}
            </button>
          )
        })}
      {isSameDay(day, now) &&
        nowMinute >= firstMinute &&
        nowMinute < firstMinute + totalMinutes && (
          <div className={styles.nowLine} style={{ top: `${percent(nowMinute)}%` }} />
        )}
    </div>
  )
}

function TimeBlockForm({
  editing,
  categories,
  onClose,
  onSave,
  onDelete,
  findItem,
}: {
  editing: Editing
  categories: { id: number; label: string }[]
  onClose: () => void
  onSave: (
    existing: ItemRecord | null,
    values: {
      timeStart: string | null
      timeEnd: string | null
      timePlanned: boolean
      description: string
      categoryId: number | null
      uid: string
    },
  ) => Promise<ItemRecord | null>
  onDelete: (itemId: number) => Promise<boolean>
  findItem: (itemId: number) => ItemRecord | undefined
}) {
  const { item } = editing
  // A new block starts and ends at the same time until the user says otherwise.
  const [start, setStart] = useState(() => toDateTimeLocalValue(item?.timeStart ?? editing.start))
  const [end, setEnd] = useState(() => toDateTimeLocalValue(item?.timeEnd ?? editing.start))
  const [description, setDescription] = useState(item?.description ?? "")
  const [categoryId, setCategoryId] = useState<number | null>(item?.category?.id ?? null)
  // Until the user chooses, a new block is a plan when it starts in the future.
  const [planned, setPlanned] = useState<boolean | null>(item ? item.timePlanned : null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState<"save" | "delete" | null>(null)
  // One identity for the block this form creates, so a retry after a failed or repeated
  // submit finds the block the first attempt stored instead of adding another.
  const [uid] = useState(newPublicUid)
  // A write that finishes after the form closed must not close whatever opened since.
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const times = parseBlockTimes(start, end)
  const startsInFuture = !("error" in times) && new Date(times.timeStart).getTime() > Date.now()
  const isPlanned = planned ?? startsInFuture
  const category = categories.find(({ id }) => id === categoryId)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (pending) return
    if ("error" in times) {
      setError(times.error)
      return
    }
    setError(null)
    setPending("save")
    // The form shows minutes. An end the user left alone keeps its stored instant, so
    // a block made elsewhere with seconds is not shortened by an unrelated edit.
    const kept = (input: string, original: string | null | undefined, parsed: string) =>
      original && input === toDateTimeLocalValue(original) ? original : parsed
    const timeStart = kept(start, item?.timeStart, times.timeStart)
    const timeEnd = kept(end, item?.timeEnd, times.timeEnd)
    if (new Date(timeEnd).getTime() < new Date(timeStart).getTime()) {
      setError("A time block cannot end before it starts.")
      setPending(null)
      return
    }
    const stored = await onSave(item, {
      timeStart,
      timeEnd,
      timePlanned: isPlanned,
      description,
      categoryId,
      uid,
    })
    if (!mountedRef.current) return
    setPending(null)
    if (stored) onClose()
  }

  const remove = async () => {
    if (!item || pending) return
    setPending("delete")
    // An item with text is also a note or a task: only its block is removed. The
    // item is read as it is stored now, which may be newer than when the form opened.
    const latest = findItem(item.id) ?? item
    const hasText = (latest.description ?? "").trim() !== ""
    const removed = hasText
      ? (await onSave(item, {
          timeStart: null,
          timeEnd: null,
          timePlanned: false,
          description: latest.description ?? "",
          categoryId: latest.category?.id ?? null,
          uid,
        })) !== null
      : await onDelete(item.id)
    if (!mountedRef.current) return
    setPending(null)
    if (removed) onClose()
  }

  return (
    <Modal open onClose={onClose} aria-label={item ? "Edit time block" : "Add time block"}>
      <form className={styles.form} onSubmit={(event) => void submit(event)}>
        <Text variant="subheader-2">{item ? "Time block" : "New time block"}</Text>
        <div className={styles.times}>
          <label className={styles.field}>
            Start
            <input
              type="datetime-local"
              className={styles.input}
              value={start}
              onChange={(event) => setStart(event.target.value)}
            />
          </label>
          <label className={styles.field}>
            End
            <input
              type="datetime-local"
              className={styles.input}
              value={end}
              onChange={(event) => setEnd(event.target.value)}
            />
          </label>
        </div>
        <label className={styles.field}>
          Text
          <textarea
            className={`${styles.input} ${styles.textarea}`}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Optional"
          />
        </label>
        <FilterablePicker
          value={category?.label ?? "uncategorized"}
          triggerLabel="Category"
          triggerAriaLabel={`Category, ${category?.label ?? "uncategorized"}`}
          listboxAriaLabel="Categories"
          options={[{ id: "none", label: "uncategorized" }, ...categories]}
          selectedIds={[categoryId ?? "none"]}
          onSelectOption={({ id }) => setCategoryId(typeof id === "number" ? id : null)}
        />
        <Checkbox size="m" checked={isPlanned} onUpdate={setPlanned}>
          Planned, not yet done
        </Checkbox>
        {error && (
          <Text color="danger" role="alert">
            {error}
          </Text>
        )}
        <div className={styles.formActions}>
          <span>
            {item && (
              <Button
                view="flat-danger"
                size="m"
                loading={pending === "delete"}
                disabled={pending !== null}
                onClick={() => void remove()}
              >
                Delete
              </Button>
            )}
          </span>
          <span>
            <Button view="flat" size="m" onClick={onClose}>
              Cancel
            </Button>{" "}
            <Button view="action" size="m" type="submit" loading={pending === "save"}>
              Save
            </Button>
          </span>
        </div>
      </form>
    </Modal>
  )
}
