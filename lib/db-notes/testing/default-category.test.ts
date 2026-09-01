/**
 * A note cannot be stored without a real category, so an account with none is
 * an account that cannot save. Tags have always seeded a default; categories
 * did not, which left every new account silently unable to write a note.
 *
 * Runs only when DB_NOTES_TEST_URL is set, and connects to THAT database.
 */
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { after, describe, test } from "node:test"
import { getDb } from "../lib/db/postgres"
import { listCategoriesForNotesApp } from "../services/notes-app"

const testDbUrl = process.env.DB_NOTES_TEST_URL
const hasDb = Boolean(testDbUrl)
if (hasDb) {
  process.env.DB_NOTES_URL = testDbUrl
}

describe("default category seeding (DB)", { skip: !hasDb }, () => {
  after(async () => {
    if (hasDb) {
      await getDb().end()
    }
  })

  const createUser = async () => {
    const { rows } = await getDb().query<{ id: number }>(
      `INSERT INTO public.user_v1 (username, is_anonymous) VALUES ($1, true) RETURNING id`,
      [`default-category-${randomUUID().slice(0, 8)}`],
    )
    return rows[0]!.id
  }

  const labelsFor = async (userId: number) => {
    const { rows } = await getDb().query<{ label: string }>(
      `SELECT label FROM public.user_note_category_v1 WHERE user_id = $1 ORDER BY id`,
      [userId],
    )
    return rows.map((row) => row.label)
  }

  const cleanup = (userId: number) =>
    getDb().query(`DELETE FROM public.user_v1 WHERE id = $1`, [userId])

  test("a brand-new account is given somewhere to put its first note", async () => {
    const userId = await createUser()
    try {
      assert.deepEqual(await labelsFor(userId), [])

      const { categories } = await listCategoriesForNotesApp({ userId })

      assert.deepEqual(
        categories.map((category) => category.label),
        ["uncategorized"],
      )
    } finally {
      await cleanup(userId)
    }
  })

  test("listing twice does not accumulate duplicates", async () => {
    const userId = await createUser()
    try {
      await listCategoriesForNotesApp({ userId })
      await listCategoriesForNotesApp({ userId })

      assert.deepEqual(await labelsFor(userId), ["uncategorized"])
    } finally {
      await cleanup(userId)
    }
  })

  test("an account that already has categories is left alone", async () => {
    const userId = await createUser()
    try {
      await getDb().query(
        `INSERT INTO public.user_note_category_v1 (user_id, label) VALUES ($1, 'work')`,
        [userId],
      )

      const { categories } = await listCategoriesForNotesApp({ userId })

      // Seeding unconditionally would push an unwanted "uncategorized" into
      // every existing user's sidebar.
      assert.deepEqual(
        categories.map((category) => category.label),
        ["work"],
      )
    } finally {
      await cleanup(userId)
    }
  })
})
