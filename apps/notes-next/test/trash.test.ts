import assert from "node:assert/strict"
import test from "node:test"
import type { TrashedItemRecord } from "@lib/db-items/contracts/items-app"
import { trashedItemDetail } from "../src/lib/trash"

const entry = (values: Partial<TrashedItemRecord> = {}): TrashedItemRecord => ({
  id: 1,
  workspaceLabel: "personal",
  timeDeleted: "2026-06-15T12:00:00.000Z",
  description: "call the bank",
  category: null,
  subcategory: null,
  status: null,
  tags: [],
  timeStart: null,
  timeEnd: null,
  timeDue: null,
  timeRemind: null,
  ...values,
})

test("a trashed item's detail names where it was and when it was deleted", () => {
  assert.match(trashedItemDetail(entry()), /^personal · deleted .+/)
  assert.match(
    trashedItemDetail(entry({ category: "work", subcategory: "ideas", status: "doing" })),
    /^personal · work \/ ideas · doing · deleted .+/,
  )
  assert.match(trashedItemDetail(entry({ category: "work" })), /^personal · work · deleted .+/)
})
