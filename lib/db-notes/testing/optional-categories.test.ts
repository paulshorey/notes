import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { after, describe, test } from "node:test"
import { getDb } from "../lib/db/postgres"
import { createWorkspaceForUser, ensureDefaultWorkspaceForUser } from "../sql/workspace"
import { createNoteForUser, updateNoteForUser, listNotesByUser } from "../sql/note"
import { deleteCategoryForWorkspace, listCategoriesByWorkspace } from "../sql/category"

const testDbUrl = process.env.DB_NOTES_TEST_URL
if (testDbUrl) process.env.DB_NOTES_URL = testDbUrl

describe("optional categories (DB)", { skip: !testDbUrl }, () => {
  after(async () => {
    if (testDbUrl) await getDb().end()
  })

  test("notes save with no categories and survive deleting their oldest and final category", async () => {
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
        categoryIds: [] as number[],
        statusId: null,
        tagIds: [],
        description: "capture first",
        timeDue: null,
        timeRemind: null,
      }
      const embeddings = { descriptionEmbedding: null, embeddingModel: null }
      const note = await createNoteForUser(userId, input, embeddings)
      assert.deepEqual(note.categories, [])
      const ids = (
        await getDb().query<{ id: number }>(
          `INSERT INTO public.workspace_note_category_v1(workspace_id,label) VALUES($1,'first'),($1,'last') RETURNING id`,
          [workspace.id],
        )
      ).rows.map((row) => row.id)
      await updateNoteForUser(note.id, userId, { ...input, categoryIds: ids }, null)
      assert.equal(await deleteCategoryForWorkspace(userId, workspace.id, ids[0]!), true)
      assert.deepEqual(
        (await listNotesByUser(userId, workspace.id))[0]!.categories.map((c) => c.id),
        [ids[1]],
      )
      assert.equal(await deleteCategoryForWorkspace(userId, workspace.id, ids[1]!), true)
      const client = await getDb().connect()
      try {
        await ensureDefaultWorkspaceForUser(client, userId)
      } finally {
        client.release()
      }
      assert.deepEqual(await listCategoriesByWorkspace(userId, workspace.id), [])
      const stored = (await listNotesByUser(userId, workspace.id))[0]!
      assert.equal(stored.id, note.id)
      assert.equal(stored.description, input.description)
      assert.deepEqual(stored.categories, [])
      const updated = await updateNoteForUser(
        note.id,
        userId,
        { ...input, description: "still saveable" },
        null,
      )
      assert.equal(updated!.description, "still saveable")
      assert.deepEqual(updated!.categories, [])
    } finally {
      await getDb().query(`DELETE FROM public.user_v1 WHERE id=$1`, [userId])
    }
  })
})
