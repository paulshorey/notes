import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { after, describe, test } from "node:test"
import { ITEM_CAPABILITIES } from "../contracts/item-capabilities"
import { getDb } from "../lib/db/postgres"
import { mergeAnonymousItemsAppSession } from "../services/items-app"
import { listItemsByUser } from "../sql/item"
import { findUndeclaredItemStorage } from "../sql/item/storage-audit"
import {
  ITEM_CORE,
  ITEM_IDENTITY_FIELDS,
  ITEM_TAXONOMY,
  STORED_ITEM_CAPABILITIES,
} from "../sql/item/stored-capabilities"
import { createAnonymousUser } from "../sql/user/anonymous"
import { exportUserBackup, restoreUserBackup } from "../sql/user/backup"
import { listWorkspacesByUser } from "../sql/workspace"
import { backupFixture } from "./user-backup-fixture"

const testDbUrl = process.env.DB_ITEMS_TEST_URL ?? process.env.DB_NOTES_TEST_URL
if (testDbUrl) process.env.DB_ITEMS_URL = testDbUrl

test("both halves of the capability registry declare the same capabilities", () => {
  assert.deepEqual(
    Object.keys(STORED_ITEM_CAPABILITIES).sort(),
    ITEM_CAPABILITIES.map((capability) => capability.key).sort(),
  )
})

test("a backup item holds exactly the fields the registry declares", () => {
  const declared = [ITEM_CORE, ITEM_TAXONOMY, ...Object.values(STORED_ITEM_CAPABILITIES)].flatMap(
    (part) => Object.keys(part.fields),
  )
  assert.equal(new Set(declared).size, declared.length, "a field is declared twice")
  assert.deepEqual(declared.sort(), Object.keys(backupFixture().workspaces[0]!.items[0]!).sort())
  // Everything except the modification time decides whether two items are the same.
  assert.deepEqual(
    [...ITEM_IDENTITY_FIELDS].sort(),
    declared.filter((field) => field !== "timeModified").sort(),
  )
})

describe("items keep their identity across accounts (DB)", { skip: !testDbUrl }, () => {
  const userIds: number[] = []
  // A stand-in for a capability with its own table: rows keyed only by the item id.
  const probe = `item_probe_${randomUUID().replaceAll("-", "").slice(0, 12)}`

  after(async () => {
    if (!testDbUrl) return
    await getDb().query(`DROP TABLE IF EXISTS public.${probe}`)
    await getDb().query(`DELETE FROM public.user_v1 WHERE id=ANY($1::int[])`, [userIds])
    await getDb().end()
  })

  const realUser = async () => {
    const { rows } = await getDb().query<{ id: number }>(
      `INSERT INTO public.user_v1(username,is_anonymous) VALUES($1,false) RETURNING id`,
      [`lifecycle-${randomUUID()}`],
    )
    userIds.push(rows[0]!.id)
    return rows[0]!.id
  }
  const one = async <T>(sql: string, values: unknown[] = []) =>
    (await getDb().query<T & Record<string, unknown>>(sql, values)).rows[0]!
  /** Everything stored for an item except which workspace owns it. */
  const stored = async (itemId: number) =>
    one<Record<string, unknown>>(
      `SELECT n.id,n.description,n.time_due,n.time_remind,n.time_created,n.time_modified,
              n.description_embedding::text embedding,n.embedding_model,n.embedding_updated_at,
              (SELECT label FROM public.workspace_category_v1 WHERE id=n.category_id) category,
              (SELECT label FROM public.workspace_subcategory_v1 WHERE id=n.subcategory_id) subcategory,
              (SELECT label FROM public.workspace_status_v1 WHERE id=n.status_id) status,
              ARRAY(SELECT t.label FROM public.item_tag_link_v1 l
                JOIN public.workspace_tag_v1 t ON t.id=l.tag_id AND t.workspace_id=n.workspace_id
                WHERE l.item_id=n.id ORDER BY t.label) tags
       FROM public.workspace_item_v1 n WHERE n.id=$1`,
      [itemId],
    )

  /** A visitor's workspace holding one item with every capability, filed and tagged. */
  const visitor = async (workspaceLabel: string) => {
    const user = await createAnonymousUser()
    userIds.push(user.id)
    const workspace = (await listWorkspacesByUser(user.id))[0]!
    await getDb().query(`UPDATE public.user_workspace_v1 SET label=$2 WHERE id=$1`, [
      workspace.id,
      workspaceLabel,
    ])
    const ids = await one<{ category: number; status: number; tag: number; tag2: number }>(
      `WITH c AS (INSERT INTO public.workspace_category_v1(workspace_id,label) VALUES($1,'work') RETURNING id),
            s AS (INSERT INTO public.workspace_status_v1(workspace_id,label,position) VALUES($1,'doing',7) RETURNING id),
            t AS (INSERT INTO public.workspace_tag_v1(workspace_id,label) VALUES($1,'urgent') RETURNING id),
            t2 AS (INSERT INTO public.workspace_tag_v1(workspace_id,label) VALUES($1,'visitor only') RETURNING id)
       SELECT c.id category,s.id status,t.id tag,t2.id tag2 FROM c,s,t,t2`,
      [workspace.id],
    )
    const subcategory = (
      await one<{ id: number }>(
        `INSERT INTO public.workspace_subcategory_v1(category_id,label) VALUES($1,'ideas') RETURNING id`,
        [ids.category],
      )
    ).id
    const item = (
      await one<{ id: number }>(
        `INSERT INTO public.workspace_item_v1
         (workspace_id,category_id,subcategory_id,status_id,description,time_due,time_remind,
          description_embedding,embedding_model,embedding_updated_at,time_created,time_modified)
         VALUES($1,$2,$3,$4,'  kept exactly  ','2027-01-02T03:04:05Z','2027-01-01T03:04:05Z',
          $5::vector,'test-model','2024-05-06T07:08:09Z','2020-01-02T03:04:05Z','2021-02-03T04:05:06Z')
         RETURNING id`,
        [
          workspace.id,
          ids.category,
          subcategory,
          ids.status,
          `[${[1, ...Array(1023).fill(0)].join(",")}]`,
        ],
      )
    ).id
    await getDb().query(
      `INSERT INTO public.item_tag_link_v1(item_id,tag_id,workspace_id) VALUES($1,$2,$4),($1,$3,$4)`,
      [item, ids.tag, ids.tag2, workspace.id],
    )
    await getDb().query(
      `CREATE TABLE IF NOT EXISTS public.${probe} (
         id serial PRIMARY KEY,
         item_id integer NOT NULL REFERENCES public.workspace_item_v1(id) ON DELETE CASCADE,
         payload text NOT NULL)`,
    )
    await getDb().query(`INSERT INTO public.${probe}(item_id,payload) VALUES($1,'a'),($1,'b')`, [
      item,
    ])
    return { userId: user.id, workspaceId: workspace.id, item }
  }
  const probeRows = async (itemId: number) =>
    (
      await getDb().query<{ payload: string }>(
        `SELECT payload FROM public.${probe} WHERE item_id=$1 ORDER BY payload`,
        [itemId],
      )
    ).rows.map((row) => row.payload)

  test("merging into a workspace of the same name moves the item instead of copying it", async () => {
    const realUserId = await realUser()
    // The account already uses the same names, with its own rows and order.
    const realWorkspace = await one<{ id: number }>(
      `INSERT INTO public.user_workspace_v1(user_id,label) VALUES($1,'shared name') RETURNING id`,
      [realUserId],
    )
    const own = await one<{ category: number; subcategory: number; status: number; tag: number }>(
      `WITH c AS (INSERT INTO public.workspace_category_v1(workspace_id,label) VALUES($1,'work') RETURNING id),
            sc AS (INSERT INTO public.workspace_subcategory_v1(category_id,label) SELECT id,'ideas' FROM c RETURNING id),
            s AS (INSERT INTO public.workspace_status_v1(workspace_id,label,position) VALUES($1,'doing',2) RETURNING id),
            t AS (INSERT INTO public.workspace_tag_v1(workspace_id,label) VALUES($1,'urgent') RETURNING id)
       SELECT c.id category,sc.id subcategory,s.id status,t.id tag FROM c,sc,s,t`,
      [realWorkspace.id],
    )
    const source = await visitor("shared name")
    const before = await stored(source.item)

    await mergeAnonymousItemsAppSession({ anonUserId: source.userId, realUserId })

    // The same row, now in the account's workspace: nothing about it was rewritten.
    const after = await stored(source.item)
    assert.deepEqual(after, before)
    assert.equal(after.description, "  kept exactly  ")
    const placed = await one<{
      workspace_id: number
      category_id: number
      subcategory_id: number
      status_id: number
    }>(
      `SELECT workspace_id,category_id,subcategory_id,status_id FROM public.workspace_item_v1 WHERE id=$1`,
      [source.item],
    )
    // It points at the account's own rows, matched by label, not at copies.
    assert.deepEqual(placed, {
      workspace_id: realWorkspace.id,
      category_id: own.category,
      subcategory_id: own.subcategory,
      status_id: own.status,
    })
    const tagIds = (
      await getDb().query<{ tag_id: number; workspace_id: number }>(
        `SELECT tag_id,workspace_id FROM public.item_tag_link_v1 WHERE item_id=$1`,
        [source.item],
      )
    ).rows
    assert.ok(tagIds.some((link) => link.tag_id === own.tag))
    assert.ok(tagIds.every((link) => link.workspace_id === realWorkspace.id))
    // Rows keyed by the item id came along without the merge knowing the table.
    assert.deepEqual(await probeRows(source.item), ["a", "b"])
    // The account's status keeps its own position; the visitor's workspace is gone.
    assert.equal(
      (
        await one<{ position: number }>(
          `SELECT position FROM public.workspace_status_v1 WHERE id=$1`,
          [own.status],
        )
      ).position,
      2,
    )
    assert.equal(
      (
        await getDb().query(`SELECT 1 FROM public.user_workspace_v1 WHERE id=$1`, [
          source.workspaceId,
        ])
      ).rowCount,
      0,
    )
    assert.deepEqual(
      (await listItemsByUser(realUserId, realWorkspace.id)).map((item) => item.id),
      [source.item],
    )
  })

  test("merging a workspace the account does not have hands the whole workspace over", async () => {
    const realUserId = await realUser()
    const source = await visitor(`only here ${randomUUID()}`)
    const before = await stored(source.item)
    const workspaceBefore = await one<{ time_modified: Date }>(
      `SELECT time_modified FROM public.user_workspace_v1 WHERE id=$1`,
      [source.workspaceId],
    )

    await mergeAnonymousItemsAppSession({ anonUserId: source.userId, realUserId })

    assert.deepEqual(await stored(source.item), before)
    assert.deepEqual(await probeRows(source.item), ["a", "b"])
    const workspace = await one<{ user_id: number; time_modified: Date }>(
      `SELECT user_id,time_modified FROM public.user_workspace_v1 WHERE id=$1`,
      [source.workspaceId],
    )
    assert.equal(workspace.user_id, realUserId)
    assert.deepEqual(workspace.time_modified, workspaceBefore.time_modified)
  })

  test("an ordinary edit after a merge still moves the modification time", async () => {
    const realUserId = await realUser()
    const source = await visitor(`edited ${randomUUID()}`)
    await mergeAnonymousItemsAppSession({ anonUserId: source.userId, realUserId })
    const before = await stored(source.item)
    await getDb().query(`UPDATE public.workspace_item_v1 SET description='edited' WHERE id=$1`, [
      source.item,
    ])
    const after = await stored(source.item)
    assert.notDeepEqual(after.time_modified, before.time_modified)
    assert.deepEqual(after.time_created, before.time_created)
  })

  test("a backup of every capability restores into an empty account unchanged", async () => {
    const sourceId = await realUser()
    const targetId = await realUser()
    assert.deepEqual(await restoreUserBackup(sourceId, backupFixture()), {
      itemsImported: 1,
      itemsSkipped: 0,
    })
    const exported = await exportUserBackup(sourceId)
    const item = exported.workspaces.find((workspace) => workspace.label === "personal")!.items[0]!
    // Every declared field made the trip, with every capability present.
    assert.deepEqual(item, backupFixture().workspaces[0]!.items[0])

    assert.deepEqual(await restoreUserBackup(targetId, exported), {
      itemsImported: 1,
      itemsSkipped: 0,
    })
    const again = await exportUserBackup(targetId)
    assert.deepEqual(
      again.workspaces.find((workspace) => workspace.label === "personal"),
      exported.workspaces.find((workspace) => workspace.label === "personal"),
    )
    // The same file again adds nothing, in either account.
    for (const userId of [sourceId, targetId])
      assert.deepEqual(await restoreUserBackup(userId, exported), {
        itemsImported: 0,
        itemsSkipped: 1,
      })
  })

  test("the storage audit reports an item column or table nothing declares", async () => {
    // Other tests in this file create the probe table; make sure it exists here too.
    await getDb().query(
      `CREATE TABLE IF NOT EXISTS public.${probe} (
         id serial PRIMARY KEY,
         item_id integer NOT NULL REFERENCES public.workspace_item_v1(id) ON DELETE CASCADE,
         payload text NOT NULL)`,
    )
    const client = await getDb().connect()
    try {
      // The column exists only inside this transaction, so no other test sees it.
      await client.query("BEGIN")
      await client.query(`ALTER TABLE public.workspace_item_v1 ADD COLUMN undeclared_probe text`)
      const found = await findUndeclaredItemStorage(client)
      assert.deepEqual(found.columns, ["undeclared_probe"])
      assert.ok(found.tables.includes(probe))
      await client.query("ROLLBACK")
      const clean = await findUndeclaredItemStorage(client)
      assert.deepEqual(clean.columns, [])
      assert.deepEqual(
        clean.tables.filter((name) => !name.startsWith("item_probe_")),
        [],
      )
    } finally {
      await client.query("ROLLBACK").catch(() => undefined)
      client.release()
    }
  })
})
