import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { after, describe, test } from "node:test"
import type { ItemInput } from "../contracts/items-app"
import { getDb } from "../lib/db/postgres"
import {
  deleteItemForItemsApp,
  getItemsAppErrorStatus,
  ITEM_CHANGED_ERROR,
  ItemChangedError,
  parseDeleteItemRequest,
  parseUpdateItemRequest,
  updateItemForItemsApp,
} from "../services/items-app"
import { listItemsByUser } from "../sql/item"
import { CURRENT_ITEM_EMBEDDING_MODEL } from "../services/item-embeddings"
import { createWorkspaceForUser } from "../sql/workspace"

const testDbUrl = process.env.DB_ITEMS_TEST_URL ?? process.env.DB_NOTES_TEST_URL
if (testDbUrl) process.env.DB_ITEMS_URL = testDbUrl

test("an update request may name the modification time it edited", () => {
  const body = {
    userId: 1,
    itemId: 2,
    item: { workspaceId: 3, description: "x" },
  }
  assert.equal("expectedTimeModified" in parseUpdateItemRequest(body), false)
  assert.equal(
    parseUpdateItemRequest({ ...body, expectedTimeModified: "2027-01-02T03:04:05Z" })
      .expectedTimeModified,
    "2027-01-02T03:04:05.000Z",
  )
  assert.throws(() => parseUpdateItemRequest({ ...body, expectedTimeModified: "yesterday" }), {
    message: "expectedTimeModified must be a valid date.",
  })
})

/** The text is unchanged in every update, so no embedding provider is needed. */
describe("an update that names a stale version is refused (DB)", { skip: !testDbUrl }, () => {
  const userIds: number[] = []
  after(async () => {
    if (!testDbUrl) return
    await getDb().query(`DELETE FROM public.user_v1 WHERE id=ANY($1::int[])`, [userIds])
    await getDb().end()
  })

  const seed = async () => {
    const user = await getDb().query<{ id: number }>(
      `INSERT INTO public.user_v1(username,is_anonymous) VALUES($1,false) RETURNING id`,
      [`conflict-${randomUUID()}`],
    )
    const userId = user.rows[0]!.id
    userIds.push(userId)
    const workspace = await createWorkspaceForUser(userId, "personal")
    await getDb().query(
      `INSERT INTO public.workspace_item_v1
       (workspace_id,description,description_embedding,embedding_model,embedding_updated_at,time_modified)
       VALUES($1,'call the bank',$2::vector,$3,now(),'2026-01-01T00:00:00Z')`,
      [workspace.id, `[${Array(1024).fill(0.01).join(",")}]`, CURRENT_ITEM_EMBEDDING_MODEL],
    )
    const item = (await listItemsByUser(userId, workspace.id))[0]!
    const input = (values: Partial<ItemInput> = {}): ItemInput => ({
      workspaceId: workspace.id,
      categoryId: null,
      subcategoryId: null,
      statusId: null,
      tagIds: [],
      description: "call the bank",
      timeDue: null,
      timeRemind: null,
      ...values,
    })
    return { userId, item, input }
  }
  const due = "2027-01-02T03:04:05.000Z"

  test("an update from the current version is applied and returns the next one", async () => {
    const { userId, item, input } = await seed()
    const first = await updateItemForItemsApp({
      userId,
      itemId: item.id,
      item: input({ timeDue: due }),
      expectedTimeModified: item.timeModified,
    })
    assert.equal(first?.item.timeDue, due)
    assert.notEqual(first!.item.timeModified, item.timeModified)
    // The answer names the version the next edit starts from.
    const second = await updateItemForItemsApp({
      userId,
      itemId: item.id,
      item: input(),
      expectedTimeModified: first!.item.timeModified,
    })
    assert.equal(second?.item.timeDue, null)
  })

  test("an update from an older version is refused with the stored item, and writes nothing", async () => {
    const { userId, item, input } = await seed()
    const elsewhere = await updateItemForItemsApp({
      userId,
      itemId: item.id,
      item: input({ timeDue: due }),
    })
    await assert.rejects(
      updateItemForItemsApp({
        userId,
        itemId: item.id,
        item: input({ timeRemind: due }),
        expectedTimeModified: item.timeModified,
      }),
      (error: unknown) => {
        assert.ok(error instanceof ItemChangedError)
        assert.equal(error.message, ITEM_CHANGED_ERROR)
        assert.equal(getItemsAppErrorStatus(error), 409)
        assert.deepEqual(error.item, elsewhere!.item)
        return true
      },
    )
    const stored = (await listItemsByUser(userId, item.workspaceId))[0]!
    assert.equal(stored.timeDue, due)
    assert.equal(stored.timeRemind, null)
  })

  test("an update that names no version is applied over whatever is stored", async () => {
    const { userId, item, input } = await seed()
    await updateItemForItemsApp({ userId, itemId: item.id, item: input({ timeDue: due }) })
    const forced = await updateItemForItemsApp({
      userId,
      itemId: item.id,
      item: input({ timeRemind: due }),
    })
    assert.equal(forced?.item.timeDue, null)
    assert.equal(forced?.item.timeRemind, due)
  })

  test("a stale delete returns the current item and the confirmed version can be trashed", async () => {
    const { userId, item, input } = await seed()
    const changed = await updateItemForItemsApp({
      userId,
      itemId: item.id,
      item: input({ timeDue: due }),
    })
    const body = { userId, workspaceId: item.workspaceId, itemId: item.id }
    await assert.rejects(
      deleteItemForItemsApp(
        parseDeleteItemRequest({ ...body, expectedTimeModified: item.timeModified }),
      ),
      (error) => error instanceof ItemChangedError && error.item.timeDue === due,
    )
    assert.equal((await listItemsByUser(userId, item.workspaceId))[0]?.timeDue, due)
    assert.deepEqual(
      await deleteItemForItemsApp({ ...body, expectedTimeModified: changed!.item.timeModified }),
      { ok: true },
    )
    assert.deepEqual(await listItemsByUser(userId, item.workspaceId), [])
  })

  test("a deleted item is still reported as gone, not as changed", async () => {
    const { userId, item, input } = await seed()
    await getDb().query(`DELETE FROM public.workspace_item_v1 WHERE id=$1`, [item.id])
    assert.equal(
      await updateItemForItemsApp({
        userId,
        itemId: item.id,
        item: input(),
        expectedTimeModified: item.timeModified,
      }),
      null,
    )
  })
})
