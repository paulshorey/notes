import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { after, describe, test } from "node:test"
import { Client } from "pg"
import { getDb } from "../lib/db/postgres"
import { createWorkspaceForUser } from "../sql/workspace"
import { createItemForUser, listItemsByUser } from "../sql/item"
import { executeItemGroupAction, previewItemGroup } from "../sql/item-groups"
import { ItemGroupConflictError, ItemGroupNotFoundError } from "../sql/item-group-errors"
import { deleteCategoryForWorkspace, updateCategoryLabelForWorkspace } from "../sql/category"
import type { ItemGroupActionResponse, ItemGroupSelection } from "../contracts/item-group-actions"
import {
  executeItemGroupActionForItemsApp,
  parseExecuteItemGroupActionRequest,
} from "../services/item-group-actions"
import { updateItemForItemsApp } from "../services/items-app"

const testDbUrl = process.env.DB_ITEMS_TEST_URL ?? process.env.DB_NOTES_TEST_URL
if (testDbUrl) process.env.DB_ITEMS_URL = testDbUrl

test("bulk request parsing requires explicit actions, selectors and a preview", () => {
  const base = {
    userId: 1,
    selection: { workspaceId: 1, target: { kind: "uncategorized" } },
    snapshot: "a".repeat(64),
  }
  for (const action of [
    { kind: "delete" },
    { kind: "delete", deleteItems: "true" },
    { kind: "delete", deleteItems: false },
    { kind: "unknown" },
    { kind: "rename", label: "Uncategorized" },
  ])
    assert.throws(() => parseExecuteItemGroupActionRequest({ ...base, action }))
  assert.throws(() =>
    parseExecuteItemGroupActionRequest({
      ...base,
      snapshot: "",
      action: { kind: "delete", deleteItems: true },
    }),
  )
  assert.equal(
    parseExecuteItemGroupActionRequest({
      ...base,
      action: { kind: "rename", label: "  Receipts " },
    }).action.kind,
    "rename",
  )
})

describe("shared item group actions (DB)", { skip: !testDbUrl }, () => {
  after(async () => {
    await getDb().end()
  })
  const fixture = async () => {
    const userId = (
      await getDb().query<{ id: number }>(
        `INSERT INTO public.user_v1(username,is_anonymous) VALUES($1,true) RETURNING id`,
        [`bulk-${randomUUID()}`],
      )
    ).rows[0]!.id
    const workspace = await createWorkspaceForUser(userId, "bulk")
    const selection: ItemGroupSelection = {
      workspaceId: workspace.id,
      target: { kind: "uncategorized" },
    }
    const category = async (label: string) =>
      (
        await getDb().query<{ id: number }>(
          `INSERT INTO public.workspace_category_v1(workspace_id,label) VALUES($1,$2) RETURNING id`,
          [workspace.id, label],
        )
      ).rows[0]!.id
    const item = (description: string | null, categoryIds: number[] = []) =>
      createItemForUser(
        userId,
        {
          workspaceId: workspace.id,
          categoryIds,
          description,
          statusId: null,
          tagIds: [],
          timeDue: "2027-01-02T00:00:00Z",
          timeRemind: null,
        },
        { descriptionEmbedding: null, embeddingModel: null },
      )
    const run = async (
      target: ItemGroupSelection,
      action: Parameters<typeof executeItemGroupAction>[2],
    ) => {
      const preview = await previewItemGroup(userId, target)
      return executeItemGroupAction(userId, target, action, preview.snapshot)
    }
    return {
      userId,
      workspace,
      selection,
      category,
      item,
      run,
      cleanup: () => getDb().query(`DELETE FROM public.user_v1 WHERE id=$1`, [userId]),
    }
  }

  test("uncategorized rename reuses a category without a provider, preserves item data and leaves future captures free", async () => {
    const f = await fixture()
    try {
      const destination = await f.category("receipts")
      const text = await f.item("a note")
      const other = await f.item(null)
      const kept = await f.item("already organized", [destination])
      const preview = await previewItemGroup(f.userId, f.selection)
      assert.equal(preview.itemCount, 2)
      assert.equal(preview.textItemCount, 1)
      const apiKey = process.env.JINA_API_KEY
      delete process.env.JINA_API_KEY
      let result: ItemGroupActionResponse
      try {
        result = await executeItemGroupActionForItemsApp({
          userId: f.userId,
          selection: f.selection,
          snapshot: preview.snapshot,
          action: { kind: "rename", label: "receipts" },
        })
      } finally {
        if (apiKey !== undefined) process.env.JINA_API_KEY = apiKey
      }
      assert.equal(result.category!.id, destination)
      assert.equal(result.category!.itemCount, 3)
      for (const original of [text, other]) {
        const updated = result.items.find((row) => row.id === original.id)!
        assert.deepEqual(updated.categories, [{ id: destination, label: "receipts" }])
        for (const key of [
          "description",
          "timeDue",
          "timeRemind",
          "timeCreated",
          "status",
          "tags",
        ] as const)
          assert.deepEqual(updated[key], original[key])
      }
      assert.equal(
        (await listItemsByUser(f.userId, f.workspace.id)).find((row) => row.id === kept.id)!
          .timeModified,
        kept.timeModified,
      )
      assert.deepEqual((await f.item("later capture")).categories, [])
      await assert.rejects(
        executeItemGroupAction(
          f.userId,
          f.selection,
          { kind: "delete", deleteItems: true },
          preview.snapshot,
        ),
        ItemGroupConflictError,
      )
      assert.equal((await listItemsByUser(f.userId, f.workspace.id)).length, 4)
    } finally {
      await f.cleanup()
    }
  })

  test("new named category is created atomically and failed writes roll the whole assignment back", async () => {
    const f = await fixture()
    try {
      const original = await f.item("retain this")
      const preview = await previewItemGroup(f.userId, f.selection)
      await assert.rejects(
        executeItemGroupAction(
          f.userId,
          f.selection,
          { kind: "rename", label: "bad vector" },
          preview.snapshot,
          { vectorLiteral: "[1]", embeddingModel: "test" },
        ),
      )
      assert.equal(
        (
          await getDb().query(`SELECT 1 FROM public.workspace_category_v1 WHERE workspace_id=$1`, [
            f.workspace.id,
          ])
        ).rowCount,
        0,
      )
      assert.deepEqual((await listItemsByUser(f.userId, f.workspace.id))[0]!.categories, [])
      const result = await f.run(f.selection, { kind: "rename", label: "new group" })
      assert.equal(result.category!.label, "new group")
      assert.equal(result.items[0]!.id, original.id)
      assert.equal(result.category!.itemCount, 1)
    } finally {
      await f.cleanup()
    }
  })

  test("keep-items deletion preserves other memberships; legacy helpers use the same mutations", async () => {
    const f = await fixture()
    try {
      const a = await f.category("a")
      const b = await f.category("b")
      const shared = await f.item("shared", [a, b])
      const single = await f.item("single", [a])
      const selection: ItemGroupSelection = {
        workspaceId: f.workspace.id,
        target: { kind: "category", categoryId: a },
      }
      const preview = await previewItemGroup(f.userId, selection)
      assert.equal(preview.sharedItemCount, 1)
      const renamed = await updateCategoryLabelForWorkspace(
        f.userId,
        f.workspace.id,
        a,
        "renamed",
        null,
        null,
      )
      assert.equal(renamed!.itemCount, 2)
      await assert.rejects(
        executeItemGroupAction(
          f.userId,
          selection,
          { kind: "delete", deleteItems: false },
          preview.snapshot,
        ),
        ItemGroupConflictError,
      )
      assert.equal(await deleteCategoryForWorkspace(f.userId, f.workspace.id, a), true)
      const rows = await listItemsByUser(f.userId, f.workspace.id)
      assert.deepEqual(
        rows.find((row) => row.id === shared.id)!.categories.map((category) => category.id),
        [b],
      )
      assert.deepEqual(rows.find((row) => row.id === single.id)!.categories, [])
      assert.notEqual(rows.find((row) => row.id === shared.id)!.timeModified, shared.timeModified)
    } finally {
      await f.cleanup()
    }
  })

  test("destructive category and uncategorized actions delete only their members, including shared and non-text items", async () => {
    const f = await fixture()
    try {
      const a = await f.category("a")
      const b = await f.category("b")
      const shared = await f.item("shared", [a, b])
      const other = await f.item(null, [a])
      const kept = await f.item("keep", [b])
      const free = await f.item("free")
      const deleted = await f.run(
        { workspaceId: f.workspace.id, target: { kind: "category", categoryId: a } },
        { kind: "delete", deleteItems: true },
      )
      assert.deepEqual(deleted.deletedItemIds, [shared.id, other.id])
      assert.equal(deleted.removedCategoryId, a)
      const apiKey = process.env.JINA_API_KEY
      delete process.env.JINA_API_KEY
      try {
        assert.equal(
          await updateItemForItemsApp({
            userId: f.userId,
            itemId: shared.id,
            item: {
              workspaceId: f.workspace.id,
              description: "stale editor text",
              categoryIds: [],
              tagIds: [],
              statusId: null,
              timeDue: null,
              timeRemind: null,
            },
          }),
          null,
          "a deleted item's stale save must fail before requesting an embedding",
        )
      } finally {
        if (apiKey !== undefined) process.env.JINA_API_KEY = apiKey
      }
      assert.equal(
        (
          await getDb().query(
            `SELECT 1 FROM public.item_category_link_v1 WHERE item_id=ANY($1::int[])`,
            [[shared.id, other.id]],
          )
        ).rowCount,
        0,
      )
      assert.deepEqual(
        (await f.run(f.selection, { kind: "delete", deleteItems: true })).deletedItemIds,
        [free.id],
      )
      assert.deepEqual(
        (await listItemsByUser(f.userId, f.workspace.id)).map((row) => row.id),
        [kept.id],
      )
      assert.deepEqual((await f.item("new free item")).categories, [])
    } finally {
      await f.cleanup()
    }
  })

  test("selection and version changes invalidate previews and authorization never trusts supplied member IDs", async () => {
    const f = await fixture()
    try {
      const original = await f.item(null)
      const preview = await previewItemGroup(f.userId, f.selection)
      await f.item("new member")
      await assert.rejects(
        executeItemGroupAction(
          f.userId,
          f.selection,
          { kind: "delete", deleteItems: true },
          preview.snapshot,
        ),
        ItemGroupConflictError,
      )
      const fresh = await previewItemGroup(f.userId, f.selection)
      await getDb().query(`UPDATE public.workspace_item_v1 SET time_due='2028-01-01' WHERE id=$1`, [
        original.id,
      ])
      await assert.rejects(
        executeItemGroupAction(
          f.userId,
          f.selection,
          { kind: "delete", deleteItems: true },
          fresh.snapshot,
        ),
        ItemGroupConflictError,
      )
      await assert.rejects(
        previewItemGroup(f.userId + 1000000, f.selection),
        ItemGroupNotFoundError,
      )
      assert.equal((await listItemsByUser(f.userId, f.workspace.id)).length, 2)
    } finally {
      await f.cleanup()
    }
  })

  test("concurrent item writes cannot be overwritten by a confirmed group operation", async () => {
    const f = await fixture()
    const writer = new Client({ connectionString: testDbUrl })
    await writer.connect()
    let operation: Promise<unknown> | undefined
    try {
      const item = await f.item("before")
      const preview = await previewItemGroup(f.userId, f.selection)
      await writer.query("BEGIN")
      await writer.query(
        `UPDATE public.workspace_item_v1 SET description='concurrent edit' WHERE id=$1`,
        [item.id],
      )
      operation = executeItemGroupAction(
        f.userId,
        f.selection,
        { kind: "delete", deleteItems: true },
        preview.snapshot,
      )
      // Wait for a database-observed lock, rather than assuming a scheduling delay.
      let blocked = false
      for (let attempt = 0; attempt < 100 && !blocked; attempt++) {
        blocked =
          (
            await writer.query(
              `SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE 'SELECT n.id FROM public.workspace_item_v1%'`,
            )
          ).rowCount! > 0
        if (!blocked) await new Promise((resolve) => setTimeout(resolve, 5))
      }
      assert.equal(blocked, true, "bulk operation must wait on the ordinary writer's item lock")
      await writer.query("COMMIT")
      await assert.rejects(operation, ItemGroupConflictError)
      assert.equal(
        (await listItemsByUser(f.userId, f.workspace.id))[0]!.description,
        "concurrent edit",
      )
    } finally {
      await writer.query("ROLLBACK")
      await operation?.catch(() => undefined)
      await writer.end()
      await f.cleanup()
    }
  })

  test("existing users cannot preview or mutate another user's workspace or a category from another workspace", async () => {
    const owner = await fixture()
    const outsider = await fixture()
    try {
      const original = await owner.item("private item")
      const categoryId = await outsider.category("private category")
      const preview = await previewItemGroup(owner.userId, owner.selection)
      await assert.rejects(
        previewItemGroup(outsider.userId, owner.selection),
        ItemGroupNotFoundError,
      )
      await assert.rejects(
        executeItemGroupAction(
          outsider.userId,
          owner.selection,
          { kind: "delete", deleteItems: true },
          preview.snapshot,
        ),
        ItemGroupNotFoundError,
      )
      await assert.rejects(
        previewItemGroup(owner.userId, {
          workspaceId: owner.workspace.id,
          target: { kind: "category", categoryId },
        }),
        ItemGroupNotFoundError,
      )
      assert.equal((await listItemsByUser(owner.userId, owner.workspace.id))[0]!.id, original.id)
    } finally {
      await owner.cleanup()
      await outsider.cleanup()
    }
  })
})
