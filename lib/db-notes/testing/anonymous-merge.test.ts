/**
 * Regression coverage for the anonymous → existing-account merge
 * (mergeAnonymousUserInto + the mergeAnonymousNotesAppSession service wrapper).
 *
 * The DB-backed tests only run when DB_NOTES_TEST_URL is set, and they
 * connect to THAT database. This is a deliberate opt-in: DB_NOTES_URL is
 * not used, because in deployed/cloud environments it points at the real
 * Notes database and tests must never write there implicitly. CI's
 * verify-notes job sets DB_NOTES_TEST_URL to its throwaway migrated
 * service container; locally point it at your local Postgres. Without it the
 * DB suite is skipped, so `turbo run test` stays green everywhere.
 */
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { after, describe, test } from "node:test"
import { getDb } from "../lib/db/postgres"
import { mergeAnonymousNotesAppSession } from "../services/notes-app"
import { createAnonymousUser, mergePreferenceObjects } from "../sql/user/anonymous"

describe("mergePreferenceObjects", () => {
  test("anon leaf values win, real-only keys are preserved, objects merge recursively", () => {
    const real = {
      notesApp: { markdownEditorMode: "wysiwyg", resultsColumnWidth: 480 },
      otherApp: { keep: true },
    }
    const anon = {
      notesApp: { resultsColumnWidth: 321 },
    }

    assert.deepEqual(mergePreferenceObjects(real, anon), {
      notesApp: { markdownEditorMode: "wysiwyg", resultsColumnWidth: 321 },
      otherApp: { keep: true },
    })
  })

  test("non-object values are replaced, not merged", () => {
    assert.deepEqual(mergePreferenceObjects({ a: { nested: 1 } }, { a: "flat" }), { a: "flat" })
    assert.deepEqual(mergePreferenceObjects({ a: [1, 2] }, { a: [3] }), { a: [3] })
  })

  test("does not mutate its inputs", () => {
    const real = { notesApp: { markdownEditorMode: "wysiwyg" } }
    const anon = { notesApp: { resultsColumnWidth: 300 } }
    mergePreferenceObjects(real, anon)
    assert.deepEqual(real, { notesApp: { markdownEditorMode: "wysiwyg" } })
    assert.deepEqual(anon, { notesApp: { resultsColumnWidth: 300 } })
  })
})

const testDbUrl = process.env.DB_NOTES_TEST_URL
const hasDb = Boolean(testDbUrl)
if (hasDb) {
  // getDb() reads DB_NOTES_URL lazily on first use; point it at the
  // opted-in test database before any query runs.
  process.env.DB_NOTES_URL = testDbUrl
}

describe("mergeAnonymousNotesAppSession (DB)", { skip: !hasDb }, () => {
  after(async () => {
    if (hasDb) {
      await getDb().end()
    }
  })

  /**
   * Users created with raw SQL here bypass createAnonymousUser, which is what
   * seeds the tier vocabulary in production. Without it the composite level
   * foreign key rejects every taxonomy insert.
   */
  const seedTaxonomyLevels = (userId: number) =>
    getDb().query(
      `INSERT INTO public.user_taxonomy_level_v1 (user_id, level, label)
       SELECT $1, v.level, v.label
       FROM (VALUES (1,'Epic'),(2,'Category'),(3,'Group'),(4,'Note')) AS v(level, label)
       ON CONFLICT DO NOTHING`,
      [userId],
    )

  const insertTaxonomy = async (
    userId: number,
    level: number,
    parentId: number | null,
    label: string,
  ) => {
    const { rows } = await getDb().query<{ id: number }>(
      `INSERT INTO public.user_taxonomy_v1 (user_id, level, parent_id, label)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [userId, level, parentId, label],
    )
    return rows[0]!.id
  }

  test("reassigns notes, dedupes labels, merges preferences, deletes the anon row", async () => {
    // The merge's embedding backfill must degrade gracefully when Jina is not
    // configured; keep the test hermetic by guaranteeing that state.
    const savedJinaKey = process.env.JINA_API_KEY
    delete process.env.JINA_API_KEY

    const db = getDb()
    const suffix = randomUUID().slice(0, 8)
    const realUsername = `merge-test-real-${suffix}`
    let realUserId: number | null = null
    let anonUserId: number | null = null

    try {
      // --- Real (destination) account with pre-existing data. ---
      const realUser = await db.query<{ id: number }>(
        `INSERT INTO public.user_v1 (username, is_anonymous, preferences)
         VALUES ($1, false, $2::jsonb)
         RETURNING id`,
        [realUsername, JSON.stringify({ notesApp: { markdownEditorMode: "wysiwyg" } })],
      )
      realUserId = realUser.rows[0]!.id

      await seedTaxonomyLevels(realUserId)
      const realEpicId = await insertTaxonomy(realUserId, 1, null, "shared-epic")
      const realSharedCategoryId = await insertTaxonomy(realUserId, 2, realEpicId, "shared")
      const realSharedGroupId = await insertTaxonomy(
        realUserId,
        3,
        realSharedCategoryId,
        "shared",
      )

      const realTag = await db.query<{ id: number }>(
        `INSERT INTO public.user_note_tag_v1 (user_id, label)
         VALUES ($1, 'important') RETURNING id`,
        [realUserId],
      )
      const realImportantTagId = realTag.rows[0]!.id

      await db.query(
        `INSERT INTO public.user_note_v1 (user_id, group_id, description)
         VALUES ($1, $2, 'pre-existing real note')`,
        [realUserId, realSharedGroupId],
      )

      // --- Anonymous (source) account. createAnonymousUser seeds the default
      // "important" tag, so the dedup path is always exercised. ---
      const anonUser = await createAnonymousUser()
      anonUserId = anonUser.id

      await db.query(`UPDATE public.user_v1 SET preferences = $2::jsonb WHERE id = $1`, [
        anonUserId,
        JSON.stringify({ notesApp: { resultsColumnWidth: 321 } }),
      ])

      // The visitor's tree overlaps the destination account's on label, which
      // is what the dedup path has to collapse. "anon-only" does not overlap
      // and must arrive as a new row.
      const anonEpicId = await insertTaxonomy(anonUserId, 1, null, "shared-epic")
      const anonSharedCategoryId = await insertTaxonomy(anonUserId, 2, anonEpicId, "shared")
      const anonOnlyCategoryId = await insertTaxonomy(anonUserId, 2, anonEpicId, "anon-only")
      const anonSharedGroupId = await insertTaxonomy(
        anonUserId,
        3,
        anonSharedCategoryId,
        "shared",
      )
      const anonOnlyGroupId = await insertTaxonomy(anonUserId, 3, anonOnlyCategoryId, "inbox")

      const anonImportantTag = await db.query<{ id: number }>(
        `SELECT id FROM public.user_note_tag_v1 WHERE user_id = $1 AND label = 'important'`,
        [anonUserId],
      )
      const anonImportantTagId = anonImportantTag.rows[0]!.id

      const anonNotes = await db.query<{ id: number; description: string }>(
        `INSERT INTO public.user_note_v1 (user_id, group_id, description)
         VALUES ($1, $2, 'anon note in shared'), ($1, $3, 'anon note in anon-only')
         RETURNING id, description`,
        [anonUserId, anonSharedGroupId, anonOnlyGroupId],
      )
      const anonSharedNoteId = anonNotes.rows.find(
        (row) => row.description === "anon note in shared",
      )!.id

      await db.query(`INSERT INTO public.user_note_tag_link_v1 (note_id, tag_id) VALUES ($1, $2)`, [
        anonSharedNoteId,
        anonImportantTagId,
      ])

      // --- Merge. ---
      const result = await mergeAnonymousNotesAppSession({
        anonUserId,
        realUserId,
      })
      assert.equal(result.user.id, realUserId)

      // Anon row is gone (CASCADE removed its leftover categories/tags).
      const anonRow = await db.query(`SELECT id FROM public.user_v1 WHERE id = $1`, [anonUserId])
      assert.equal(anonRow.rows.length, 0)
      anonUserId = null

      // All notes belong to the real user; the anon "shared" note was
      // remapped onto the real user's pre-existing "shared" category.
      const notes = await db.query<{
        description: string
        user_id: number
        group_id: number
      }>(
        `SELECT description, user_id, group_id FROM public.user_note_v1
         WHERE user_id = $1 ORDER BY description`,
        [realUserId],
      )
      assert.deepEqual(
        notes.rows.map((row) => row.description),
        ["anon note in anon-only", "anon note in shared", "pre-existing real note"],
      )
      const mergedSharedNote = notes.rows.find((row) => row.description === "anon note in shared")!
      assert.equal(mergedSharedNote.group_id, realSharedGroupId)

      // Deduped by label within each parent: one "shared" category, plus the
      // visitor's "anon-only". A renamed row would arrive as an extra row
      // rather than following the rename, which is the intended behavior.
      const categories = await db.query<{ label: string }>(
        `SELECT label FROM public.user_taxonomy_v1
         WHERE user_id = $1 AND level = 2 ORDER BY label`,
        [realUserId],
      )
      // "uncategorized" comes from the visitor's own seeded chain, which is
      // real data and merges like anything else.
      assert.deepEqual(
        categories.rows.map((row) => row.label),
        ["anon-only", "shared", "uncategorized"],
      )

      // The remap is what lets the client repair an open note whose draft still
      // points at an anonymous group id. Without it that note silently falls
      // back to a default group and loses its placement.
      const groupRemap = result.remaps.taxonomy.find(
        (entry) => entry.anonId === anonSharedGroupId,
      )
      assert.equal(groupRemap?.realId, realSharedGroupId)
      assert.equal(
        result.remaps.taxonomy.some((entry) => entry.anonId === anonOnlyGroupId),
        true,
      )

      // Tags deduped: one "important", and the tag link was remapped from the
      // anon tag id to the real user's tag id.
      const tags = await db.query<{ id: number; label: string }>(
        `SELECT id, label FROM public.user_note_tag_v1
         WHERE user_id = $1 ORDER BY label`,
        [realUserId],
      )
      assert.deepEqual(
        tags.rows.map((row) => row.label),
        ["important"],
      )
      assert.equal(tags.rows[0]!.id, realImportantTagId)

      const links = await db.query<{ tag_id: number }>(
        `SELECT tag_id FROM public.user_note_tag_link_v1 WHERE note_id = $1`,
        [anonSharedNoteId],
      )
      assert.deepEqual(
        links.rows.map((row) => row.tag_id),
        [realImportantTagId],
      )

      // Preferences merged per property: the anon-customized column width
      // carried over, the real account's editor mode survived.
      assert.deepEqual(result.user.preferences, {
        notesApp: { markdownEditorMode: "wysiwyg", resultsColumnWidth: 321 },
      })
    } finally {
      if (savedJinaKey !== undefined) {
        process.env.JINA_API_KEY = savedJinaKey
      }
      // CASCADE cleans up any notes/categories/tags/links owned by the users.
      if (anonUserId !== null) {
        await db.query(`DELETE FROM public.user_v1 WHERE id = $1`, [anonUserId])
      }
      if (realUserId !== null) {
        await db.query(`DELETE FROM public.user_v1 WHERE id = $1`, [realUserId])
      }
    }
  })

  test("preferences are untouched when the anonymous user never customized anything", async () => {
    const db = getDb()
    const suffix = randomUUID().slice(0, 8)
    let realUserId: number | null = null
    let anonUserId: number | null = null

    try {
      const realUser = await db.query<{ id: number }>(
        `INSERT INTO public.user_v1 (username, is_anonymous, preferences)
         VALUES ($1, false, $2::jsonb)
         RETURNING id`,
        [`merge-test-real-${suffix}`, JSON.stringify({ notesApp: { resultsColumnWidth: 555 } })],
      )
      realUserId = realUser.rows[0]!.id
      await seedTaxonomyLevels(realUserId)

      const anonUser = await createAnonymousUser()
      anonUserId = anonUser.id

      const result = await mergeAnonymousNotesAppSession({
        anonUserId,
        realUserId,
      })
      anonUserId = null

      assert.deepEqual(result.user.preferences, {
        notesApp: { resultsColumnWidth: 555 },
      })
    } finally {
      if (anonUserId !== null) {
        await db.query(`DELETE FROM public.user_v1 WHERE id = $1`, [anonUserId])
      }
      if (realUserId !== null) {
        await db.query(`DELETE FROM public.user_v1 WHERE id = $1`, [realUserId])
      }
    }
  })
})
