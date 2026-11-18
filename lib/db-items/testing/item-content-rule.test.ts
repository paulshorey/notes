import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { after, describe, test } from "node:test"
import { hasItemContent } from "../contracts/item-capabilities"
import { getDb } from "../lib/db/postgres"
import { listItemsByUser } from "../sql/item"
import { ITEM_HAS_CONTENT_SQL } from "../sql/item/stored-capabilities"
import { deleteStatusForWorkspace } from "../sql/status"
import { createWorkspaceForUser } from "../sql/workspace"

const testDbUrl = process.env.DB_ITEMS_TEST_URL ?? process.env.DB_NOTES_TEST_URL
if (testDbUrl) process.env.DB_ITEMS_URL = testDbUrl

describe("an item without content is not kept (DB)", { skip: !testDbUrl }, () => {
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
  const insert = async (
    workspaceId: number,
    values: {
      description?: string | null
      due?: string | null
      remind?: string | null
      status?: number | null
      category?: number | null
    },
  ) =>
    (
      await getDb().query<{ id: number }>(
        `INSERT INTO public.workspace_item_v1(workspace_id,description,time_due,time_remind,status_id,category_id)
         VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,
        [
          workspaceId,
          values.description ?? null,
          values.due ?? null,
          values.remind ?? null,
          values.status ?? null,
          values.category ?? null,
        ],
      )
    ).rows[0]!.id

  test("the SQL rule for content agrees with the registry's", async () => {
    const w = await workspace()
    const ids = {
      text: await insert(w.workspaceId, { description: "words" }),
      blankText: await insert(w.workspaceId, { description: "  \n\t " }),
      // Whitespace that `trim` removes but a locale's space class may not include.
      unicodeSpaces: await insert(w.workspaceId, {
        description: "\u00A0\u1680\u2003\u2028\u2029\u202F\u205F\u3000\uFEFF",
      }),
      // Characters `trim` keeps, which some collations call spaces.
      controlOnly: await insert(w.workspaceId, { description: "\u0085\u001C" }),
      due: await insert(w.workspaceId, { due: "2027-01-02T03:04:05Z" }),
      remind: await insert(w.workspaceId, { remind: "2027-01-02T03:04:05Z" }),
      status: await insert(w.workspaceId, { status: w.status }),
      filedOnly: await insert(w.workspaceId, { category: w.category }),
      nothing: await insert(w.workspaceId, {}),
    }
    await getDb().query(
      `INSERT INTO public.item_tag_link_v1(item_id,tag_id,workspace_id) VALUES($1,$2,$3)`,
      [ids.nothing, w.tag, w.workspaceId],
    )
    const sql = await getDb().query<{ id: number; has: boolean }>(
      `SELECT n.id,${ITEM_HAS_CONTENT_SQL} AS has FROM public.workspace_item_v1 n WHERE n.workspace_id=$1`,
      [w.workspaceId],
    )
    const bySql = new Map(sql.rows.map((row) => [row.id, row.has]))
    const records = await listItemsByUser(w.userId, w.workspaceId)
    assert.equal(records.length, Object.keys(ids).length)
    for (const record of records)
      assert.equal(bySql.get(record.id), hasItemContent(record), `item ${record.id}`)
    assert.deepEqual(
      Object.fromEntries(Object.entries(ids).map(([name, id]) => [name, bySql.get(id)])),
      {
        text: true,
        blankText: false,
        unicodeSpaces: false,
        controlOnly: true,
        due: true,
        remind: true,
        status: true,
        filedOnly: false,
        nothing: false,
      },
    )
  })

  test("deleting a status deletes the items it leaves with nothing", async () => {
    const w = await workspace()
    const statusOnly = await insert(w.workspaceId, { status: w.status, category: w.category })
    const withText = await insert(w.workspaceId, { status: w.status, description: "still a note" })
    const withDate = await insert(w.workspaceId, { status: w.status, due: "2027-01-02T03:04:05Z" })
    const otherStatus = await insert(w.workspaceId, { status: w.other })

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
    assert.equal(
      left.rows.some((row) => row.id === statusOnly),
      false,
    )
  })
})
