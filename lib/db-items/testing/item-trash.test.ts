import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { after, describe, test } from "node:test"
import type { ItemInput } from "../contracts/items-app"
import { getDb } from "../lib/db/postgres"
import {
  createItemForItemsApp,
  deleteItemForItemsApp,
  listTrashForItemsApp,
  mergeAnonymousItemsAppSession,
  purgeTrashForItemsApp,
  restoreTrashedItemForItemsApp,
} from "../services/items-app"
import { listItemsByUser, TRASH_RETENTION_DAYS } from "../sql/item"
import { executeItemGroupAction, previewItemGroup } from "../sql/item-groups"
import { createStatusForWorkspace } from "../sql/status"
import { createAnonymousUser } from "../sql/user/anonymous"
import { exportUserBackup } from "../sql/user/backup"
import { createWorkspaceForUser, listWorkspacesByUser } from "../sql/workspace"

const testDbUrl = process.env.DB_ITEMS_TEST_URL ?? process.env.DB_NOTES_TEST_URL
if (testDbUrl) process.env.DB_ITEMS_URL = testDbUrl

const due = "2027-01-02T03:04:05.000Z"

/** Each test runs without an embedding provider key, as a restore must not need one. */
describe("the trash keeps deleted items (DB)", { skip: !testDbUrl }, () => {
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
      [`trash-${randomUUID()}`],
    )
    userIds.push(rows[0]!.id)
    return rows[0]!.id
  }

  /** A stored item with every part filled, written directly so no embedding is asked for. */
  const seed = async (userId: number, label = "personal") => {
    const workspace = await createWorkspaceForUser(userId, label)
    const status = (await createStatusForWorkspace(userId, workspace.id, "doing"))!
    const vocabulary = await getDb().query<{ category: number; subcategory: number; tag: number }>(
      `WITH c AS (INSERT INTO public.workspace_category_v1(workspace_id,label) VALUES($1,'work') RETURNING id),
            sc AS (INSERT INTO public.workspace_subcategory_v1(category_id,label) SELECT id,'ideas' FROM c RETURNING id),
            t AS (INSERT INTO public.workspace_tag_v1(workspace_id,label) VALUES($1,'urgent') RETURNING id)
       SELECT c.id category,sc.id subcategory,t.id tag FROM c,sc,t`,
      [workspace.id],
    )
    const ids = vocabulary.rows[0]!
    const item = await getDb().query<{ id: number; uid: string }>(
      `INSERT INTO public.workspace_item_v1
       (workspace_id,description,time_due,status_id,category_id,subcategory_id,time_created,time_modified)
       VALUES($1,'call the bank',$2,$3,$4,$5,'2026-05-01T00:00:00Z','2026-05-02T00:00:00Z')
       RETURNING id,uid`,
      [workspace.id, due, status.id, ids.category, ids.subcategory],
    )
    await getDb().query(
      `INSERT INTO public.item_tag_link_v1(item_id,tag_id,workspace_id) VALUES($1,$2,$3)`,
      [item.rows[0]!.id, ids.tag, workspace.id],
    )
    return { workspaceId: workspace.id, statusId: status.id, ...ids, item: item.rows[0]! }
  }

  test("a deleted item leaves the workspace and is listed in its trash", async () => {
    const userId = await realUser()
    const s = await seed(userId)

    assert.deepEqual(
      await deleteItemForItemsApp({ userId, itemId: s.item.id, workspaceId: s.workspaceId }),
      { ok: true },
    )
    assert.deepEqual(await listItemsByUser(userId, s.workspaceId), [])

    const trash = await listTrashForItemsApp({ userId })
    assert.equal(trash.retentionDays, TRASH_RETENTION_DAYS)
    assert.equal(trash.items.length, 1)
    const { id, timeDeleted, ...kept } = trash.items[0]!
    assert.ok(id > 0)
    assert.ok(Date.now() - new Date(timeDeleted).getTime() < 60_000)
    assert.deepEqual(
      { ...kept, timeDue: new Date(kept.timeDue!).toISOString() },
      {
        workspaceLabel: "personal",
        description: "call the bank",
        category: "work",
        subcategory: "ideas",
        status: "doing",
        tags: ["urgent"],
        timeStart: null,
        timeEnd: null,
        entryDate: null,
        timeDue: due,
        timeRemind: null,
      },
    )
    // Trash is not content: a backup carries no deleted item.
    const backup = await exportUserBackup(userId)
    assert.deepEqual(
      backup.workspaces.flatMap((workspace) => workspace.items),
      [],
    )
  })

  test("restoring puts the item back with its uid, filing, status, tags, and dates", async () => {
    const userId = await realUser()
    const s = await seed(userId)
    const kept = await insertItem(s.workspaceId, "stays")
    await deleteItemForItemsApp({ userId, itemId: s.item.id })
    const trashId = (await listTrashForItemsApp({ userId })).items[0]!.id

    const restored = await restoreTrashedItemForItemsApp({ userId, trashId })
    assert.ok(restored)
    assert.equal(restored.item.workspaceId, s.workspaceId)
    assert.equal(restored.item.uid, s.item.uid)
    assert.equal(restored.item.description, "call the bank")
    assert.equal(restored.item.category?.label, "work")
    assert.equal(restored.item.subcategory?.label, "ideas")
    assert.equal(restored.item.status?.label, "doing")
    assert.deepEqual(
      restored.item.tags.map((tag) => tag.label),
      ["urgent"],
    )
    assert.equal(restored.item.timeDue, due)
    assert.equal(restored.item.timeCreated, "2026-05-01T00:00:00.000Z")
    assert.equal(restored.item.timeModified, "2026-05-02T00:00:00.000Z")

    assert.deepEqual((await listTrashForItemsApp({ userId })).items, [])
    assert.deepEqual((await listItemsByUser(userId, s.workspaceId)).map((item) => item.id).sort(), [
      kept,
      restored.item.id,
    ])
    // The entry is gone, so restoring it again finds nothing and writes nothing.
    assert.equal(await restoreTrashedItemForItemsApp({ userId, trashId }), null)
    assert.equal((await listItemsByUser(userId, s.workspaceId)).length, 2)
  })

  test("restoring the last item of a workspace brings its vocabulary back", async () => {
    const userId = await realUser()
    const s = await seed(userId, "errands")
    await deleteItemForItemsApp({ userId, itemId: s.item.id })
    // Deleting the last item removed the vocabulary only it used. The workspace stays.
    assert.equal(
      (await listWorkspacesByUser(userId)).some((workspace) => workspace.label === "errands"),
      true,
    )

    const trash = (await listTrashForItemsApp({ userId })).items
    assert.deepEqual(
      trash.map((item) => [item.workspaceLabel, item.description]),
      [["errands", "call the bank"]],
    )
    const restored = await restoreTrashedItemForItemsApp({ userId, trashId: trash[0]!.id })
    assert.ok(restored)
    const workspace = (await listWorkspacesByUser(userId)).find(
      (entry) => entry.label === "errands",
    )!
    assert.equal(restored.item.workspaceId, workspace.id)
    assert.equal(restored.item.uid, s.item.uid)
    assert.equal(restored.item.category?.label, "work")
    assert.equal(restored.item.subcategory?.label, "ideas")
    assert.equal(restored.item.status?.label, "doing")
    assert.deepEqual(
      restored.item.tags.map((tag) => tag.label),
      ["urgent"],
    )
  })

  test("a restore takes a new uid when its own was taken meanwhile", async () => {
    const userId = await realUser()
    const s = await seed(userId)
    await insertItem(s.workspaceId, "stays")
    await deleteItemForItemsApp({ userId, itemId: s.item.id })
    // The page that held the deleted item starts it again under the same uid.
    await getDb().query(
      `INSERT INTO public.workspace_item_v1(workspace_id,description,uid) VALUES($1,'typed again',$2)`,
      [s.workspaceId, s.item.uid],
    )

    const trashId = (await listTrashForItemsApp({ userId })).items[0]!.id
    const restored = await restoreTrashedItemForItemsApp({ userId, trashId })
    assert.ok(restored)
    assert.notEqual(restored.item.uid, s.item.uid)
    assert.equal(restored.item.description, "call the bank")
    assert.equal((await listItemsByUser(userId, s.workspaceId)).length, 3)
  })

  test("deleting a category with its items trashes each item", async () => {
    const userId = await realUser()
    const s = await seed(userId)
    await getDb().query(
      `INSERT INTO public.workspace_item_v1(workspace_id,description,category_id) VALUES($1,'second',$2)`,
      [s.workspaceId, s.category],
    )
    const target = { kind: "category" as const, categoryId: s.category }
    const preview = await previewItemGroup(userId, { workspaceId: s.workspaceId, target })
    await executeItemGroupAction(
      userId,
      { workspaceId: s.workspaceId, target },
      { kind: "delete", deleteItems: true },
      preview.snapshot,
    )

    const trash = await listTrashForItemsApp({ userId })
    assert.deepEqual(trash.items.map((item) => item.description).sort(), [
      "call the bank",
      "second",
    ])
  })

  test("one entry or the whole trash can be removed for good, and only by its owner", async () => {
    const userId = await realUser()
    const strangerId = await realUser()
    const s = await seed(userId)
    const second = await insertItem(s.workspaceId, "second")
    const third = await insertItem(s.workspaceId, "third")
    for (const itemId of [s.item.id, second, third]) await deleteItemForItemsApp({ userId, itemId })
    const entries = (await listTrashForItemsApp({ userId })).items
    assert.equal(entries.length, 3)

    const trashId = entries[0]!.id
    assert.deepEqual((await listTrashForItemsApp({ userId: strangerId })).items, [])
    assert.equal(await restoreTrashedItemForItemsApp({ userId: strangerId, trashId }), null)
    assert.equal((await purgeTrashForItemsApp({ userId: strangerId, trashId })).purged, 0)
    assert.equal((await purgeTrashForItemsApp({ userId: strangerId })).purged, 0)

    assert.equal((await purgeTrashForItemsApp({ userId, trashId })).purged, 1)
    assert.equal((await purgeTrashForItemsApp({ userId })).purged, 2)
    assert.deepEqual((await listTrashForItemsApp({ userId })).items, [])
  })

  test("a deletion removes the user's trash that is past its retention", async () => {
    const userId = await realUser()
    const s = await seed(userId)
    const second = await insertItem(s.workspaceId, "second")
    await insertItem(s.workspaceId, "stays")
    await deleteItemForItemsApp({ userId, itemId: s.item.id })
    await getDb().query(
      `UPDATE public.user_item_trash_v1 SET time_deleted=now()-make_interval(days => $2)
       WHERE user_id=$1`,
      [userId, TRASH_RETENTION_DAYS + 1],
    )
    await deleteItemForItemsApp({ userId, itemId: second })
    assert.deepEqual(
      (await listTrashForItemsApp({ userId })).items.map((item) => item.description),
      ["second"],
    )
  })

  test("signing in to an existing account brings the visitor's trash along", async () => {
    const realUserId = await realUser()
    const destination = await createWorkspaceForUser(realUserId, "personal")
    await insertItem(destination.id, "already here")
    const anonymous = await createAnonymousUser()
    userIds.push(anonymous.id)
    const anonymousWorkspace = (await listWorkspacesByUser(anonymous.id))[0]!
    assert.equal(anonymousWorkspace.label, destination.label)
    const itemId = await insertItem(anonymousWorkspace.id, "a draft")
    await insertItem(anonymousWorkspace.id, "kept")
    await deleteItemForItemsApp({ userId: anonymous.id, itemId })

    await mergeAnonymousItemsAppSession({ anonUserId: anonymous.id, realUserId })

    const trash = (await listTrashForItemsApp({ userId: realUserId })).items
    assert.deepEqual(
      trash.map((item) => item.description),
      ["a draft"],
    )
    // The visitor's workspace was merged away, so the item returns to the account's
    // workspace of the same label.
    const restored = await restoreTrashedItemForItemsApp({
      userId: realUserId,
      trashId: trash[0]!.id,
    })
    assert.equal(restored?.item.workspaceId, destination.id)
  })

  test("the item service still creates an item under the uid of a trashed one", async () => {
    const userId = await realUser()
    const s = await seed(userId)
    await deleteItemForItemsApp({ userId, itemId: s.item.id })
    const input: ItemInput = {
      uid: s.item.uid,
      workspaceId: s.workspaceId,
      categoryId: null,
      subcategoryId: null,
      statusId: null,
      tagIds: [],
      description: null,
      timeDue: null,
      timeRemind: null,
    }
    // No text, so the service refuses it before any provider call: the uid is free.
    await assert.rejects(createItemForItemsApp({ userId, item: input }))
    const free = await getDb().query(`SELECT 1 FROM public.workspace_item_v1 WHERE uid=$1`, [
      s.item.uid,
    ])
    assert.equal(free.rowCount, 0)
  })

  /** A plain note written directly, so no embedding is asked for. */
  const insertItem = async (workspaceId: number, description: string) =>
    (
      await getDb().query<{ id: number }>(
        `INSERT INTO public.workspace_item_v1(workspace_id,description) VALUES($1,$2) RETURNING id`,
        [workspaceId, description],
      )
    ).rows[0]!.id
})
