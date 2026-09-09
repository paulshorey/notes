import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { after, describe, test } from "node:test"
import { getDb } from "../lib/db/postgres"
import { createNoteForUser, listNotesByUser, updateNoteForUser } from "../sql/note"
import {
  createWorkspaceForUser,
  ensureDefaultWorkspaceForUser,
  listWorkspacesByUser,
} from "../sql/workspace"

const testDbUrl = process.env.DB_NOTES_TEST_URL
if (testDbUrl) process.env.DB_NOTES_URL = testDbUrl

describe("workspace-scoped note model (DB)", { skip: !testDbUrl }, () => {
  after(async () => {
    if (testDbUrl) await getDb().end()
  })
  const createUser = async () => {
    const { rows } = await getDb().query<{ id: number }>(
      `INSERT INTO public.user_v1(username,is_anonymous) VALUES($1,true) RETURNING id`,
      [`workspace-test-${randomUUID()}`],
    )
    return rows[0]!.id
  }
  test("seeds defaults once and isolates identical labels between workspaces", async () => {
    const userId = await createUser()
    try {
      const client = await getDb().connect()
      let first: number
      try {
        await client.query("BEGIN")
        first = await ensureDefaultWorkspaceForUser(client, userId)
        await ensureDefaultWorkspaceForUser(client, userId)
        await client.query("COMMIT")
      } finally {
        client.release()
      }
      const second = await createWorkspaceForUser(userId, "work")
      assert.deepEqual(
        (await listWorkspacesByUser(userId)).map((w) => w.label),
        ["personal", "work"],
      )
      const defaults = await getDb().query<{ workspace_id: number; label: string }>(
        `SELECT workspace_id,label FROM public.workspace_note_category_v1 WHERE workspace_id=ANY($1::int[]) ORDER BY workspace_id`,
        [[first, second.id]],
      )
      assert.deepEqual(
        defaults.rows.map((r) => r.label),
        ["uncategorized", "uncategorized"],
      )
    } finally {
      await getDb().query(`DELETE FROM public.user_v1 WHERE id=$1`, [userId])
    }
  })
  test("stores multiple categories and rejects cross-workspace relations", async () => {
    const userId = await createUser()
    try {
      const personal = await createWorkspaceForUser(userId, "personal")
      const other = await createWorkspaceForUser(userId, "other")
      const categories = await getDb().query<{ id: number }>(
        `INSERT INTO public.workspace_note_category_v1(workspace_id,label) VALUES($1,'one'),($1,'two') RETURNING id`,
        [personal.id],
      )
      const status = await getDb().query<{ id: number }>(
        `SELECT id FROM public.workspace_note_status_v1 WHERE workspace_id=$1 LIMIT 1`,
        [personal.id],
      )
      const note = await createNoteForUser(
        userId,
        {
          workspaceId: personal.id,
          categoryIds: categories.rows.map((r) => r.id),
          statusId: status.rows[0]!.id,
          tagIds: [],
          description: "two categories",
          timeDue: null,
          timeRemind: null,
        },
        { descriptionEmbedding: null, embeddingModel: null },
      )
      assert.equal(note.categories.length, 2)
      assert.equal((await listNotesByUser(userId, other.id)).length, 0)
      const otherStatus = await getDb().query<{ id: number }>(
        `SELECT id FROM public.workspace_note_status_v1 WHERE workspace_id=$1 LIMIT 1`,
        [other.id],
      )
      await assert.rejects(
        createNoteForUser(
          userId,
          {
            workspaceId: personal.id,
            categoryIds: [],
            statusId: otherStatus.rows[0]!.id,
            tagIds: [],
            description: "invalid",
            timeDue: null,
            timeRemind: null,
          },
          { descriptionEmbedding: null, embeddingModel: null },
        ),
      )
      const otherCategory = await getDb().query<{ id: number }>(
        `SELECT id FROM public.workspace_note_category_v1 WHERE workspace_id=$1 LIMIT 1`,
        [other.id],
      )
      const otherTag = await getDb().query<{ id: number }>(
        `SELECT id FROM public.workspace_note_tag_v1 WHERE workspace_id=$1 LIMIT 1`,
        [other.id],
      )
      for (const invalidInput of [
        { categoryIds: [otherCategory.rows[0]!.id], tagIds: [] },
        { categoryIds: [], tagIds: [otherTag.rows[0]!.id] },
      ]) {
        await assert.rejects(
          createNoteForUser(
            userId,
            {
              workspaceId: personal.id,
              statusId: null,
              description: "invalid relation",
              timeDue: null,
              timeRemind: null,
              ...invalidInput,
            },
            { descriptionEmbedding: null, embeddingModel: null },
          ),
        )
      }

      const personalTag = await getDb().query<{ id: number }>(
        `SELECT id FROM public.workspace_note_tag_v1 WHERE workspace_id=$1 LIMIT 1`,
        [personal.id],
      )
      const updated = await updateNoteForUser(
        note.id,
        userId,
        {
          workspaceId: personal.id,
          categoryIds: [categories.rows[0]!.id],
          statusId: null,
          tagIds: [personalTag.rows[0]!.id],
          description: note.description ?? "",
          timeDue: null,
          timeRemind: null,
        },
        null,
        note.description,
      )
      assert.deepEqual(
        updated?.categories.map((category) => category.id),
        [categories.rows[0]!.id],
      )
      assert.equal(updated?.status, null)
      assert.deepEqual(
        updated?.tags.map((tag) => tag.id),
        [personalTag.rows[0]!.id],
      )
    } finally {
      await getDb().query(`DELETE FROM public.user_v1 WHERE id=$1`, [userId])
    }
  })
})
