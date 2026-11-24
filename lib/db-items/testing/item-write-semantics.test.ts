import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { after, describe, test } from "node:test"
import { getDb } from "../lib/db/postgres"
import { ITEM_CONTENT_REQUIRED_ERROR, ItemRequirementError } from "../contracts/item-capabilities"
import { itemCapabilityRemovals } from "../contracts/item-model"
import { CURRENT_ITEM_EMBEDDING_MODEL } from "../services/item-embeddings"
import {
  createItemForItemsApp,
  deleteItemForItemsApp,
  describeItemsAppError,
  embedItemForItemsApp,
  listStatusesForItemsApp,
  listCategoriesForItemsApp,
  parseUpdateItemRequest,
  updateItemForItemsApp,
} from "../services/items-app"
import { updateItemEmbeddingsForUser } from "../sql/item"
import { createWorkspaceForUser } from "../sql/workspace"

const testDbUrl = process.env.DB_ITEMS_TEST_URL ?? process.env.DB_NOTES_TEST_URL
if (testDbUrl) process.env.DB_ITEMS_URL = testDbUrl

test("removing a capability names the kinds lost and what refuses it", () => {
  const text = itemCapabilityRemovals().find((removal) => removal.capability === "text")!
  assert.deepEqual(text.kindsLost, ["note", "task"])
  assert.deepEqual(text.refusedWhileHolding, ["status"])
  assert.equal(text.refusedWhenLastContent, true)
  const status = itemCapabilityRemovals().find((removal) => removal.capability === "status")!
  assert.deepEqual(status.kindsLost, ["task"])
  assert.equal(status.refusedWhenLastContent, false)
})

test("a patch request keeps only the fields it names", () => {
  const request = parseUpdateItemRequest({ userId: 1, itemId: 2, item: { statusId: null } })
  assert.deepEqual(request.item, { statusId: null })
})

test("a server fault is reported without its detail", () => {
  const fault = Object.assign(new Error('relation "secret" does not exist'), { code: "42P01" })
  assert.deepEqual(describeItemsAppError(fault), {
    status: 500,
    code: "internal",
    message: "Unexpected server error.",
    internal: true,
  })
  assert.equal(describeItemsAppError(new Error("label is required.")).status, 400)
  assert.equal(
    describeItemsAppError(Object.assign(new Error("dup"), { code: "23505" })).status,
    409,
  )
})

describe("item writes (DB)", { skip: !testDbUrl }, () => {
  after(async () => {
    if (testDbUrl) await getDb().end()
  })

  const VECTOR = `[${Array(1024).fill(0.01).join(",")}]`
  const embedded = { descriptionEmbedding: VECTOR, embeddingModel: CURRENT_ITEM_EMBEDDING_MODEL }

  const seed = async () => {
    const { rows } = await getDb().query<{ id: number }>(
      `INSERT INTO public.user_v1(username,is_anonymous) VALUES($1,false) RETURNING id`,
      [`writes-${randomUUID()}`],
    )
    const userId = rows[0]!.id
    const workspace = await createWorkspaceForUser(userId, "personal")
    const one = async (table: string, extra = "", values = "") =>
      (
        await getDb().query<{ id: number }>(
          `INSERT INTO public.${table}(workspace_id,label${extra}) VALUES($1,$2${values}) RETURNING id`,
          [workspace.id, `l-${randomUUID().slice(0, 8)}`],
        )
      ).rows[0]!.id
    return {
      userId,
      workspaceId: workspace.id,
      categoryId: await one("workspace_category_v1"),
      statusId: await one("workspace_status_v1", ",position", ",99"),
      tagId: await one("workspace_tag_v1"),
      drop: () => getDb().query(`DELETE FROM public.user_v1 WHERE id=$1`, [userId]),
    }
  }

  const stored = async (itemId: number) =>
    (
      await getDb().query<{
        description: string | null
        has_embedding: boolean
        embedding_model: string | null
        time_modified: Date
      }>(
        `SELECT description,(description_embedding IS NOT NULL) has_embedding,embedding_model,time_modified
         FROM public.workspace_item_v1 WHERE id=$1`,
        [itemId],
      )
    ).rows[0]!

  const create = async (row: Awaited<ReturnType<typeof seed>>, description = "first") =>
    (
      await createItemForItemsApp({
        userId: row.userId,
        item: {
          workspaceId: row.workspaceId,
          categoryId: row.categoryId,
          subcategoryId: null,
          statusId: row.statusId,
          tagIds: [row.tagId],
          description,
          timeDue: "2027-01-03T09:00:00.000Z",
          timeRemind: null,
        },
      })
    ).item

  test("an item is saved while the embedding provider is unavailable", async () => {
    const row = await seed()
    const savedKey = process.env.JINA_API_KEY
    delete process.env.JINA_API_KEY
    try {
      const item = await create(row)
      assert.equal((await stored(item.id)).has_embedding, false)
      const updated = await updateItemForItemsApp({
        userId: row.userId,
        itemId: item.id,
        item: { description: "second" },
      })
      assert.equal(updated?.item.description, "second")
      // The provider is asked afterwards, and its failure leaves the item as saved.
      await assert.rejects(embedItemForItemsApp({ userId: row.userId, itemId: item.id }))
      assert.equal((await stored(item.id)).description, "second")
    } finally {
      if (savedKey !== undefined) process.env.JINA_API_KEY = savedKey
      await row.drop()
    }
  })

  test("a patch writes the fields it names and leaves the rest", async () => {
    const row = await seed()
    try {
      const item = await create(row)
      const cleared = await updateItemForItemsApp({
        userId: row.userId,
        itemId: item.id,
        item: { statusId: null },
      })
      assert.equal(cleared?.item.status, null)
      assert.equal(cleared?.item.description, "first")
      assert.equal(cleared?.item.category?.id, row.categoryId)
      assert.deepEqual(
        cleared?.item.tags.map((tag) => tag.id),
        [row.tagId],
      )
      assert.equal(cleared?.item.timeDue, "2027-01-03T09:00:00.000Z")
    } finally {
      await row.drop()
    }
  })

  test("a patch is judged against the item it would leave", async () => {
    const row = await seed()
    try {
      const item = await create(row)
      const clear = (patch: Parameters<typeof updateItemForItemsApp>[0]["item"]) =>
        updateItemForItemsApp({ userId: row.userId, itemId: item.id, item: patch })
      // The last content cannot go.
      await assert.rejects(clear({ description: "" }), { message: ITEM_CONTENT_REQUIRED_ERROR })
      // With a time block beside it the text is no longer the last content, but the
      // status still needs it.
      await clear({ timeStart: "2027-01-03T09:00:00.000Z" })
      await assert.rejects(clear({ description: null }), ItemRequirementError)
      const block = await clear({ description: null, statusId: null })
      assert.equal(block?.item.description, null)
      assert.equal(block?.item.timeEnd, "2027-01-03T09:00:00.000Z")
    } finally {
      await row.drop()
    }
  })

  test("changed text clears the embedding and other changes keep it", async () => {
    const row = await seed()
    try {
      const item = await create(row)
      await updateItemEmbeddingsForUser(item.id, row.userId, embedded, "first")
      await updateItemForItemsApp({ userId: row.userId, itemId: item.id, item: { tagIds: [] } })
      assert.equal((await stored(item.id)).has_embedding, true)
      await updateItemForItemsApp({
        userId: row.userId,
        itemId: item.id,
        item: { description: "second" },
      })
      const after = await stored(item.id)
      assert.equal(after.has_embedding, false)
      assert.equal(after.embedding_model, null)
    } finally {
      await row.drop()
    }
  })

  test("an embedding is not a change to the item and never lands on other text", async () => {
    const row = await seed()
    try {
      const item = await create(row)
      const before = await stored(item.id)
      assert.equal(await updateItemEmbeddingsForUser(item.id, row.userId, embedded, "first"), true)
      const after = await stored(item.id)
      assert.equal(after.has_embedding, true)
      assert.equal(after.time_modified.getTime(), before.time_modified.getTime())
      // The text moved on while the provider answered.
      assert.equal(await updateItemEmbeddingsForUser(item.id, row.userId, embedded, "old"), false)
    } finally {
      await row.drop()
    }
  })

  test("deleting the last item of a category removes the category and keeps the status", async () => {
    const row = await seed()
    try {
      const kept = await create(row, "stays")
      await updateItemForItemsApp({
        userId: row.userId,
        itemId: kept.id,
        item: { categoryId: null, statusId: null },
      })
      const item = await create(row, "goes")
      await deleteItemForItemsApp({ userId: row.userId, itemId: item.id })
      const { categories } = await listCategoriesForItemsApp(row)
      assert.equal(
        categories.some((category) => category.id === row.categoryId),
        false,
      )
      const { statuses } = await listStatusesForItemsApp(row)
      assert.equal(
        statuses.some((status) => status.id === row.statusId),
        true,
      )
    } finally {
      await row.drop()
    }
  })
})
