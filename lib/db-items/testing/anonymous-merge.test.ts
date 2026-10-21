import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { after, describe, test } from "node:test"
import { getDb } from "../lib/db/postgres"
import { mergeAnonymousItemsAppSession } from "../services/items-app"
import { createItemForUser, listItemsByUser } from "../sql/item"
import { createAnonymousUser, mergePreferenceObjects } from "../sql/user/anonymous"
import { createWorkspaceForUser } from "../sql/workspace"

describe("mergePreferenceObjects", () => {
  test("anonymous leaf values win while real-only keys survive", () => {
    const real = {
      notesApp: { markdownEditorMode: "wysiwyg", resultsColumnWidth: 480 },
      otherApp: { keep: true },
    }
    const anon = { notesApp: { resultsColumnWidth: 321 } }
    assert.deepEqual(mergePreferenceObjects(real, anon), {
      notesApp: { markdownEditorMode: "wysiwyg", resultsColumnWidth: 321 },
      otherApp: { keep: true },
    })
    assert.equal(real.notesApp.resultsColumnWidth, 480)
  })

  test("non-object values are replaced instead of recursively merged", () => {
    assert.deepEqual(mergePreferenceObjects({ a: { nested: 1 } }, { a: "flat" }), { a: "flat" })
    assert.deepEqual(mergePreferenceObjects({ a: [1, 2] }, { a: [3] }), { a: [3] })
  })
})

const testDbUrl = process.env.DB_ITEMS_TEST_URL ?? process.env.DB_NOTES_TEST_URL
if (testDbUrl) process.env.DB_ITEMS_URL = testDbUrl

describe("anonymous workspace merge (DB)", { skip: !testDbUrl }, () => {
  after(async () => {
    if (testDbUrl) await getDb().end()
  })

  const createRealUser = async () => {
    const { rows } = await getDb().query<{ id: number }>(
      `INSERT INTO public.user_v1(username,is_anonymous,preferences)
       VALUES($1,false,$2::jsonb) RETURNING id`,
      [
        `merge-real-${randomUUID()}`,
        JSON.stringify({ notesApp: { markdownEditorMode: "wysiwyg" } }),
      ],
    )
    return rows[0]!.id
  }

  test("merges colliding workspaces by vocabulary label and preserves note relations", async () => {
    const realUserId = await createRealUser()
    const anon = await createAnonymousUser()
    try {
      const realWorkspace = await createWorkspaceForUser(realUserId, "personal")
      const anonWorkspace = (
        await getDb().query<{ id: number }>(
          `SELECT id FROM public.user_workspace_v1 WHERE user_id=$1 AND label='personal'`,
          [anon.id],
        )
      ).rows[0]!

      await getDb().query(`UPDATE public.user_v1 SET preferences=$2::jsonb WHERE id=$1`, [
        anon.id,
        JSON.stringify({ notesApp: { resultsColumnWidth: 321 } }),
      ])
      await getDb().query(
        `INSERT INTO public.workspace_category_v1(workspace_id,label)
         VALUES($1,'shared'),($1,'anon-only'),($2,'shared')`,
        [anonWorkspace.id, realWorkspace.id],
      )
      await getDb().query(
        `INSERT INTO public.workspace_status_v1(workspace_id,label,position)
         VALUES($1,'todo',1),($2,'todo',1)`,
        [anonWorkspace.id, realWorkspace.id],
      )
      const refs = await getDb().query<{
        categories: number[]
        status_id: number
        tag_id: number
      }>(
        `SELECT
           ARRAY(SELECT id FROM public.workspace_category_v1 WHERE workspace_id=$1 AND label IN ('shared','anon-only') ORDER BY id) categories,
           (SELECT id FROM public.workspace_status_v1 WHERE workspace_id=$1 AND label='todo') status_id,
           (SELECT id FROM public.workspace_tag_v1 WHERE workspace_id=$1 AND label='important') tag_id`,
        [anonWorkspace.id],
      )
      await createItemForUser(
        anon.id,
        {
          workspaceId: anonWorkspace.id,
          categoryIds: refs.rows[0]!.categories,
          statusId: refs.rows[0]!.status_id,
          tagIds: [refs.rows[0]!.tag_id],
          description: "anonymous workspace note",
          timeDue: null,
          timeRemind: null,
        },
        { descriptionEmbedding: null, embeddingModel: null },
      )

      const result = await mergeAnonymousItemsAppSession({ anonUserId: anon.id, realUserId })
      const items = await listItemsByUser(realUserId, realWorkspace.id)
      assert.equal(items.length, 1)
      assert.deepEqual(
        items[0]!.categories.map((category) => category.label),
        ["anon-only", "shared"],
      )
      assert.equal(items[0]!.status?.label, "todo")
      assert.deepEqual(
        items[0]!.tags.map((tag) => tag.label),
        ["important"],
      )
      assert.deepEqual(result.user.preferences, {
        notesApp: { markdownEditorMode: "wysiwyg", resultsColumnWidth: 321 },
      })
      assert.equal(
        Number(
          (await getDb().query(`SELECT COUNT(*) count FROM public.user_v1 WHERE id=$1`, [anon.id]))
            .rows[0]!.count,
        ),
        0,
      )
    } finally {
      await getDb().query(`DELETE FROM public.user_v1 WHERE id=ANY($1::int[])`, [
        [anon.id, realUserId],
      ])
    }
  })

  test("reparents a non-colliding workspace without changing note ids", async () => {
    const realUserId = await createRealUser()
    const anon = await createAnonymousUser()
    try {
      await createWorkspaceForUser(realUserId, "personal")
      const side = await createWorkspaceForUser(anon.id, "side")
      const item = await createItemForUser(
        anon.id,
        {
          workspaceId: side.id,
          categoryIds: [],
          statusId: null,
          tagIds: [],
          description: "keep my id",
          timeDue: null,
          timeRemind: null,
        },
        { descriptionEmbedding: null, embeddingModel: null },
      )

      await mergeAnonymousItemsAppSession({ anonUserId: anon.id, realUserId })
      const moved = await listItemsByUser(realUserId, side.id)
      assert.equal(moved[0]?.id, item.id)
      assert.equal(
        (await getDb().query(`SELECT user_id FROM public.user_workspace_v1 WHERE id=$1`, [side.id]))
          .rows[0]!.user_id,
        realUserId,
      )
    } finally {
      await getDb().query(`DELETE FROM public.user_v1 WHERE id=ANY($1::int[])`, [
        [anon.id, realUserId],
      ])
    }
  })
})
