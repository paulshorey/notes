/**
 * Regression coverage for the anonymous → existing-account merge
 * (mergeAnonymousUserInto + the mergeAnonymousNotesAppSession service wrapper).
 *
 * The DB-backed tests only run when DB_MARKETING_TEST_URL is set, and they
 * connect to THAT database. This is a deliberate opt-in: MARKETING_DB_URL is
 * not used, because in deployed/cloud environments it points at the real
 * Notes database and tests must never write there implicitly. CI's
 * verify-marketing job sets DB_MARKETING_TEST_URL to its throwaway migrated
 * service container; locally point it at your local Postgres. Without it the
 * DB suite is skipped, so `turbo run test` stays green everywhere.
 */
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { after, describe, test } from "node:test"
import { getDb } from "../lib/db/postgres"
import { mergeAnonymousNotesAppSession } from "../services/notes-app"
import {
  createAnonymousUser,
  mergePreferenceObjects,
} from "../sql/user/anonymous"

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
    assert.deepEqual(
      mergePreferenceObjects({ a: { nested: 1 } }, { a: "flat" }),
      { a: "flat" },
    )
    assert.deepEqual(
      mergePreferenceObjects({ a: [1, 2] }, { a: [3] }),
      { a: [3] },
    )
  })

  test("does not mutate its inputs", () => {
    const real = { notesApp: { markdownEditorMode: "wysiwyg" } }
    const anon = { notesApp: { resultsColumnWidth: 300 } }
    mergePreferenceObjects(real, anon)
    assert.deepEqual(real, { notesApp: { markdownEditorMode: "wysiwyg" } })
    assert.deepEqual(anon, { notesApp: { resultsColumnWidth: 300 } })
  })
})

const testDbUrl = process.env.DB_MARKETING_TEST_URL
const hasDb = Boolean(testDbUrl)
if (hasDb) {
  // getDb() reads MARKETING_DB_URL lazily on first use; point it at the
  // opted-in test database before any query runs.
  process.env.MARKETING_DB_URL = testDbUrl
}

describe("mergeAnonymousNotesAppSession (DB)", { skip: !hasDb }, () => {
  after(async () => {
    if (hasDb) {
      await getDb().end()
    }
  })

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
        [
          realUsername,
          JSON.stringify({ notesApp: { markdownEditorMode: "wysiwyg" } }),
        ],
      )
      realUserId = realUser.rows[0]!.id

      const realCategory = await db.query<{ id: number }>(
        `INSERT INTO public.user_note_category_v1 (user_id, label)
         VALUES ($1, 'shared') RETURNING id`,
        [realUserId],
      )
      const realSharedCategoryId = realCategory.rows[0]!.id

      const realTag = await db.query<{ id: number }>(
        `INSERT INTO public.user_note_tag_v1 (user_id, label)
         VALUES ($1, 'important') RETURNING id`,
        [realUserId],
      )
      const realImportantTagId = realTag.rows[0]!.id

      await db.query(
        `INSERT INTO public.user_note_v1 (user_id, category_id, description)
         VALUES ($1, $2, 'pre-existing real note')`,
        [realUserId, realSharedCategoryId],
      )

      // --- Anonymous (source) account. createAnonymousUser seeds the default
      // "important" tag, so the dedup path is always exercised. ---
      const anonUser = await createAnonymousUser()
      anonUserId = anonUser.id

      await db.query(
        `UPDATE public.user_v1 SET preferences = $2::jsonb WHERE id = $1`,
        [anonUserId, JSON.stringify({ notesApp: { resultsColumnWidth: 321 } })],
      )

      const anonCategories = await db.query<{ id: number; label: string }>(
        `INSERT INTO public.user_note_category_v1 (user_id, label)
         VALUES ($1, 'shared'), ($1, 'anon-only')
         RETURNING id, label`,
        [anonUserId],
      )
      const anonSharedCategoryId = anonCategories.rows.find(
        (row) => row.label === "shared",
      )!.id
      const anonOnlyCategoryId = anonCategories.rows.find(
        (row) => row.label === "anon-only",
      )!.id

      const anonImportantTag = await db.query<{ id: number }>(
        `SELECT id FROM public.user_note_tag_v1 WHERE user_id = $1 AND label = 'important'`,
        [anonUserId],
      )
      const anonImportantTagId = anonImportantTag.rows[0]!.id

      const anonNotes = await db.query<{ id: number; description: string }>(
        `INSERT INTO public.user_note_v1 (user_id, category_id, description)
         VALUES ($1, $2, 'anon note in shared'), ($1, $3, 'anon note in anon-only')
         RETURNING id, description`,
        [anonUserId, anonSharedCategoryId, anonOnlyCategoryId],
      )
      const anonSharedNoteId = anonNotes.rows.find(
        (row) => row.description === "anon note in shared",
      )!.id

      await db.query(
        `INSERT INTO public.user_note_tag_link_v1 (note_id, tag_id) VALUES ($1, $2)`,
        [anonSharedNoteId, anonImportantTagId],
      )

      // --- Merge. ---
      const result = await mergeAnonymousNotesAppSession({
        anonUserId,
        realUserId,
      })
      assert.equal(result.user.id, realUserId)

      // Anon row is gone (CASCADE removed its leftover categories/tags).
      const anonRow = await db.query(
        `SELECT id FROM public.user_v1 WHERE id = $1`,
        [anonUserId],
      )
      assert.equal(anonRow.rows.length, 0)
      anonUserId = null

      // All notes belong to the real user; the anon "shared" note was
      // remapped onto the real user's pre-existing "shared" category.
      const notes = await db.query<{
        description: string
        user_id: number
        category_id: number
      }>(
        `SELECT description, user_id, category_id FROM public.user_note_v1
         WHERE user_id = $1 ORDER BY description`,
        [realUserId],
      )
      assert.deepEqual(
        notes.rows.map((row) => row.description),
        ["anon note in anon-only", "anon note in shared", "pre-existing real note"],
      )
      const mergedSharedNote = notes.rows.find(
        (row) => row.description === "anon note in shared",
      )!
      assert.equal(mergedSharedNote.category_id, realSharedCategoryId)

      // Categories deduped by label: exactly one "shared", plus "anon-only".
      const categories = await db.query<{ label: string }>(
        `SELECT label FROM public.user_note_category_v1
         WHERE user_id = $1 ORDER BY label`,
        [realUserId],
      )
      assert.deepEqual(
        categories.rows.map((row) => row.label),
        ["anon-only", "shared"],
      )

      // Tags deduped: one "important", and the tag link was remapped from the
      // anon tag id to the real user's tag id.
      const tags = await db.query<{ id: number; label: string }>(
        `SELECT id, label FROM public.user_note_tag_v1
         WHERE user_id = $1 ORDER BY label`,
        [realUserId],
      )
      assert.deepEqual(tags.rows.map((row) => row.label), ["important"])
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
        [
          `merge-test-real-${suffix}`,
          JSON.stringify({ notesApp: { resultsColumnWidth: 555 } }),
        ],
      )
      realUserId = realUser.rows[0]!.id

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
