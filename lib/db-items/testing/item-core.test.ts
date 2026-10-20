import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { after, describe, test } from "node:test"
import { isTextItem } from "../contracts/item-content"
import { parseItemInput, createItemForUser, listItemsByUser } from "../sql/item"
import { createWorkspaceForUser } from "../sql/workspace"
import { getDb } from "../lib/db/postgres"
import { backupFixture } from "./user-backup-fixture"
import { parseUserBackup } from "../contracts/user-backup"

test("old note backups normalize into the item contract without changing content", () => {
  const current = backupFixture()
  const legacy = {
    ...current,
    version: 1,
    workspaces: current.workspaces.map(({ items, ...workspace }) => ({
      ...workspace,
      notes: items,
    })),
  }
  assert.deepEqual(parseUserBackup(legacy), current)
})

const testDbUrl = process.env.DB_ITEMS_TEST_URL ?? process.env.DB_NOTES_TEST_URL
if (testDbUrl) process.env.DB_ITEMS_URL = testDbUrl
describe("generic item persistence (DB)", { skip: !testDbUrl }, () => {
  after(async () => {
    await getDb().end()
  })
  test("an item can carry a date without text while the note client selects only text content", async () => {
    const userId = (
      await getDb().query<{ id: number }>(
        "INSERT INTO public.user_v1(username,is_anonymous) VALUES($1,true) RETURNING id",
        [`item-core-${randomUUID()}`],
      )
    ).rows[0]!.id
    try {
      const workspace = await createWorkspaceForUser(userId, "personal")
      const input = parseItemInput({ workspaceId: workspace.id, timeDue: "2027-01-02T03:04:05Z" })
      assert.equal(input.description, null)
      const item = await createItemForUser(userId, input, {
        descriptionEmbedding: null,
        embeddingModel: null,
      })
      const loaded = (await listItemsByUser(userId, workspace.id)).find(
        (row) => row.id === item.id,
      )!
      assert.equal(loaded.description, null)
      assert.equal(loaded.timeDue, "2027-01-02T03:04:05.000Z")
      assert.equal(isTextItem(loaded), false)
      assert.equal(isTextItem({ ...loaded, description: "A note" }), true)
    } finally {
      await getDb().query("DELETE FROM public.user_v1 WHERE id=$1", [userId])
    }
  })
})
