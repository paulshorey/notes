/**
 * Regression coverage for the re-embed skip in updateNoteForNotesApp.
 *
 * Updating a note used to call Jina unconditionally, so a sidebar move or a
 * due-date change — neither of which touches the description — paid for a full
 * embedding round-trip. The skip is only safe when the stored vector is
 * already what a reindex would produce, which is three conditions rather than
 * one; each branch below pins one of them.
 *
 * Like the merge suite, these only run when DB_NOTES_TEST_URL is set and they
 * connect to THAT database, never to DB_NOTES_URL.
 */
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { after, describe, test } from "node:test"
import { getDb } from "../lib/db/postgres"
import { updateNoteForNotesApp } from "../services/notes-app"
import { CURRENT_NOTE_EMBEDDING_MODEL } from "../services/notes-embeddings"

const testDbUrl = process.env.DB_NOTES_TEST_URL
const hasDb = Boolean(testDbUrl)
if (hasDb) {
  process.env.DB_NOTES_URL = testDbUrl
}

describe("updateNoteForNotesApp embedding reuse (DB)", { skip: !hasDb }, () => {
  after(async () => {
    if (hasDb) {
      await getDb().end()
    }
  })

  /**
   * A note with a hand-written embedding, so the tests never need Jina. A real
   * Jina call would fail here anyway — which is the point: if the skip does not
   * fire, the update throws and the test fails loudly rather than silently
   * doing the expensive thing.
   */
  const seedNote = async (options: {
    description: string
    embeddingModel: string | null
    withEmbedding: boolean
  }) => {
    const db = getDb()
    const suffix = randomUUID().slice(0, 8)

    const { rows: userRows } = await db.query<{ id: number }>(
      `INSERT INTO public.user_v1 (username, is_anonymous)
       VALUES ($1, false) RETURNING id`,
      [`embed-skip-${suffix}`],
    )
    const userId = userRows[0]!.id

    const { rows: categoryRows } = await db.query<{ id: number }>(
      `INSERT INTO public.user_note_category_v1 (user_id, label)
       VALUES ($1, $2) RETURNING id`,
      [userId, `cat-${suffix}`],
    )
    const categoryId = categoryRows[0]!.id

    const vector = options.withEmbedding ? `[${Array(1024).fill(0.01).join(",")}]` : null

    const { rows: noteRows } = await db.query<{ id: number }>(
      `INSERT INTO public.user_note_v1
         (user_id, category_id, description, description_embedding, embedding_model, embedding_updated_at)
       VALUES ($1, $2, $3, $4::vector, $5::text, CASE WHEN $5::text IS NULL THEN NULL ELSE now() END)
       RETURNING id`,
      [userId, categoryId, options.description, vector, options.embeddingModel],
    )

    return { userId, categoryId, noteId: noteRows[0]!.id, suffix }
  }

  const readEmbeddingState = async (noteId: number) => {
    const { rows } = await getDb().query<{
      description: string | null
      has_embedding: boolean
      embedding_model: string | null
      embedding_updated_at: string | null
    }>(
      `SELECT description,
              (description_embedding IS NOT NULL) AS has_embedding,
              embedding_model,
              embedding_updated_at
       FROM public.user_note_v1 WHERE id = $1`,
      [noteId],
    )
    return rows[0]!
  }

  const cleanup = async (userId: number) => {
    await getDb().query(`DELETE FROM public.user_v1 WHERE id = $1`, [userId])
  }

  test("a category-only change reuses the stored embedding", async () => {
    const savedJinaKey = process.env.JINA_API_KEY
    // Guarantees the assertion means something: any Jina call would now throw.
    delete process.env.JINA_API_KEY

    const { userId, categoryId, noteId, suffix } = await seedNote({
      description: "unchanged text",
      embeddingModel: CURRENT_NOTE_EMBEDDING_MODEL,
      withEmbedding: true,
    })

    try {
      const before = await readEmbeddingState(noteId)

      const { rows: otherCategory } = await getDb().query<{ id: number }>(
        `INSERT INTO public.user_note_category_v1 (user_id, label)
         VALUES ($1, $2) RETURNING id`,
        [userId, `other-${suffix}`],
      )

      const result = await updateNoteForNotesApp({
        userId,
        noteId,
        note: {
          categoryId: otherCategory[0]!.id,
          tagIds: [],
          description: "unchanged text",
          timeDue: null,
          timeRemind: null,
        },
      })

      assert.ok(result)
      assert.equal(result.note.category.id, otherCategory[0]!.id)

      const after = await readEmbeddingState(noteId)
      assert.equal(after.has_embedding, true)
      assert.equal(after.embedding_model, CURRENT_NOTE_EMBEDDING_MODEL)
      assert.equal(
        String(after.embedding_updated_at),
        String(before.embedding_updated_at),
        "embedding_updated_at moved, so the note was needlessly re-embedded",
      )
      assert.notEqual(categoryId, otherCategory[0]!.id)
    } finally {
      if (savedJinaKey !== undefined) process.env.JINA_API_KEY = savedJinaKey
      await cleanup(userId)
    }
  })

  test("a note with no stored embedding is repaired even when the text is unchanged", async () => {
    const savedJinaKey = process.env.JINA_API_KEY
    delete process.env.JINA_API_KEY

    const { userId, categoryId, noteId } = await seedNote({
      description: "never embedded",
      embeddingModel: null,
      withEmbedding: false,
    })

    try {
      // Skipping would make this resolve; attempting the embed makes it throw
      // for want of a key. Throwing is the correct behavior.
      await assert.rejects(
        updateNoteForNotesApp({
          userId,
          noteId,
          note: {
            categoryId,
            tagIds: [],
            description: "never embedded",
            timeDue: null,
            timeRemind: null,
          },
        }),
      )
    } finally {
      if (savedJinaKey !== undefined) process.env.JINA_API_KEY = savedJinaKey
      await cleanup(userId)
    }
  })

  test("a note embedded with a superseded model is re-embedded", async () => {
    const savedJinaKey = process.env.JINA_API_KEY
    delete process.env.JINA_API_KEY

    const { userId, categoryId, noteId } = await seedNote({
      description: "old model",
      embeddingModel: "jina-embeddings-v1:notes-v0",
      withEmbedding: true,
    })

    try {
      await assert.rejects(
        updateNoteForNotesApp({
          userId,
          noteId,
          note: {
            categoryId,
            tagIds: [],
            description: "old model",
            timeDue: null,
            timeRemind: null,
          },
        }),
      )
    } finally {
      if (savedJinaKey !== undefined) process.env.JINA_API_KEY = savedJinaKey
      await cleanup(userId)
    }
  })

  test("clearing the description nulls the embedding columns", async () => {
    const savedJinaKey = process.env.JINA_API_KEY
    delete process.env.JINA_API_KEY

    const { userId, categoryId, noteId } = await seedNote({
      description: "will be cleared",
      embeddingModel: CURRENT_NOTE_EMBEDDING_MODEL,
      withEmbedding: true,
    })

    try {
      // An empty description short-circuits inside createNoteEmbeddingInput,
      // so this needs no Jina call and must still clear the stored vector.
      const result = await updateNoteForNotesApp({
        userId,
        noteId,
        note: {
          categoryId,
          tagIds: [],
          description: "",
          timeDue: null,
          timeRemind: null,
        },
      })

      assert.ok(result)
      const after = await readEmbeddingState(noteId)
      assert.equal(after.has_embedding, false)
      assert.equal(after.embedding_model, null)
      assert.equal(after.embedding_updated_at, null)
    } finally {
      if (savedJinaKey !== undefined) process.env.JINA_API_KEY = savedJinaKey
      await cleanup(userId)
    }
  })

  test("an already-empty note with a category change does not attempt an embed", async () => {
    const savedJinaKey = process.env.JINA_API_KEY
    delete process.env.JINA_API_KEY

    const { userId, noteId, suffix } = await seedNote({
      description: "",
      embeddingModel: null,
      withEmbedding: false,
    })

    try {
      const { rows: otherCategory } = await getDb().query<{ id: number }>(
        `INSERT INTO public.user_note_category_v1 (user_id, label)
         VALUES ($1, $2) RETURNING id`,
        [userId, `empty-${suffix}`],
      )

      const result = await updateNoteForNotesApp({
        userId,
        noteId,
        note: {
          categoryId: otherCategory[0]!.id,
          tagIds: [],
          description: "",
          timeDue: null,
          timeRemind: null,
        },
      })

      assert.ok(result)
      const after = await readEmbeddingState(noteId)
      assert.equal(after.has_embedding, false)
    } finally {
      if (savedJinaKey !== undefined) process.env.JINA_API_KEY = savedJinaKey
      await cleanup(userId)
    }
  })
})
