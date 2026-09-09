import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { after, describe, test } from "node:test"
import { getDb } from "../lib/db/postgres"
import { CURRENT_NOTE_EMBEDDING_MODEL } from "../services/notes-embeddings"
import { searchNotesByEmbedding } from "../sql/note"
import { createWorkspaceForUser } from "../sql/workspace"

const testDbUrl = process.env.DB_NOTES_TEST_URL
if (testDbUrl) process.env.DB_NOTES_URL = testDbUrl

const vector = (values: Record<number, number>) => {
  const result = Array<number>(1024).fill(0)
  for (const [index, value] of Object.entries(values)) result[Number(index)] = value
  return JSON.stringify(result)
}

describe("workspace semantic search ranking (DB)", { skip: !testDbUrl }, () => {
  after(async () => {
    if (testDbUrl) await getDb().end()
  })

  test("ranks description vectors only and never leaks another workspace", async () => {
    const { rows } = await getDb().query<{ id: number }>(
      `INSERT INTO public.user_v1(username,is_anonymous) VALUES($1,false) RETURNING id`,
      [`search-${randomUUID()}`],
    )
    const userId = rows[0]!.id
    try {
      const first = await createWorkspaceForUser(userId, "first")
      const second = await createWorkspaceForUser(userId, "second")
      const query = vector({ 0: 1 })
      const weak = vector({ 0: 0.2, 1: 1 })
      const unrelated = vector({ 1: 1 })
      const noteRows = await getDb().query<{ id: number; description: string }>(
        `INSERT INTO public.user_note_v1
         (workspace_id,description,description_embedding,embedding_model,embedding_updated_at)
         VALUES
           ($1,'weak match',$3::vector,$4,now()),
           ($1,'unrelated',$5::vector,$4,now()),
           ($2,'other workspace exact',$3::vector,$4,now())
         RETURNING id,description`,
        [first.id, second.id, weak, CURRENT_NOTE_EMBEDDING_MODEL, unrelated],
      )
      const weakId = noteRows.rows.find((row) => row.description === "weak match")!.id
      const unrelatedId = noteRows.rows.find((row) => row.description === "unrelated")!.id

      const results = await searchNotesByEmbedding(userId, first.id, query, 10)
      assert.deepEqual(
        results.map((result) => result.note.id),
        [weakId, unrelatedId],
      )
      assert.ok(results[0]!.similarity > results[1]!.similarity)
      assert.equal(results[1]!.similarity, 0)
    } finally {
      await getDb().query(`DELETE FROM public.user_v1 WHERE id=$1`, [userId])
    }
  })
})
