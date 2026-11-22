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
  deleteItemForItemsApp,
  mergeAnonymousItemsAppSession,
  updateItemForItemsApp,
} from "../services/items-app"
import { listItemsByUser, parseItemInput, searchItemsByEmbedding } from "../sql/item"
import { listTrashedItemsByUser } from "../sql/item/trash"
import { parseUserBackup } from "../contracts/user-backup"
import { previewItemGroup } from "../sql/item-groups"
import { createStatusForWorkspace } from "../sql/status"
import { createAnonymousUser } from "../sql/user/anonymous"
import { exportUserBackup, restoreUserBackup } from "../sql/user/backup"
import { createWorkspaceForUser, listWorkspacesByUser } from "../sql/workspace"

const testDbUrl = process.env.DB_ITEMS_TEST_URL ?? process.env.DB_NOTES_TEST_URL
if (testDbUrl) process.env.DB_ITEMS_URL = testDbUrl

const due = "2027-01-02T03:04:05.000Z"

/** An item needs content, and text is only one kind: a time block is an item without
 * text. Each test runs without an embedding provider key, so a save that asked for an
 * embedding of no text would fail. */
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

  const block = { timeStart: "2027-01-03T09:00:00.000Z", timeEnd: "2027-01-03T10:30:00.000Z" }

  test("the service saves a time block without text, and it is a time item and not a note", async () => {
    const userId = await realUser()
    const workspace = await createWorkspaceForUser(userId, "personal")
    const created = await createItemForItemsApp({ userId, item: input(workspace.id, block) })
    assert.equal(created.item.description, null)
    assert.equal(created.item.timeStart, block.timeStart)
    assert.equal(created.item.timeEnd, block.timeEnd)
    assert.deepEqual(itemKinds(created.item), ["time"])
    assert.deepEqual(
      (await listItemsByUser(userId, workspace.id)).map((item) => item.id),
      [created.item.id],
    )
  })

  test("the service refuses an item that holds only a date, a status, or taxonomy", async () => {
    const userId = await realUser()
    const workspace = await createWorkspaceForUser(userId, "personal")
    const status = (await createStatusForWorkspace(userId, workspace.id, "doing"))!
    const category = await getDb().query<{ id: number }>(
      `INSERT INTO public.workspace_category_v1(workspace_id,label) VALUES($1,'work') RETURNING id`,
      [workspace.id],
    )
    for (const state of [
      { timeDue: due },
      { timeRemind: due },
      { statusId: status.id },
      { categoryId: category.rows[0]!.id },
    ])
      await assert.rejects(createItemForItemsApp({ userId, item: input(workspace.id, state) }), {
        message: ITEM_CONTENT_REQUIRED_ERROR,
      })
    assert.deepEqual(await listItemsByUser(userId, workspace.id), [])
  })

  test("a status needs text, so a time block without text takes none", async () => {
    const userId = await realUser()
    const workspace = await createWorkspaceForUser(userId, "personal")
    const status = (await createStatusForWorkspace(userId, workspace.id, "doing"))!
    await assert.rejects(
      createItemForItemsApp({
        userId,
        item: input(workspace.id, { ...block, statusId: status.id }),
      }),
      { message: "An item needs text to have a status." },
    )
    const withText = await createItemForItemsAppWithoutProvider(workspace.id, {
      ...block,
      statusId: status.id,
    })
    assert.deepEqual(itemKinds(withText), ["note", "task", "time"])
  })

  test("clearing the text of a time block keeps the item and drops its embedding", async () => {
    const userId = await realUser()
    const workspace = await createWorkspaceForUser(userId, "personal")
    const seeded = await getDb().query<{ id: number }>(
      `INSERT INTO public.workspace_item_v1
       (workspace_id,description,time_start,time_end,description_embedding,embedding_model,embedding_updated_at)
       VALUES($1,'call the bank',$2,$3,$4::vector,$5,now()) RETURNING id`,
      [
        workspace.id,
        block.timeStart,
        block.timeEnd,
        `[${Array(1024).fill(0.01).join(",")}]`,
        CURRENT_ITEM_EMBEDDING_MODEL,
      ],
    )
    const itemId = seeded.rows[0]!.id

    const updated = await updateItemForItemsApp({
      userId,
      itemId,
      item: input(workspace.id, { description: "", ...block }),
    })
    assert.equal(updated?.item.description, null)
    assert.equal(updated?.item.timeStart, block.timeStart)
    const stored = await getDb().query<{ has_embedding: boolean; embedding_model: string | null }>(
      `SELECT (description_embedding IS NOT NULL) has_embedding,embedding_model
       FROM public.workspace_item_v1 WHERE id=$1`,
      [itemId],
    )
    assert.deepEqual(stored.rows[0], { has_embedding: false, embedding_model: null })

    // Removing the time block too would leave nothing, which is refused.
    await assert.rejects(
      updateItemForItemsApp({
        userId,
        itemId,
        item: input(workspace.id, { description: "", timeStart: null, timeEnd: null }),
      }),
      { message: ITEM_CONTENT_REQUIRED_ERROR },
    )
    assert.equal((await listItemsByUser(userId, workspace.id))[0]?.timeStart, block.timeStart)
  })

  test("clearing the text of an item that holds only a date is refused, and the item is unchanged", async () => {
    const userId = await realUser()
    const workspace = await createWorkspaceForUser(userId, "personal")
    const itemId = (
      await getDb().query<{ id: number }>(
        `INSERT INTO public.workspace_item_v1(workspace_id,description,time_due)
         VALUES($1,'call the bank',$2) RETURNING id`,
        [workspace.id, due],
      )
    ).rows[0]!.id
    // A date is state, so it does not keep an item whose text is removed.
    await assert.rejects(
      updateItemForItemsApp({
        userId,
        itemId,
        item: input(workspace.id, { description: "", timeDue: due }),
      }),
      { message: ITEM_CONTENT_REQUIRED_ERROR },
    )
    const stored = (await listItemsByUser(userId, workspace.id))[0]
    assert.equal(stored?.description, "call the bank")
    assert.equal(stored?.timeDue, due)
  })

  test("text search never returns an item without text", async () => {
    const userId = await realUser()
    const workspace = await createWorkspaceForUser(userId, "personal")
    const vector = `[${[1, ...Array(1023).fill(0)].join(",")}]`
    const withText = await getDb().query<{ id: number }>(
      `INSERT INTO public.workspace_item_v1
       (workspace_id,description,description_embedding,embedding_model,embedding_updated_at)
       VALUES ($1,'with text',$2::vector,$3,now()) RETURNING id`,
      [workspace.id, vector, CURRENT_ITEM_EMBEDDING_MODEL],
    )
    await createItemForItemsApp({ userId, item: input(workspace.id, block) })
    const results = await searchItemsByEmbedding(userId, workspace.id, vector, 10)
    assert.deepEqual(
      results.map((result) => result.item.id),
      [withText.rows[0]!.id],
    )
    assert.equal((await listItemsByUser(userId, workspace.id)).length, 2)
  })

  test("a group preview counts items without text separately from notes", async () => {
    const userId = await realUser()
    const workspace = await createWorkspaceForUser(userId, "personal")
    await createItemForItemsApp({ userId, item: input(workspace.id, block) })
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

  test("backup and restore carry a time block without text", async () => {
    const sourceId = await realUser()
    const targetId = await realUser()
    const workspace = await createWorkspaceForUser(sourceId, "errands")
    await createItemForItemsApp({
      userId: sourceId,
      item: input(workspace.id, { ...block, timeDue: due }),
    })

    const backup = await exportUserBackup(sourceId)
    const exported = backup.workspaces.find((entry) => entry.label === "errands")!
    assert.deepEqual(
      exported.items.map(({ description, timeStart, timeEnd, timeDue }) => ({
        description,
        timeStart,
        timeEnd,
        timeDue,
      })),
      [{ description: null, ...block, timeDue: due }],
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
    assert.equal(restored[0]!.timeStart, block.timeStart)
    assert.equal(restored[0]!.timeEnd, block.timeEnd)
    // Restoring the same file again recognizes the time block as already present.
    assert.deepEqual(await restoreUserBackup(targetId, backup), {
      itemsImported: 0,
      itemsSkipped: 1,
    })
  })

  test("a backup written before the content rules loses what can no longer be stored", async () => {
    const targetId = await realUser()
    await createWorkspaceForUser(targetId, "personal")
    const backup = await exportUserBackup(targetId)
    const workspace = backup.workspaces[0]!
    const stamp = { timeCreated: due, timeModified: due }
    workspace.statuses.push({ label: "doing", position: 9, ...stamp })
    const base = { category: null, subcategory: null, tags: [], timeRemind: null, ...stamp }
    workspace.items.push(
      { ...base, description: null, status: null, timeDue: due },
      { ...base, description: null, status: "doing", timeDue: null },
      { ...base, description: null, status: "doing", timeDue: null, ...block },
      { ...base, description: "kept", status: "doing", timeDue: null },
    )
    assert.deepEqual(await restoreUserBackup(targetId, { ...backup, version: 3 }), {
      itemsImported: 2,
      itemsSkipped: 0,
    })
    const restored = await listItemsByUser(targetId, (await listWorkspacesByUser(targetId))[0]!.id)
    assert.deepEqual(
      restored
        .map((item) => [item.description, item.status?.label ?? null, item.timeStart])
        .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
      [
        ["kept", "doing", null],
        // The time block had a status and no text, so it comes back without the status.
        [null, null, block.timeStart],
      ],
    )
  })

  test("a version 4 backup that breaks the content rules is refused", async () => {
    const userId = await realUser()
    await createWorkspaceForUser(userId, "personal")
    const backup = await exportUserBackup(userId)
    const stamp = { timeCreated: due, timeModified: due }
    const base = { category: null, subcategory: null, tags: [], timeRemind: null, ...stamp }
    backup.workspaces[0]!.items.push({ ...base, description: null, status: null, timeDue: due })
    assert.throws(() => parseUserBackup(JSON.parse(JSON.stringify(backup))), /holds no content/)
    assert.doesNotThrow(() =>
      parseUserBackup({ ...JSON.parse(JSON.stringify(backup)), version: 3 }),
    )
  })

  test("the trash lists the time block of a deleted item", async () => {
    const userId = await realUser()
    const workspace = await createWorkspaceForUser(userId, "personal")
    const { item } = await createItemForItemsApp({
      userId,
      item: input(workspace.id, block),
    })
    await deleteItemForItemsApp({ userId, itemId: item.id })
    const [entry] = await listTrashedItemsByUser(userId)
    assert.equal(entry!.description, null)
    assert.equal(entry!.timeStart, block.timeStart)
    assert.equal(entry!.timeEnd, block.timeEnd)
  })

  test("signing in to an existing account keeps an anonymous time block", async () => {
    const realUserId = await realUser()
    const anonymous = await createAnonymousUser()
    userIds.push(anonymous.id)
    const anonymousWorkspace = (await listWorkspacesByUser(anonymous.id))[0]!
    await createItemForItemsApp({
      userId: anonymous.id,
      item: input(anonymousWorkspace.id, block),
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
    assert.equal(merged[0]!.timeStart, block.timeStart)
  })

  /** An item with text written directly, so no embedding is asked for. */
  const createItemForItemsAppWithoutProvider = async (
    workspaceId: number,
    values: { timeStart: string; timeEnd: string; statusId: number },
  ) => {
    const { rows } = await getDb().query<{ id: number }>(
      `INSERT INTO public.workspace_item_v1(workspace_id,description,time_start,time_end,status_id)
       VALUES($1,'standup',$2,$3,$4) RETURNING id`,
      [workspaceId, values.timeStart, values.timeEnd, values.statusId],
    )
    const items = await getDb().query<{ workspace_id: number }>(
      `SELECT workspace_id FROM public.workspace_item_v1 WHERE id=$1`,
      [rows[0]!.id],
    )
    const owner = await getDb().query<{ user_id: number }>(
      `SELECT user_id FROM public.user_workspace_v1 WHERE id=$1`,
      [items.rows[0]!.workspace_id],
    )
    return (await listItemsByUser(owner.rows[0]!.user_id, workspaceId)).find(
      (item) => item.id === rows[0]!.id,
    )!
  }
})
