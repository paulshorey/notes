/**
 * Regression coverage for note-only semantic ranking.
 *
 * Search used to mix description similarity with category/tag similarity
 * (`description * 0.67 + taxonomy * 0.33`). That let a note with an unrelated
 * body outrank a weakly matching note if its category or tags matched the
 * query. Ranking now compares the query vector to `description_embedding`
 * only; taxonomy vectors are still stored but must not affect order.
 *
 * Like the other DB suites, these only run when `DB_NOTES_TEST_URL` is set
 * and they connect to THAT database, never to `DB_NOTES_URL`. Hand-written
 * unit vectors mean the tests never call Jina.
 */
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { after, describe, test } from "node:test"
import { getDb } from "../lib/db/postgres"
import { searchNotesByEmbedding } from "../sql/note"
import { CURRENT_NOTE_EMBEDDING_MODEL } from "../services/notes-embeddings"

const testDbUrl = process.env.DB_NOTES_TEST_URL
const hasDb = Boolean(testDbUrl)
if (hasDb) {
  process.env.DB_NOTES_URL = testDbUrl
}

const DIMS = 1024

const vectorLiteral = (values: Record<number, number>) => {
  const vector = Array<number>(DIMS).fill(0)
  for (const [index, value] of Object.entries(values)) {
    vector[Number(index)] = value
  }
  return JSON.stringify(vector)
}

describe("searchNotesByEmbedding ranking (DB)", { skip: !hasDb }, () => {
  after(async () => {
    if (hasDb) {
      await getDb().end()
    }
  })

  test("ranks by note description similarity and ignores matching category/tag vectors", async () => {
    const db = getDb()
    const suffix = randomUUID().slice(0, 8)
    let userId: number | null = null

    try {
      const { rows: userRows } = await db.query<{ id: number }>(
        `INSERT INTO public.user_v1 (username, is_anonymous)
         VALUES ($1, false) RETURNING id`,
        [`search-rank-${suffix}`],
      )
      userId = userRows[0]!.id

      const queryEmbedding = vectorLiteral({ 0: 1 })
      // Weakly similar to the query (old composite score ≈ 0.13).
      const matchingNoteEmbedding = vectorLiteral({ 0: 0.2, 1: 1 })
      // Orthogonal to the query (description score 0).
      const unrelatedNoteEmbedding = vectorLiteral({ 1: 1 })
      // Perfect match to the query — used only on taxonomy rows.
      const matchingTaxonomyEmbedding = vectorLiteral({ 0: 1 })

      const { rows: matchingCategoryRows } = await db.query<{ id: number }>(
        `INSERT INTO public.user_note_category_v1
           (user_id, label, category_embedding, embedding_model, embedding_updated_at)
         VALUES ($1, $2, $3::vector, $4, now())
         RETURNING id`,
        [userId, `weak-${suffix}`, unrelatedNoteEmbedding, CURRENT_NOTE_EMBEDDING_MODEL],
      )
      const matchingCategoryId = matchingCategoryRows[0]!.id

      const { rows: unrelatedCategoryRows } = await db.query<{ id: number }>(
        `INSERT INTO public.user_note_category_v1
           (user_id, label, category_embedding, embedding_model, embedding_updated_at)
         VALUES ($1, $2, $3::vector, $4, now())
         RETURNING id`,
        [userId, `exact-${suffix}`, matchingTaxonomyEmbedding, CURRENT_NOTE_EMBEDDING_MODEL],
      )
      const unrelatedCategoryId = unrelatedCategoryRows[0]!.id

      const { rows: tagRows } = await db.query<{ id: number }>(
        `INSERT INTO public.user_note_tag_v1
           (user_id, label, tag_embedding, embedding_model, embedding_updated_at)
         VALUES ($1, $2, $3::vector, $4, now())
         RETURNING id`,
        [userId, `exact-tag-${suffix}`, matchingTaxonomyEmbedding, CURRENT_NOTE_EMBEDDING_MODEL],
      )
      const matchingTagId = tagRows[0]!.id

      const { rows: matchingNoteRows } = await db.query<{ id: number }>(
        `INSERT INTO public.user_note_v1
           (user_id, category_id, description, description_embedding, embedding_model, embedding_updated_at)
         VALUES ($1, $2, $3, $4::vector, $5, now())
         RETURNING id`,
        [
          userId,
          matchingCategoryId,
          "weakly related note body",
          matchingNoteEmbedding,
          CURRENT_NOTE_EMBEDDING_MODEL,
        ],
      )
      const matchingNoteId = matchingNoteRows[0]!.id

      const { rows: unrelatedNoteRows } = await db.query<{ id: number }>(
        `INSERT INTO public.user_note_v1
           (user_id, category_id, description, description_embedding, embedding_model, embedding_updated_at)
         VALUES ($1, $2, $3, $4::vector, $5, now())
         RETURNING id`,
        [
          userId,
          unrelatedCategoryId,
          "unrelated note body with a matching tag",
          unrelatedNoteEmbedding,
          CURRENT_NOTE_EMBEDDING_MODEL,
        ],
      )
      const unrelatedNoteId = unrelatedNoteRows[0]!.id

      await db.query(
        `INSERT INTO public.user_note_tag_link_v1 (note_id, tag_id) VALUES ($1, $2)`,
        [unrelatedNoteId, matchingTagId],
      )

      const results = await searchNotesByEmbedding(userId, queryEmbedding, 10)

      assert.equal(results.length, 2)
      assert.equal(results[0]!.note.id, matchingNoteId)
      assert.equal(results[1]!.note.id, unrelatedNoteId)
      assert.ok(
        results[0]!.similarity > results[1]!.similarity,
        `expected the weakly matching note to rank above the taxonomy-matched note (${results[0]!.similarity} vs ${results[1]!.similarity})`,
      )
      assert.ok(results[0]!.similarity > 0)
      assert.equal(results[1]!.similarity, 0)
      assert.equal("tagSimilarity" in results[0]!, false)
      assert.equal("descriptionSimilarity" in results[0]!, false)
      assert.equal("categorySimilarity" in results[0]!, false)
    } finally {
      if (userId !== null) {
        await db.query(`DELETE FROM public.user_v1 WHERE id = $1`, [userId])
      }
    }
  })
})
