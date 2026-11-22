import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { after, describe, test } from "node:test"
import { hasItemContent, missingRequirement } from "../contracts/item-capabilities"
import { getDb } from "../lib/db/postgres"
import { listItemsByUser } from "../sql/item"
import { ITEM_HAS_CONTENT_SQL } from "../sql/item/stored-capabilities"
import { deleteStatusForWorkspace } from "../sql/status"
import { createWorkspaceForUser } from "../sql/workspace"

const testDbUrl = process.env.DB_ITEMS_TEST_URL ?? process.env.DB_NOTES_TEST_URL
if (testDbUrl) process.env.DB_ITEMS_URL = testDbUrl

describe("what counts as an item's content (DB)", { skip: !testDbUrl }, () => {
  after(async () => {
    if (testDbUrl) await getDb().end()
  })

  const workspace = async () => {
    const { rows } = await getDb().query<{ id: number }>(
      `INSERT INTO public.user_v1(username,is_anonymous) VALUES($1,false) RETURNING id`,
      [`content-${randomUUID()}`],
    )
    const userId = rows[0]!.id
    const created = await createWorkspaceForUser(userId, "personal")
    const vocabulary = await getDb().query<{
      status: number
      other: number
      category: number
      tag: number
    }>(
      `WITH s AS (INSERT INTO public.workspace_status_v1(workspace_id,label,position) VALUES($1,'doing',7) RETURNING id),
            o AS (INSERT INTO public.workspace_status_v1(workspace_id,label,position) VALUES($1,'waiting',8) RETURNING id),
            c AS (INSERT INTO public.workspace_category_v1(workspace_id,label) VALUES($1,'work') RETURNING id),
            t AS (INSERT INTO public.workspace_tag_v1(workspace_id,label) VALUES($1,'kept') RETURNING id)
       SELECT s.id status,o.id other,c.id category,t.id tag FROM s,o,c,t`,
      [created.id],
    )
    return { userId, workspaceId: created.id, ...vocabulary.rows[0]! }
  }
  type Candidate = {
    description?: string | null
    due?: string | null
    start?: string | null
    status?: number | null
    category?: number | null
  }
  const insert = async (workspaceId: number, values: Candidate) =>
    (
      await getDb().query<{ id: number }>(
        `INSERT INTO public.workspace_item_v1(workspace_id,description,time_due,time_start,time_end,status_id,category_id)
         VALUES($1,$2,$3,$4,$4,$5,$6) RETURNING id`,
        [
          workspaceId,
          values.description ?? null,
          values.due ?? null,
          values.start ?? null,
          values.status ?? null,
          values.category ?? null,
        ],
      )
    ).rows[0]!.id

  test("the table accepts exactly the items the registry's rules accept", async () => {
    const w = await workspace()
    const at = "2027-01-02T03:04:05Z"
    const candidates: Record<string, Candidate> = {
      text: { description: "words" },
      blankText: { description: "  \n\t " },
      // Whitespace that `trim` removes but a locale's space class may not include.
      unicodeSpaces: { description: "\u00A0\u1680\u2003\u2028\u2029\u202F\u205F\u3000\uFEFF" },
      // Characters `trim` keeps, which some collations call spaces.
      controlOnly: { description: "\u0085\u001C" },
      timeBlock: { start: at },
      timeBlockWithBlankText: { start: at, description: "   " },
      due: { due: at },
      status: { status: w.status },
      filedOnly: { category: w.category },
      nothing: {},
      textWithStatus: { description: "words", status: w.status },
      timeBlockWithStatus: { start: at, status: w.status },
      textAndTimeBlockWithStatus: { description: "words", start: at, status: w.status },
    }
    const accepted: Record<string, boolean> = {}
    for (const [name, values] of Object.entries(candidates)) {
      const source = {
        description: values.description ?? null,
        timeStart: values.start ?? null,
        timeDue: values.due ?? null,
        timeRemind: null,
        statusId: values.status ?? null,
      }
      const allowed = hasItemContent(source) && missingRequirement(source) === null
      const stored = await insert(w.workspaceId, values).then(
        () => true,
        (error: { code?: string }) => {
          // 23514 is a check constraint; anything else is a broken test.
          assert.equal(error.code, "23514", name)
          return false
        },
      )
      assert.equal(stored, allowed, name)
      accepted[name] = stored
    }
    assert.deepEqual(accepted, {
      text: true,
      blankText: false,
      unicodeSpaces: false,
      controlOnly: true,
      timeBlock: true,
      timeBlockWithBlankText: true,
      due: false,
      status: false,
      filedOnly: false,
      nothing: false,
      textWithStatus: true,
      timeBlockWithStatus: false,
      textAndTimeBlockWithStatus: true,
    })

    // Every stored item holds content by the SQL rule and by the registry's.
    const sql = await getDb().query<{ id: number; has: boolean }>(
      `SELECT n.id,${ITEM_HAS_CONTENT_SQL} AS has FROM public.workspace_item_v1 n WHERE n.workspace_id=$1`,
      [w.workspaceId],
    )
    assert.equal(sql.rows.length, Object.values(accepted).filter(Boolean).length)
    assert.ok(sql.rows.every((row) => row.has))
    for (const record of await listItemsByUser(w.userId, w.workspaceId))
      assert.equal(hasItemContent(record), true, `item ${record.id}`)
  })

  test("a time block has both ends, in order", async () => {
    const w = await workspace()
    const bad = [
      `time_start='2027-01-02T03:00Z'`,
      `time_end='2027-01-02T03:00Z'`,
      `time_start='2027-01-02T04:00Z',time_end='2027-01-02T03:00Z'`,
    ]
    const id = await insert(w.workspaceId, { description: "words" })
    for (const change of bad)
      await assert.rejects(
        getDb().query(`UPDATE public.workspace_item_v1 SET ${change} WHERE id=$1`, [id]),
        { code: "23514" },
        change,
      )
    await getDb().query(
      `UPDATE public.workspace_item_v1 SET time_start='2027-01-02T03:00Z',time_end='2027-01-02T03:00Z' WHERE id=$1`,
      [id],
    )
  })

  test("deleting a status clears it from its items and deletes none of them", async () => {
    const w = await workspace()
    const withText = await insert(w.workspaceId, { status: w.status, description: "still a note" })
    const withDate = await insert(w.workspaceId, {
      status: w.status,
      description: "dated",
      due: "2027-01-02T03:04:05Z",
    })
    const otherStatus = await insert(w.workspaceId, { status: w.other, description: "other" })

    assert.equal(await deleteStatusForWorkspace(w.userId, w.workspaceId, w.status), true)

    const left = await getDb().query<{ id: number; status_id: number | null }>(
      `SELECT id,status_id FROM public.workspace_item_v1 WHERE workspace_id=$1 ORDER BY id`,
      [w.workspaceId],
    )
    assert.deepEqual(left.rows, [
      { id: withText, status_id: null },
      { id: withDate, status_id: null },
      { id: otherStatus, status_id: w.other },
    ])
  })
})
