import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { after, describe, test } from "node:test"
import {
  isPublicUid,
  parseOptionalPublicUid,
  PUBLIC_UID_TAKEN_ERROR,
} from "../contracts/public-uid"
import { getDb } from "../lib/db/postgres"
import {
  createItemForItemsApp,
  getItemsAppErrorStatus,
  mergeAnonymousItemsAppSession,
} from "../services/items-app"
import {
  createItemForUser,
  createOrFindItemForUser,
  findWorkspaceIdByItemUid,
  listItemsByUser,
} from "../sql/item"
import { createAnonymousUser } from "../sql/user/anonymous"
import { exportUserBackup, restoreUserBackup } from "../sql/user/backup"
import { createWorkspaceForUser, listWorkspacesByUser } from "../sql/workspace"
import { withSchemaBefore } from "./historical-migration"

const testDbUrl = process.env.DB_ITEMS_TEST_URL ?? process.env.DB_NOTES_TEST_URL
if (testDbUrl) process.env.DB_ITEMS_URL = testDbUrl

test("a uid from a request is a UUID in the form the database prints", () => {
  assert.equal(parseOptionalPublicUid(undefined), null)
  assert.equal(parseOptionalPublicUid(null), null)
  assert.equal(parseOptionalPublicUid(""), null)
  assert.equal(
    parseOptionalPublicUid(" 0B6F1C1E-8F0A-4C56-9D3E-2A7B5C9E4F10 "),
    "0b6f1c1e-8f0a-4c56-9d3e-2a7b5c9e4f10",
  )
  for (const invalid of ["41", "not-a-uuid", 41, {}, "0b6f1c1e8f0a4c569d3e2a7b5c9e4f10"])
    assert.throws(() => parseOptionalPublicUid(invalid), { message: "uid must be a UUID." })
  assert.equal(isPublicUid("0B6F1C1E-8F0A-4C56-9D3E-2A7B5C9E4F10"), false, "compared in lowercase")
  assert.equal(getItemsAppErrorStatus(new Error(PUBLIC_UID_TAKEN_ERROR)), 409)
})

test(
  "the migration gives every existing item and workspace its own uid",
  { skip: !testDbUrl },
  () =>
    withSchemaBefore(testDbUrl!, "202611170100__public_uid.sql", async (db, apply) => {
      await db.query(`
        INSERT INTO public.user_v1(id,username) OVERRIDING SYSTEM VALUE VALUES(1,'migration');
        INSERT INTO public.user_workspace_v1(id,user_id,label) VALUES(10,1,'personal'),(11,1,'work');
        INSERT INTO public.workspace_item_v1(id,workspace_id,description,time_created,time_modified)
        VALUES(50,10,'first','2020-01-02','2021-02-03'),(51,10,'second','2020-01-02','2021-02-03'),
              (52,11,NULL,'2020-01-02','2021-02-03');
        UPDATE public.workspace_item_v1 SET time_due='2027-01-01' WHERE id=52;
      `)
      const before = await db.query(
        `SELECT id,workspace_id,description,time_due,time_created,time_modified
         FROM public.workspace_item_v1 ORDER BY id`,
      )
      await apply()
      const items = await db.query<{ uid: string }>(
        `SELECT uid::text FROM public.workspace_item_v1 ORDER BY id`,
      )
      const workspaces = await db.query<{ uid: string }>(
        `SELECT uid::text FROM public.user_workspace_v1 ORDER BY id`,
      )
      const uids = [...items.rows, ...workspaces.rows].map((row) => row.uid)
      assert.equal(uids.length, 5)
      assert.ok(uids.every(isPublicUid))
      assert.equal(new Set(uids).size, 5, "no two rows share a uid")
      assert.deepEqual(
        (
          await db.query(
            `SELECT id,workspace_id,description,time_due,time_created,time_modified
             FROM public.workspace_item_v1 ORDER BY id`,
          )
        ).rows,
        before.rows,
        "nothing else about an item changes",
      )
      await assert.rejects(
        db.query(`UPDATE public.workspace_item_v1 SET uid=$1 WHERE id=51`, [items.rows[0]!.uid]),
        /workspace_item_v1_uid_key/,
      )
    }),
)

describe("public uid (DB)", { skip: !testDbUrl }, () => {
  after(async () => {
    if (testDbUrl) await getDb().end()
  })

  const realUser = async () => {
    const { rows } = await getDb().query<{ id: number }>(
      `INSERT INTO public.user_v1(username,is_anonymous) VALUES($1,false) RETURNING id`,
      [`uid-${randomUUID()}`],
    )
    const userId = rows[0]!.id
    const workspace = await createWorkspaceForUser(userId, "personal")
    return { userId, workspaceId: workspace.id }
  }
  const noEmbedding = { descriptionEmbedding: null, embeddingModel: null }
  const input = (workspaceId: number, description: string, uid?: string) => ({
    uid,
    workspaceId,
    categoryId: null,
    subcategoryId: null,
    statusId: null,
    tagIds: [] as number[],
    description,
    timeDue: null,
    timeRemind: null,
  })
  const count = async (workspaceId: number) =>
    (
      await getDb().query<{ count: number }>(
        `SELECT COUNT(*)::int count FROM public.workspace_item_v1 WHERE workspace_id=$1`,
        [workspaceId],
      )
    ).rows[0]!.count

  test("every item and workspace has a uid, and a create may choose the item's", async () => {
    const { userId, workspaceId } = await realUser()
    const assigned = await createItemForUser(userId, input(workspaceId, "assigned"), noEmbedding)
    assert.ok(isPublicUid(assigned.uid))

    const chosen = randomUUID()
    const created = await createItemForUser(
      userId,
      input(workspaceId, "chosen", chosen),
      noEmbedding,
    )
    assert.equal(created.uid, chosen)
    assert.deepEqual(
      (await listItemsByUser(userId, workspaceId)).map((item) => item.uid).sort(),
      [assigned.uid, chosen].sort(),
    )
    const [workspace] = await listWorkspacesByUser(userId)
    assert.ok(isPublicUid(workspace!.uid))
  })

  test("a create sent twice stores one item and answers with it both times", async () => {
    const { userId, workspaceId } = await realUser()
    const uid = randomUUID()
    const first = await createItemForUser(
      userId,
      input(workspaceId, "typed once", uid),
      noEmbedding,
    )
    // The retry carries what the page held when it gave up waiting, which may be newer.
    const retry = await createItemForUser(
      userId,
      input(workspaceId, "typed once, then more", uid),
      noEmbedding,
    )
    assert.equal(retry.id, first.id)
    assert.equal(
      (await createOrFindItemForUser(userId, input(workspaceId, "again", uid), noEmbedding))
        .created,
      false,
      "the caller is told nothing was written",
    )
    assert.equal(retry.description, "typed once", "the stored item is the answer, as stored")
    assert.equal(await count(workspaceId), 1)

    // Two at the same moment, as a retry racing a slow first attempt would be.
    const racedUid = randomUUID()
    const raced = await Promise.all(
      [1, 2].map(() =>
        createItemForUser(userId, input(workspaceId, "raced", racedUid), noEmbedding),
      ),
    )
    assert.equal(raced[0]!.id, raced[1]!.id)
    assert.equal(await count(workspaceId), 2)
  })

  test("a repeated create is answered without asking for an embedding", async () => {
    const { userId, workspaceId } = await realUser()
    const uid = randomUUID()
    await createItemForUser(
      userId,
      input(workspaceId, "stored while embeddings worked", uid),
      noEmbedding,
    )
    const savedKey = process.env.JINA_API_KEY
    delete process.env.JINA_API_KEY
    try {
      // Without a key a new item with text cannot be created at all.
      await assert.rejects(
        createItemForItemsApp({ userId, item: input(workspaceId, "new text", randomUUID()) }),
      )
      const repeated = await createItemForItemsApp({
        userId,
        item: input(workspaceId, "sent again, with more", uid),
      })
      assert.equal(repeated.created, false)
      assert.equal(repeated.item.description, "stored while embeddings worked")
      assert.equal(await count(workspaceId), 1)
    } finally {
      if (savedKey !== undefined) process.env.JINA_API_KEY = savedKey
    }
  })

  test("a uid another item holds elsewhere is refused and tells nothing about it", async () => {
    const owner = await realUser()
    const other = await realUser()
    const uid = randomUUID()
    await createItemForUser(
      owner.userId,
      input(owner.workspaceId, "private text", uid),
      noEmbedding,
    )

    await assert.rejects(
      createItemForUser(other.userId, input(other.workspaceId, "mine", uid), noEmbedding),
      { message: PUBLIC_UID_TAKEN_ERROR },
    )
    assert.equal(await count(other.workspaceId), 0)

    // The same user's other workspace does not get the item either: a uid names one item.
    const second = await createWorkspaceForUser(owner.userId, "second")
    await assert.rejects(
      createItemForUser(owner.userId, input(second.id, "elsewhere", uid), noEmbedding),
      { message: PUBLIC_UID_TAKEN_ERROR },
    )
    assert.equal(await count(second.id), 0)
  })

  test("an item keeps its uid when a visitor's items move into an account", async () => {
    const visitor = await createAnonymousUser()
    const visitorWorkspace =
      (await listWorkspacesByUser(visitor.id))[0] ??
      (await createWorkspaceForUser(visitor.id, "personal"))
    const item = await createItemForUser(
      visitor.id,
      input(visitorWorkspace.id, `moved ${randomUUID()}`),
      noEmbedding,
    )
    const account = await realUser()
    await mergeAnonymousItemsAppSession({ anonUserId: visitor.id, realUserId: account.userId })
    const moved = (await listItemsByUser(account.userId, account.workspaceId)).find(
      (candidate) => candidate.id === item.id,
    )
    assert.equal(moved?.uid, item.uid)
  })

  test("a restore keeps a uid that is free and replaces one that is taken", async () => {
    const source = await realUser()
    const side = await createWorkspaceForUser(source.userId, `side ${randomUUID().slice(0, 8)}`)
    await createItemForUser(source.userId, input(source.workspaceId, "in personal"), noEmbedding)
    await createItemForUser(source.userId, input(side.id, "in the side workspace"), noEmbedding)
    const backup = await exportUserBackup(source.userId)
    const backedUp = (label: string) => backup.workspaces.find((w) => w.label === label)!
    assert.equal(backedUp(side.label).uid, side.uid)

    // While the source still holds them, a restore elsewhere makes second copies.
    const copy = await realUser()
    await restoreUserBackup(copy.userId, backup)
    const copied = await exportUserBackup(copy.userId)
    const copiedSide = copied.workspaces.find((w) => w.label === side.label)!
    assert.notEqual(copiedSide.uid, side.uid)
    assert.notEqual(copiedSide.items[0]!.uid, backedUp(side.label).items[0]!.uid)
    assert.ok(isPublicUid(copiedSide.uid) && isPublicUid(copiedSide.items[0]!.uid))

    // Once the originals are gone, the file restores them as themselves.
    await getDb().query(`DELETE FROM public.user_v1 WHERE id=$1`, [source.userId])
    const home = await realUser()
    await restoreUserBackup(home.userId, backup)
    const restored = await exportUserBackup(home.userId)
    const restoredSide = restored.workspaces.find((w) => w.label === side.label)!
    assert.equal(restoredSide.uid, side.uid, "a workspace the account did not have keeps its uid")
    assert.equal(restoredSide.items[0]!.uid, backedUp(side.label).items[0]!.uid)
    const personal = restored.workspaces.find((w) => w.label === "personal")!
    assert.equal(
      personal.items[0]!.uid,
      backedUp("personal").items[0]!.uid,
      "an item keeps its uid when it joins a workspace the account already had",
    )
    assert.equal(personal.uid, (await listWorkspacesByUser(home.userId))[0]!.uid)

    // A file that lists one uid twice still restores: the second item gets its own.
    const twice = structuredClone(backup)
    const items = twice.workspaces.find((w) => w.label === "personal")!.items
    items.push({ ...items[0]!, description: "a second item with the first one's uid" })
    const again = await realUser()
    assert.deepEqual(await restoreUserBackup(again.userId, twice), {
      itemsImported: 3,
      itemsSkipped: 0,
    })
    const uids = (await exportUserBackup(again.userId)).workspaces.flatMap((w) =>
      w.items.map((item) => item.uid),
    )
    assert.equal(new Set(uids).size, 3)
  })

  test("two restores of one file at the same moment both succeed, and one keeps the uids", async () => {
    const source = await realUser()
    const side = await createWorkspaceForUser(source.userId, `raced ${randomUUID().slice(0, 8)}`)
    await createItemForUser(source.userId, input(side.id, "restored twice at once"), noEmbedding)
    const backup = await exportUserBackup(source.userId)
    const original = backup.workspaces.find((w) => w.label === side.label)!
    await getDb().query(`DELETE FROM public.user_v1 WHERE id=$1`, [source.userId])

    const [first, second] = [await realUser(), await realUser()]
    const results = await Promise.all(
      [first, second].map((account) => restoreUserBackup(account.userId, backup)),
    )
    assert.deepEqual(
      results.map((result) => result.itemsImported),
      [1, 1],
    )
    const restored = await Promise.all(
      [first, second].map(
        async (account) =>
          (await exportUserBackup(account.userId)).workspaces.find((w) => w.label === side.label)!,
      ),
    )
    const workspaceUids = restored.map((workspace) => workspace.uid)
    const itemUids = restored.map((workspace) => workspace.items[0]!.uid)
    assert.notEqual(workspaceUids[0], workspaceUids[1])
    assert.notEqual(itemUids[0], itemUids[1])
    assert.equal(workspaceUids.filter((uid) => uid === original.uid).length, 1)
    assert.equal(itemUids.filter((uid) => uid === original.items[0]!.uid).length, 1)
  })

  test("a uid finds the workspace of the user's own item only", async () => {
    const owner = await realUser()
    const second = await createWorkspaceForUser(owner.userId, "second")
    const item = await createItemForUser(owner.userId, input(second.id, "linked"), noEmbedding)
    assert.equal(await findWorkspaceIdByItemUid(owner.userId, item.uid), second.id)
    const other = await realUser()
    assert.equal(await findWorkspaceIdByItemUid(other.userId, item.uid), null)
    assert.equal(await findWorkspaceIdByItemUid(owner.userId, randomUUID()), null)
  })

  test("a backup with a uid that is not a UUID is refused", async () => {
    const { userId, workspaceId } = await realUser()
    await createItemForUser(userId, input(workspaceId, "kept"), noEmbedding)
    const backup = await exportUserBackup(userId)
    const broken = structuredClone(backup)
    broken.workspaces[0]!.items[0]!.uid = "41"
    await assert.rejects(restoreUserBackup(userId, broken), {
      message: "Backup contains an invalid uid.",
    })
  })
})
