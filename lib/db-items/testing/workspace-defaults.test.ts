import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { after, describe, test } from "node:test"
import { getDb } from "../lib/db/postgres"
import {
  listCategoriesForItemsApp,
  listStatusesForItemsApp,
  listTagsForItemsApp,
  listWorkspacesForItemsApp,
} from "../services/items-app"

const testDbUrl = process.env.DB_ITEMS_TEST_URL ?? process.env.DB_NOTES_TEST_URL
if (testDbUrl) process.env.DB_ITEMS_URL = testDbUrl

describe("default workspace vocabulary seeding (DB)", { skip: !testDbUrl }, () => {
  after(async () => {
    if (testDbUrl) await getDb().end()
  })

  test("a user receives one workspace without categories, with status and tag defaults", async () => {
    const { rows } = await getDb().query<{ id: number }>(
      `INSERT INTO public.user_v1(username,is_anonymous) VALUES($1,true) RETURNING id`,
      [`defaults-${randomUUID()}`],
    )
    const userId = rows[0]!.id
    try {
      await listWorkspacesForItemsApp({ userId })
      const { workspaces } = await listWorkspacesForItemsApp({ userId })
      assert.deepEqual(
        workspaces.map((workspace) => workspace.label),
        ["personal"],
      )
      const workspaceId = workspaces[0]!.id
      assert.deepEqual(
        (await listCategoriesForItemsApp({ userId, workspaceId })).categories.map(
          (item) => item.label,
        ),
        [],
      )
      assert.deepEqual(
        (await listStatusesForItemsApp({ userId, workspaceId })).statuses.map((item) => item.label),
        ["backlog"],
      )
      assert.deepEqual(
        (await listTagsForItemsApp({ userId, workspaceId })).tags.map((item) => item.label),
        ["important"],
      )
    } finally {
      await getDb().query(`DELETE FROM public.user_v1 WHERE id=$1`, [userId])
    }
  })
})
