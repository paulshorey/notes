import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { after, describe, test } from "node:test"
import { getDb } from "../lib/db/postgres"
import { createWorkspaceForUser, ensureDefaultWorkspaceForUser } from "../sql/workspace"
import { createItemForUser, updateItemForUser, listItemsByUser } from "../sql/item"
import { deleteCategoryForWorkspace, listCategoriesByWorkspace } from "../sql/category"

const testDbUrl = process.env.DB_ITEMS_TEST_URL ?? process.env.DB_NOTES_TEST_URL
if (testDbUrl) process.env.DB_ITEMS_URL = testDbUrl

describe("optional categories (DB)", { skip: !testDbUrl }, () => {
  after(async () => {
    if (testDbUrl) await getDb().end()
  })

  test("an item saves with no category and survives deleting the category it is filed in", async () => {
    const userId = (
      await getDb().query<{ id: number }>(
        `INSERT INTO public.user_v1(username,is_anonymous) VALUES($1,true) RETURNING id`,
        [`optional-${randomUUID()}`],
      )
    ).rows[0]!.id
    try {
      const workspace = await createWorkspaceForUser(userId, "personal")
      assert.deepEqual(await listCategoriesByWorkspace(userId, workspace.id), [])
      const input = {
        workspaceId: workspace.id,
        categoryId: null as number | null,
        subcategoryId: null,
        statusId: null,
        tagIds: [],
        description: "capture first",
        timeDue: null,
        timeRemind: null,
      }
      const embeddings = { descriptionEmbedding: null, embeddingModel: null }
      const item = await createItemForUser(userId, input, embeddings)
      assert.equal(item.category, null)
      const ids = (
        await getDb().query<{ id: number }>(
          `INSERT INTO public.workspace_category_v1(workspace_id,label) VALUES($1,'first'),($1,'last') RETURNING id`,
          [workspace.id],
        )
      ).rows.map((row) => row.id)
      await updateItemForUser(item.id, userId, { ...input, categoryId: ids[1]! })
      // Deleting a category the item is not filed in leaves its filing alone.
      assert.equal(await deleteCategoryForWorkspace(userId, workspace.id, ids[0]!), true)
      assert.equal((await listItemsByUser(userId, workspace.id))[0]!.category?.id, ids[1])
      // Deleting the category it is filed in unfiles the item and keeps it.
      assert.equal(await deleteCategoryForWorkspace(userId, workspace.id, ids[1]!), true)
      const client = await getDb().connect()
      try {
        await ensureDefaultWorkspaceForUser(client, userId)
      } finally {
        client.release()
      }
      assert.deepEqual(await listCategoriesByWorkspace(userId, workspace.id), [])
      const stored = (await listItemsByUser(userId, workspace.id))[0]!
      assert.equal(stored.id, item.id)
      assert.equal(stored.description, input.description)
      assert.equal(stored.category, null)
      const updated = await updateItemForUser(item.id, userId, {
        ...input,
        description: "still saveable",
      })
      assert.equal(updated!.description, "still saveable")
      assert.equal(updated!.category, null)
    } finally {
      await getDb().query(`DELETE FROM public.user_v1 WHERE id=$1`, [userId])
    }
  })
})
