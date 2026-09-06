/**
 * A note cannot be stored without a real group, so an account without a
 * complete Epic > Category > Group chain is an account that cannot save.
 *
 * This is not hypothetical. The open-note ring was demoed across several
 * sessions while `user_note_v1` stayed empty, because a new account had no
 * category, `isSaveableForm` was false, and every autosave returned before
 * reaching the network. Three levels give three ways back into that state, and
 * the failure looks exactly like success because the local snapshot reproduces
 * the notes on reload.
 *
 * The tier vocabulary matters for the same reason: `user_taxonomy_v1` carries a
 * composite foreign key into `user_taxonomy_level_v1`, so a user with no
 * vocabulary cannot hold any taxonomy row at all.
 *
 * Runs only when DB_NOTES_TEST_URL is set, and connects to THAT database.
 */
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { after, describe, test } from "node:test"
import { getDb } from "../lib/db/postgres"
import { listTaxonomyForNotesApp } from "../services/notes-app"

const testDbUrl = process.env.DB_NOTES_TEST_URL
const hasDb = Boolean(testDbUrl)
if (hasDb) {
  process.env.DB_NOTES_URL = testDbUrl
}

describe("default taxonomy seeding (DB)", { skip: !hasDb }, () => {
  after(async () => {
    if (hasDb) {
      await getDb().end()
    }
  })

  const createUser = async () => {
    const { rows } = await getDb().query<{ id: number }>(
      `INSERT INTO public.user_v1 (username, is_anonymous) VALUES ($1, true) RETURNING id`,
      [`default-taxonomy-${randomUUID().slice(0, 8)}`],
    )
    return rows[0]!.id
  }

  const seedLevels = (userId: number) =>
    getDb().query(
      `INSERT INTO public.user_taxonomy_level_v1 (user_id, level, label)
       SELECT $1, v.level, v.label
       FROM (VALUES (1,'Epic'),(2,'Category'),(3,'Group'),(4,'Note')) AS v(level, label)
       ON CONFLICT DO NOTHING`,
      [userId],
    )

  /** Strip the tier rows the migration seeds, to model an unseeded account. */
  const stripSeed = async (userId: number) => {
    await getDb().query(`DELETE FROM public.user_taxonomy_v1 WHERE user_id = $1`, [userId])
    await getDb().query(`DELETE FROM public.user_taxonomy_level_v1 WHERE user_id = $1`, [
      userId,
    ])
  }

  const rowsFor = async (userId: number) => {
    const { rows } = await getDb().query<{ level: number; label: string }>(
      `SELECT level, label FROM public.user_taxonomy_v1 WHERE user_id = $1 ORDER BY level, id`,
      [userId],
    )
    return rows.map((row) => ({ level: Number(row.level), label: row.label }))
  }

  const cleanup = (userId: number) =>
    getDb().query(`DELETE FROM public.user_v1 WHERE id = $1`, [userId])

  test("a brand-new account is given somewhere to put its first note", async () => {
    const userId = await createUser()
    try {
      await stripSeed(userId)
      assert.deepEqual(await rowsFor(userId), [])

      const { taxonomy, levels } = await listTaxonomyForNotesApp({ userId })

      assert.deepEqual(
        levels.map((level) => [level.level, level.label]),
        [
          [1, "Epic"],
          [2, "Category"],
          [3, "Group"],
          [4, "Note"],
        ],
      )
      assert.deepEqual(
        taxonomy.map((row) => [row.level, row.label]),
        [
          [1, "all"],
          [2, "uncategorized"],
          [3, "ungrouped"],
        ],
      )

      // The chain has to actually be linked, or a note still has nowhere to go.
      const epic = taxonomy.find((row) => row.level === 1)!
      const category = taxonomy.find((row) => row.level === 2)!
      const group = taxonomy.find((row) => row.level === 3)!
      assert.equal(epic.parentId, null)
      assert.equal(category.parentId, epic.id)
      assert.equal(group.parentId, category.id)
    } finally {
      await cleanup(userId)
    }
  })

  test("legacy uncategorized epic and group labels rename to all and ungrouped", async () => {
    const userId = await createUser()
    try {
      await seedLevels(userId)
      const { rows: epicRows } = await getDb().query<{ id: number }>(
        `INSERT INTO public.user_taxonomy_v1 (user_id, level, parent_id, label)
         VALUES ($1, 1, NULL, 'uncategorized') RETURNING id`,
        [userId],
      )
      const { rows: categoryRows } = await getDb().query<{ id: number }>(
        `INSERT INTO public.user_taxonomy_v1 (user_id, level, parent_id, label)
         VALUES ($1, 2, $2, 'uncategorized') RETURNING id`,
        [userId, epicRows[0]!.id],
      )
      await getDb().query(
        `INSERT INTO public.user_taxonomy_v1 (user_id, level, parent_id, label)
         VALUES ($1, 3, $2, 'uncategorized')`,
        [userId, categoryRows[0]!.id],
      )

      await getDb().query(
        `UPDATE public.user_taxonomy_v1 AS src
         SET label = 'all'
         WHERE src.user_id = $1
           AND src.level = 1
           AND src.label = 'uncategorized'
           AND NOT EXISTS (
             SELECT 1 FROM public.user_taxonomy_v1 AS sibling
             WHERE sibling.user_id = src.user_id
               AND sibling.level = 1
               AND sibling.parent_id IS NOT DISTINCT FROM src.parent_id
               AND sibling.id <> src.id
               AND sibling.label = 'all'
           )`,
        [userId],
      )
      await getDb().query(
        `UPDATE public.user_taxonomy_v1 AS src
         SET label = 'ungrouped'
         WHERE src.user_id = $1
           AND src.level = 3
           AND src.label = 'uncategorized'
           AND NOT EXISTS (
             SELECT 1 FROM public.user_taxonomy_v1 AS sibling
             WHERE sibling.user_id = src.user_id
               AND sibling.level = 3
               AND sibling.parent_id IS NOT DISTINCT FROM src.parent_id
               AND sibling.id <> src.id
               AND sibling.label = 'ungrouped'
           )`,
        [userId],
      )

      assert.deepEqual(await rowsFor(userId), [
        { level: 1, label: "all" },
        { level: 2, label: "uncategorized" },
        { level: 3, label: "ungrouped" },
      ])
    } finally {
      await cleanup(userId)
    }
  })

  test("rename skips when a sibling already owns the target label", async () => {
    const userId = await createUser()
    try {
      await seedLevels(userId)
      await getDb().query(
        `INSERT INTO public.user_taxonomy_v1 (user_id, level, parent_id, label)
         VALUES ($1, 1, NULL, 'uncategorized'), ($1, 1, NULL, 'all')`,
        [userId],
      )
      const { rows: categoryRows } = await getDb().query<{ id: number }>(
        `INSERT INTO public.user_taxonomy_v1 (user_id, level, parent_id, label)
         VALUES ($1, 2, (SELECT id FROM public.user_taxonomy_v1 WHERE user_id = $1 AND level = 1 AND label = 'uncategorized'), 'uncategorized')
         RETURNING id`,
        [userId],
      )
      await getDb().query(
        `INSERT INTO public.user_taxonomy_v1 (user_id, level, parent_id, label)
         VALUES ($1, 3, $2, 'uncategorized'), ($1, 3, $2, 'ungrouped')`,
        [userId, categoryRows[0]!.id],
      )

      await getDb().query(
        `UPDATE public.user_taxonomy_v1 AS src
         SET label = 'all'
         WHERE src.user_id = $1
           AND src.level = 1
           AND src.label = 'uncategorized'
           AND NOT EXISTS (
             SELECT 1 FROM public.user_taxonomy_v1 AS sibling
             WHERE sibling.user_id = src.user_id
               AND sibling.level = 1
               AND sibling.parent_id IS NOT DISTINCT FROM src.parent_id
               AND sibling.id <> src.id
               AND sibling.label = 'all'
           )`,
        [userId],
      )
      await getDb().query(
        `UPDATE public.user_taxonomy_v1 AS src
         SET label = 'ungrouped'
         WHERE src.user_id = $1
           AND src.level = 3
           AND src.label = 'uncategorized'
           AND NOT EXISTS (
             SELECT 1 FROM public.user_taxonomy_v1 AS sibling
             WHERE sibling.user_id = src.user_id
               AND sibling.level = 3
               AND sibling.parent_id IS NOT DISTINCT FROM src.parent_id
               AND sibling.id <> src.id
               AND sibling.label = 'ungrouped'
           )`,
        [userId],
      )

      const labels = await getDb().query<{ level: number; label: string }>(
        `SELECT level, label FROM public.user_taxonomy_v1 WHERE user_id = $1 ORDER BY level, label`,
        [userId],
      )
      assert.deepEqual(
        labels.rows.map((row) => [Number(row.level), row.label]),
        [
          [1, "all"],
          [1, "uncategorized"],
          [2, "uncategorized"],
          [3, "uncategorized"],
          [3, "ungrouped"],
        ],
      )
    } finally {
      await cleanup(userId)
    }
  })

  test("listing twice does not accumulate duplicates", async () => {
    const userId = await createUser()
    try {
      await stripSeed(userId)
      await listTaxonomyForNotesApp({ userId })
      const { taxonomy } = await listTaxonomyForNotesApp({ userId })

      assert.equal(taxonomy.length, 3)
    } finally {
      await cleanup(userId)
    }
  })

  test("an account that already has a taxonomy is left alone", async () => {
    const userId = await createUser()
    try {
      await seedLevels(userId)

      // Seeding unconditionally would push an unwanted "all" epic into
      // every existing user's sidebar.
      const { rows: epicRows } = await getDb().query<{ id: number }>(
        `INSERT INTO public.user_taxonomy_v1 (user_id, level, parent_id, label)
         VALUES ($1, 1, NULL, 'planning') RETURNING id`,
        [userId],
      )
      const { rows: categoryRows } = await getDb().query<{ id: number }>(
        `INSERT INTO public.user_taxonomy_v1 (user_id, level, parent_id, label)
         VALUES ($1, 2, $2, 'work') RETURNING id`,
        [userId, epicRows[0]!.id],
      )
      await getDb().query(
        `INSERT INTO public.user_taxonomy_v1 (user_id, level, parent_id, label)
         VALUES ($1, 3, $2, 'inbox')`,
        [userId, categoryRows[0]!.id],
      )

      const { taxonomy } = await listTaxonomyForNotesApp({ userId })

      assert.deepEqual(
        taxonomy.map((row) => row.label).sort(),
        ["inbox", "planning", "work"],
      )
    } finally {
      await cleanup(userId)
    }
  })

  test("a user with no tier vocabulary gets one, since taxonomy rows require it", async () => {
    const userId = await createUser()
    try {
      await stripSeed(userId)

      // Without the vocabulary the composite level FK rejects every insert, so
      // this is what stands between a fresh account and a working editor.
      await assert.rejects(
        getDb().query(
          `INSERT INTO public.user_taxonomy_v1 (user_id, level, parent_id, label)
           VALUES ($1, 1, NULL, 'nope')`,
          [userId],
        ),
        /user_taxonomy_v1_level_fkey/,
      )

      const { levels } = await listTaxonomyForNotesApp({ userId })
      assert.equal(levels.length, 4)
    } finally {
      await cleanup(userId)
    }
  })
})
