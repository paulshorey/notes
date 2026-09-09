import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { after, describe, test } from "node:test"
import { getDb } from "../lib/db/postgres"
import { CURRENT_NOTE_EMBEDDING_MODEL } from "../services/notes-embeddings"
import { updateNoteForNotesApp } from "../services/notes-app"
import { updateNoteForUser } from "../sql/note"
import { createWorkspaceForUser } from "../sql/workspace"

const testDbUrl = process.env.DB_NOTES_TEST_URL
if (testDbUrl) process.env.DB_NOTES_URL = testDbUrl

describe("workspace note embedding reuse (DB)", { skip: !testDbUrl }, () => {
  after(async () => {
    if (testDbUrl) await getDb().end()
  })

  const seed = async (model: string | null, withEmbedding: boolean, description = "unchanged") => {
    const { rows } = await getDb().query<{ id: number }>(
      `INSERT INTO public.user_v1(username,is_anonymous) VALUES($1,false) RETURNING id`,
      [`embedding-${randomUUID()}`],
    )
    const userId = rows[0]!.id
    const workspace = await createWorkspaceForUser(userId, "personal")
    const category = await getDb().query<{ id: number }>(
      `INSERT INTO public.workspace_note_category_v1(workspace_id,label) VALUES($1,'work') RETURNING id`,
      [workspace.id],
    )
    const vector = withEmbedding ? `[${Array(1024).fill(0.01).join(",")}]` : null
    const note = await getDb().query<{ id: number }>(
      `INSERT INTO public.user_note_v1
       (workspace_id,description,description_embedding,embedding_model,embedding_updated_at)
       VALUES($1,$2,$3::vector,$4,CASE WHEN $4::text IS NULL THEN NULL ELSE now() END)
       RETURNING id`,
      [workspace.id, description, vector, model],
    )
    return {
      userId,
      workspaceId: workspace.id,
      categoryId: category.rows[0]!.id,
      noteId: note.rows[0]!.id,
    }
  }

  const input = (workspaceId: number, categoryIds: number[], description: string) => ({
    workspaceId,
    categoryIds,
    statusId: null,
    tagIds: [] as number[],
    description,
    timeDue: null,
    timeRemind: null,
  })

  const state = async (noteId: number) =>
    (
      await getDb().query<{
        description: string | null
        has_embedding: boolean
        embedding_model: string | null
        embedding_updated_at: Date | null
      }>(
        `SELECT description,(description_embedding IS NOT NULL) has_embedding,
                embedding_model,embedding_updated_at
         FROM public.user_note_v1 WHERE id=$1`,
        [noteId],
      )
    ).rows[0]!

  test("relation-only changes reuse a current stored embedding", async () => {
    const row = await seed(CURRENT_NOTE_EMBEDDING_MODEL, true)
    const savedKey = process.env.JINA_API_KEY
    delete process.env.JINA_API_KEY
    try {
      const before = await state(row.noteId)
      const result = await updateNoteForNotesApp({
        userId: row.userId,
        noteId: row.noteId,
        note: input(row.workspaceId, [row.categoryId], "unchanged"),
      })
      assert.ok(result)
      assert.equal(
        String((await state(row.noteId)).embedding_updated_at),
        String(before.embedding_updated_at),
      )
    } finally {
      if (savedKey !== undefined) process.env.JINA_API_KEY = savedKey
      await getDb().query(`DELETE FROM public.user_v1 WHERE id=$1`, [row.userId])
    }
  })

  for (const [name, model, withEmbedding] of [
    ["repairs a missing embedding", null, false],
    ["replaces a superseded embedding model", "old-model", true],
  ] as const) {
    test(name, async () => {
      const row = await seed(model, withEmbedding)
      const savedKey = process.env.JINA_API_KEY
      delete process.env.JINA_API_KEY
      try {
        await assert.rejects(
          updateNoteForNotesApp({
            userId: row.userId,
            noteId: row.noteId,
            note: input(row.workspaceId, [row.categoryId], "unchanged"),
          }),
        )
      } finally {
        if (savedKey !== undefined) process.env.JINA_API_KEY = savedKey
        await getDb().query(`DELETE FROM public.user_v1 WHERE id=$1`, [row.userId])
      }
    })
  }

  test("clearing text clears embedding metadata without Jina", async () => {
    const row = await seed(CURRENT_NOTE_EMBEDDING_MODEL, true, "clear me")
    const savedKey = process.env.JINA_API_KEY
    delete process.env.JINA_API_KEY
    try {
      await updateNoteForNotesApp({
        userId: row.userId,
        noteId: row.noteId,
        note: input(row.workspaceId, [row.categoryId], ""),
      })
      const after = await state(row.noteId)
      assert.equal(after.has_embedding, false)
      assert.equal(after.embedding_model, null)
      assert.equal(after.embedding_updated_at, null)
    } finally {
      if (savedKey !== undefined) process.env.JINA_API_KEY = savedKey
      await getDb().query(`DELETE FROM public.user_v1 WHERE id=$1`, [row.userId])
    }
  })

  test("the reuse guard refuses to overwrite concurrently changed text", async () => {
    const row = await seed(CURRENT_NOTE_EMBEDDING_MODEL, true, "original")
    try {
      await getDb().query(`UPDATE public.user_note_v1 SET description='other writer' WHERE id=$1`, [
        row.noteId,
      ])
      const stale = await updateNoteForUser(
        row.noteId,
        row.userId,
        input(row.workspaceId, [row.categoryId], "original"),
        null,
        "original",
      )
      assert.equal(stale, null)
      assert.equal((await state(row.noteId)).description, "other writer")
    } finally {
      await getDb().query(`DELETE FROM public.user_v1 WHERE id=$1`, [row.userId])
    }
  })
})
