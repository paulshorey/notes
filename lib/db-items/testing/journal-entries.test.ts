import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { after, describe, test } from "node:test"
import { JOURNAL_DAY_TAKEN_ERROR, parseEntryDate } from "../contracts/item-journal"
import { itemKinds } from "../contracts/item-kinds"
import type { ItemInput } from "../contracts/items-app"
import { parseUserBackup } from "../contracts/user-backup"
import { getDb } from "../lib/db/postgres"
import {
  combineJournalDayForItemsApp,
  createItemForItemsApp,
  deleteItemForItemsApp,
  getItemsAppErrorStatus,
  listTrashForItemsApp,
  mergeAnonymousItemsAppSession,
  restoreTrashedItemForItemsApp,
  updateItemForItemsApp,
} from "../services/items-app"
import { listItemsByUser, parseItemInput } from "../sql/item"
import { ItemGroupConflictError } from "../sql/item-group-errors"
import { moveWorkspaceItems } from "../sql/item/workspace-move"
import { createAnonymousUser } from "../sql/user/anonymous"
import { exportUserBackup, restoreUserBackup } from "../sql/user/backup"
import { createWorkspaceForUser, listWorkspacesByUser } from "../sql/workspace"

const testDbUrl = process.env.DB_ITEMS_TEST_URL ?? process.env.DB_NOTES_TEST_URL
if (testDbUrl) process.env.DB_ITEMS_URL = testDbUrl

test("a journal day is a calendar date and nothing else", () => {
  assert.equal(parseEntryDate("2026-11-25"), "2026-11-25")
  assert.equal(parseEntryDate(null), null)
  assert.equal(parseEntryDate(""), null)
  for (const bad of ["2026-02-30", "2026-11-25T00:00:00Z", "11/25/2026", 20261125])
    assert.throws(() => parseEntryDate(bad), /Journal day/)
  // A request that leaves the day out says nothing about it; null removes it.
  assert.equal("entryDate" in parseItemInput({ workspaceId: 1, description: "x" }), false)
  assert.equal(parseItemInput({ workspaceId: 1, entryDate: null }).entryDate, null)
  assert.equal(parseItemInput({ workspaceId: 1, entryDate: "2026-11-25" }).entryDate, "2026-11-25")
})

/** Each test runs without an embedding provider key, as a journal entry may hold no text. */
describe("journal entries (DB)", { skip: !testDbUrl }, () => {
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
      [`journal-${randomUUID()}`],
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
  /** An entry with text and vocabulary, written directly so no embedding is asked for. */
  const seedEntry = async (
    workspaceId: number,
    day: string,
    text: string,
    { category, tags = [] }: { category?: string; tags?: string[] } = {},
  ) => {
    const categoryId = category
      ? (
          await getDb().query<{ id: number }>(
            `INSERT INTO public.workspace_category_v1(workspace_id,label) VALUES($1,$2)
             ON CONFLICT(workspace_id,label) DO UPDATE SET label=EXCLUDED.label RETURNING id`,
            [workspaceId, category],
          )
        ).rows[0]!.id
      : null
    const item = await getDb().query<{ id: number }>(
      `INSERT INTO public.workspace_item_v1
       (workspace_id,description,entry_date,category_id,description_embedding,embedding_model,embedding_updated_at)
       VALUES($1,$2,$3,$4,$5::vector,'seeded',now()) RETURNING id`,
      [workspaceId, text, day, categoryId, `[${Array(1024).fill(0.01).join(",")}]`],
    )
    for (const label of tags) {
      const tag = await getDb().query<{ id: number }>(
        `INSERT INTO public.workspace_tag_v1(workspace_id,label) VALUES($1,$2)
         ON CONFLICT(workspace_id,label) DO UPDATE SET label=EXCLUDED.label RETURNING id`,
        [workspaceId, label],
      )
      await getDb().query(
        `INSERT INTO public.item_tag_link_v1(item_id,tag_id,workspace_id) VALUES($1,$2,$3)`,
        [item.rows[0]!.id, tag.rows[0]!.id, workspaceId],
      )
    }
    return item.rows[0]!.id
  }
  const entries = async (userId: number, workspaceId: number) =>
    (await listItemsByUser(userId, workspaceId))
      .filter((item) => item.entryDate !== null)
      .map((item) => ({
        day: item.entryDate,
        text: item.description,
        category: item.category?.label ?? null,
        tags: item.tags.map((tag) => tag.label),
      }))

  test("an entry needs no text, is the journal kind, and keeps its day as a plain date", async () => {
    const userId = await realUser()
    const workspace = await createWorkspaceForUser(userId, "personal")
    const created = await createItemForItemsApp({
      userId,
      item: input(workspace.id, { entryDate: "2026-11-25" }),
    })
    assert.equal(created.item.entryDate, "2026-11-25")
    assert.equal(created.item.description, null)
    assert.deepEqual(itemKinds(created.item), ["journal"])
    // An update that names no day leaves it, and null removes it. Removing it from an
    // entry without text would leave nothing, which is refused.
    await assert.rejects(
      updateItemForItemsApp({
        userId,
        itemId: created.item.id,
        item: input(workspace.id, { entryDate: null }),
      }),
    )
    const moved = await updateItemForItemsApp({
      userId,
      itemId: created.item.id,
      item: input(workspace.id, { entryDate: "2026-11-26" }),
    })
    assert.equal(moved?.item.entryDate, "2026-11-26")
  })

  test("a workspace has one entry per day, and another workspace may use the same day", async () => {
    const userId = await realUser()
    const workspace = await createWorkspaceForUser(userId, "personal")
    const other = await createWorkspaceForUser(userId, "work")
    const day = "2026-11-25"
    await createItemForItemsApp({ userId, item: input(workspace.id, { entryDate: day }) })
    await assert.rejects(
      createItemForItemsApp({ userId, item: input(workspace.id, { entryDate: day }) }),
      (error: unknown) => {
        assert.ok(error instanceof Error)
        assert.equal(error.message, JOURNAL_DAY_TAKEN_ERROR)
        assert.equal(getItemsAppErrorStatus(error), 409)
        return true
      },
    )
    const next = await createItemForItemsApp({
      userId,
      item: input(workspace.id, { entryDate: "2026-11-26" }),
    })
    await assert.rejects(
      updateItemForItemsApp({
        userId,
        itemId: next.item.id,
        item: input(workspace.id, { entryDate: day }),
      }),
      { message: JOURNAL_DAY_TAKEN_ERROR },
    )
    await createItemForItemsApp({ userId, item: input(other.id, { entryDate: day }) })
    assert.equal((await entries(userId, workspace.id)).length, 2)
    assert.equal((await entries(userId, other.id)).length, 1)
  })

  test("combining a day appends the text, unions the tags, keeps the target's filing, and is permanent", async () => {
    const userId = await realUser()
    const workspace = await createWorkspaceForUser(userId, "personal")
    const target = await seedEntry(workspace.id, "2026-11-25", "Morning", {
      category: "home",
      tags: ["calm"],
    })
    const source = await seedEntry(workspace.id, "2026-11-26", "Evening", {
      category: "work",
      tags: ["calm", "busy"],
    })
    const combined = await combineJournalDayForItemsApp({
      userId,
      itemId: source,
      entryDate: "2026-11-25",
    })
    assert.equal(combined?.item.id, target)
    assert.deepEqual(await entries(userId, workspace.id), [
      { day: "2026-11-25", text: "Morning\n\nEvening", category: "home", tags: ["busy", "calm"] },
    ])
    assert.deepEqual((await listTrashForItemsApp({ userId })).items, [])
    const stored = await getDb().query<{ embedded: boolean }>(
      `SELECT (description_embedding IS NOT NULL) embedded FROM public.workspace_item_v1 WHERE id=$1`,
      [target],
    )
    assert.equal(stored.rows[0]!.embedded, false, "the old embedding no longer matches the text")
    // A day without an entry has nothing to combine with.
    assert.equal(
      await combineJournalDayForItemsApp({ userId, itemId: target, entryDate: "2026-12-01" }),
      null,
    )
    // Another user's item is not found.
    assert.equal(
      await combineJournalDayForItemsApp({
        userId: await realUser(),
        itemId: target,
        entryDate: "2026-11-25",
      }),
      null,
    )
  })

  test("restoring a trashed entry onto a day that has a new one is refused, or combines when asked", async () => {
    const userId = await realUser()
    const workspace = await createWorkspaceForUser(userId, "personal")
    const day = "2026-11-25"
    const old = await seedEntry(workspace.id, day, "Old entry", { tags: ["kept"] })
    await seedEntry(workspace.id, "2026-11-24", "Keeps the workspace")
    await deleteItemForItemsApp({ userId, itemId: old })
    await seedEntry(workspace.id, day, "New entry")
    const trashId = (await listTrashForItemsApp({ userId })).items[0]!.id
    assert.equal((await listTrashForItemsApp({ userId })).items[0]!.entryDate, day)

    await assert.rejects(restoreTrashedItemForItemsApp({ userId, trashId }), {
      message: JOURNAL_DAY_TAKEN_ERROR,
    })
    assert.equal((await listTrashForItemsApp({ userId })).items.length, 1, "it stays in the trash")

    const restored = await restoreTrashedItemForItemsApp({
      userId,
      trashId,
      combineJournalDay: true,
    })
    assert.equal(restored?.item.description, "New entry\n\nOld entry")
    assert.deepEqual(
      restored?.item.tags.map((tag) => tag.label),
      ["kept"],
    )
    assert.deepEqual((await listTrashForItemsApp({ userId })).items, [])
    assert.equal(
      (await entries(userId, workspace.id)).filter((entry) => entry.day === day).length,
      1,
    )
  })

  test("signing in combines a visitor's entry with the account's entry for the same day", async () => {
    const realUserId = await realUser()
    const destination = await createWorkspaceForUser(realUserId, "personal")
    await seedEntry(destination.id, "2026-11-25", "Account")
    const anonymous = await createAnonymousUser()
    userIds.push(anonymous.id)
    const source = (await listWorkspacesByUser(anonymous.id))[0]!
    await seedEntry(source.id, "2026-11-25", "Visitor", { tags: ["new"] })
    await seedEntry(source.id, "2026-11-26", "Next day")

    await mergeAnonymousItemsAppSession({ anonUserId: anonymous.id, realUserId })

    const days = (await entries(realUserId, destination.id)).map((entry) => [entry.day, entry.text])
    assert.deepEqual(
      days.sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
      [
        ["2026-11-25", "Account\n\nVisitor"],
        ["2026-11-26", "Next day"],
      ],
    )
  })

  test("a backup carries journal days, and restoring combines a day the account already has", async () => {
    const sourceId = await realUser()
    const targetId = await realUser()
    const workspace = await createWorkspaceForUser(sourceId, "personal")
    await seedEntry(workspace.id, "2026-11-25", "From the file")
    const backup = await exportUserBackup(sourceId)
    assert.deepEqual(
      backup.workspaces[0]!.items.map((item) => item.entryDate),
      ["2026-11-25"],
    )
    const destination = await createWorkspaceForUser(targetId, "personal")
    await seedEntry(destination.id, "2026-11-25", "Already here")
    await restoreUserBackup(targetId, backup)
    assert.deepEqual(
      (await entries(targetId, destination.id)).map((entry) => entry.text),
      ["Already here\n\nFrom the file"],
    )

    // A file from before journal days reads without them, and one that names a day
    // twice in a workspace is refused.
    const older = structuredClone(backup) as unknown as Record<string, unknown> & {
      workspaces: { items: Record<string, unknown>[] }[]
    }
    older.version = 4
    delete older.workspaces[0]!.items[0]!.entryDate
    assert.equal(parseUserBackup(older).workspaces[0]!.items[0]!.entryDate, null)
    const twice = structuredClone(backup)
    twice.workspaces[0]!.items.push({ ...twice.workspaces[0]!.items[0]!, uid: randomUUID() })
    assert.throws(() => parseUserBackup(twice), /two journal entries for one day/)
  })

  test("moving an entry to a workspace that has its day is refused", async () => {
    const userId = await realUser()
    const source = await createWorkspaceForUser(userId, "personal")
    const destination = await createWorkspaceForUser(userId, "work")
    const moving = await seedEntry(source.id, "2026-11-25", "Mine")
    await seedEntry(destination.id, "2026-11-25", "Theirs")
    const client = await getDb().connect()
    try {
      await client.query("BEGIN")
      await assert.rejects(
        moveWorkspaceItems(client, source.id, destination.id, { itemIds: [moving] }),
        ItemGroupConflictError,
      )
    } finally {
      await client.query("ROLLBACK")
      client.release()
    }
    assert.equal((await entries(userId, source.id)).length, 1)
  })
})
