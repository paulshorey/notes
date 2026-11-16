import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { after, describe, test } from "node:test"
import { ITEM_CONTENT_REQUIRED_ERROR } from "../contracts/item-capabilities"
import { itemKinds } from "../contracts/item-kinds"
import type { ItemInput } from "../contracts/items-app"
import { getDb } from "../lib/db/postgres"
import { CURRENT_ITEM_EMBEDDING_MODEL } from "../services/item-embeddings"
import {
  createItemForItemsApp,
  mergeAnonymousItemsAppSession,
  updateItemForItemsApp,
} from "../services/items-app"
import { listItemsByUser, searchItemsByEmbedding } from "../sql/item"
import { previewItemGroup } from "../sql/item-groups"
import { createStatusForWorkspace } from "../sql/status"
import { createAnonymousUser } from "../sql/user/anonymous"
import { exportUserBackup, restoreUserBackup } from "../sql/user/backup"
import { createWorkspaceForUser, listWorkspacesByUser } from "../sql/workspace"

const testDbUrl = process.env.DB_ITEMS_TEST_URL ?? process.env.DB_NOTES_TEST_URL
if (testDbUrl) process.env.DB_ITEMS_URL = testDbUrl

const due = "2027-01-02T03:04:05.000Z"

/** No layer below the Notes screen may require text. Each test runs without an
 * embedding provider key, so a textless save that asked for an embedding would fail. */
describe("items without text (DB)", { skip: !testDbUrl }, () => {
  const userIds: number[] = []
  const savedKey = process.env.JINA_API_KEY
  delete process.env.JINA_API_KEY

  after(async () => {
    if (savedKey !== undefined) process.env.JINA_API_KEY = savedKey
    if (!testDbUrl) return
    await getDb().query(`DELETE FROM public.user_v1 WHERE id=ANY($1::int[])`, [userIds])
    await getDb().end()
  })

  const realUser = async () => {
    const { rows } = await getDb().query<{ id: number }>(
      `INSERT INTO public.user_v1(username,is_anonymous) VALUES($1,false) RETURNING id`,
      [`textless-${randomUUID()}`],
    )
    userIds.push(rows[0]!.id)
    return rows[0]!.id
  }

  const input = (workspaceId: number, values: Partial<ItemInput> = {}): ItemInput => ({
    workspaceId,
    categoryId: null,
    subcategoryId: null,
    statusId: null,
    tagIds: [],
    description: null,
    timeDue: null,
    timeRemind: null,
    ...values,
  })

  test("the service saves an item that holds only a date or only a status", async () => {
    const userId = await realUser()
    const workspace = await createWorkspaceForUser(userId, "personal")
    const status = (await createStatusForWorkspace(userId, workspace.id, "doing"))!

    const dated = await createItemForItemsApp({
      userId,
      item: input(workspace.id, { timeDue: due }),
    })
    assert.equal(dated.item.description, null)
    assert.equal(dated.item.timeDue, due)
    assert.deepEqual(itemKinds(dated.item), ["task"])

    const reminded = await createItemForItemsApp({
      userId,
      item: input(workspace.id, { timeRemind: due }),
    })
    assert.equal(reminded.item.timeRemind, due)

    const staged = await createItemForItemsApp({
      userId,
      item: input(workspace.id, { statusId: status.id }),
    })
    assert.equal(staged.item.description, null)
    assert.equal(staged.item.status?.id, status.id)
    assert.deepEqual(itemKinds(staged.item), ["task"])

    const listed = await listItemsByUser(userId, workspace.id)
    assert.deepEqual(listed.map((item) => item.id).sort(), [
      dated.item.id,
      reminded.item.id,
      staged.item.id,
    ])
  })

  test("the service still refuses an item that holds only taxonomy", async () => {
    const userId = await realUser()
    const workspace = await createWorkspaceForUser(userId, "personal")
    const category = await getDb().query<{ id: number }>(
      `INSERT INTO public.workspace_category_v1(workspace_id,label) VALUES($1,'work') RETURNING id`,
      [workspace.id],
    )
    await assert.rejects(
      createItemForItemsApp({
        userId,
        item: input(workspace.id, { categoryId: category.rows[0]!.id }),
      }),
      { message: ITEM_CONTENT_REQUIRED_ERROR },
    )
    assert.deepEqual(await listItemsByUser(userId, workspace.id), [])
  })

  test("clearing the text of an item that holds a date keeps the item and drops its embedding", async () => {
    const userId = await realUser()
    const workspace = await createWorkspaceForUser(userId, "personal")
    const seeded = await getDb().query<{ id: number }>(
      `INSERT INTO public.workspace_item_v1
       (workspace_id,description,time_due,description_embedding,embedding_model,embedding_updated_at)
       VALUES($1,'call the bank',$2,$3::vector,$4,now()) RETURNING id`,
      [workspace.id, due, `[${Array(1024).fill(0.01).join(",")}]`, CURRENT_ITEM_EMBEDDING_MODEL],
    )
    const itemId = seeded.rows[0]!.id

    const updated = await updateItemForItemsApp({
      userId,
      itemId,
      item: input(workspace.id, { description: "", timeDue: due }),
    })
    assert.equal(updated?.item.description, null)
    assert.equal(updated?.item.timeDue, due)
    assert.deepEqual(itemKinds(updated!.item), ["task"])

    const stored = await getDb().query<{ has_embedding: boolean; embedding_model: string | null }>(
      `SELECT (description_embedding IS NOT NULL) has_embedding,embedding_model
       FROM public.workspace_item_v1 WHERE id=$1`,
      [itemId],
    )
    assert.deepEqual(stored.rows[0], { has_embedding: false, embedding_model: null })

    // Removing the last capability is refused, so the item cannot become empty by an edit.
    await assert.rejects(updateItemForItemsApp({ userId, itemId, item: input(workspace.id) }), {
      message: ITEM_CONTENT_REQUIRED_ERROR,
    })
    assert.equal((await listItemsByUser(userId, workspace.id))[0]?.timeDue, due)
  })

  test("text search never returns an item without text", async () => {
    const userId = await realUser()
    const workspace = await createWorkspaceForUser(userId, "personal")
    const vector = `[${[1, ...Array(1023).fill(0)].join(",")}]`
    const rows = await getDb().query<{ id: number; description: string | null }>(
      `INSERT INTO public.workspace_item_v1
       (workspace_id,description,time_due,description_embedding,embedding_model,embedding_updated_at)
       VALUES ($1,'with text',NULL,$2::vector,$3,now()),
              ($1,NULL,$4,NULL,NULL,NULL),
              ($1,'   ',$4,NULL,NULL,NULL)
       RETURNING id,description`,
      [workspace.id, vector, CURRENT_ITEM_EMBEDDING_MODEL, due],
    )
    const results = await searchItemsByEmbedding(userId, workspace.id, vector, 10)
    assert.deepEqual(
      results.map((result) => result.item.id),
      [rows.rows.find((row) => row.description === "with text")!.id],
    )
    assert.equal((await listItemsByUser(userId, workspace.id)).length, 3)
  })

  test("a group preview counts items without text separately from notes", async () => {
    const userId = await realUser()
    const workspace = await createWorkspaceForUser(userId, "personal")
    await createItemForItemsApp({ userId, item: input(workspace.id, { timeDue: due }) })
    await getDb().query(
      `INSERT INTO public.workspace_item_v1(workspace_id,description) VALUES($1,'a note')`,
      [workspace.id],
    )
    const preview = await previewItemGroup(userId, {
      workspaceId: workspace.id,
      target: { kind: "uncategorized" },
    })
    assert.equal(preview.itemCount, 2)
    assert.equal(preview.textItemCount, 1)
  })

  test("backup and restore carry an item without text", async () => {
    const sourceId = await realUser()
    const targetId = await realUser()
    const workspace = await createWorkspaceForUser(sourceId, "errands")
    const status = (await createStatusForWorkspace(sourceId, workspace.id, "doing"))!
    await createItemForItemsApp({
      userId: sourceId,
      item: input(workspace.id, { timeDue: due, statusId: status.id }),
    })

    const backup = await exportUserBackup(sourceId)
    const exported = backup.workspaces.find((entry) => entry.label === "errands")!
    assert.deepEqual(
      exported.items.map(({ description, timeDue, status: label }) => ({
        description,
        timeDue,
        status: label,
      })),
      [{ description: null, timeDue: due, status: "doing" }],
    )

    assert.deepEqual(await restoreUserBackup(targetId, backup), {
      itemsImported: 1,
      itemsSkipped: 0,
    })
    const restoredWorkspace = (await listWorkspacesByUser(targetId)).find(
      (entry) => entry.label === "errands",
    )!
    const restored = await listItemsByUser(targetId, restoredWorkspace.id)
    assert.equal(restored.length, 1)
    assert.equal(restored[0]!.description, null)
    assert.equal(restored[0]!.timeDue, due)
    assert.equal(restored[0]!.status?.label, "doing")
    // Restoring the same file again recognizes the textless item as already present.
    assert.deepEqual(await restoreUserBackup(targetId, backup), {
      itemsImported: 0,
      itemsSkipped: 1,
    })
  })

  test("signing in to an existing account keeps an anonymous item without text", async () => {
    const realUserId = await realUser()
    const anonymous = await createAnonymousUser()
    userIds.push(anonymous.id)
    const anonymousWorkspace = (await listWorkspacesByUser(anonymous.id))[0]!
    await createItemForItemsApp({
      userId: anonymous.id,
      item: input(anonymousWorkspace.id, { timeRemind: due }),
    })

    await mergeAnonymousItemsAppSession({ anonUserId: anonymous.id, realUserId })

    const merged = (
      await Promise.all(
        (await listWorkspacesByUser(realUserId)).map((workspace) =>
          listItemsByUser(realUserId, workspace.id),
        ),
      )
    ).flat()
    assert.equal(merged.length, 1)
    assert.equal(merged[0]!.description, null)
    assert.equal(merged[0]!.timeRemind, due)
  })
})
