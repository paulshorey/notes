import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { after, describe, test } from "node:test"
import { setTimeout } from "node:timers/promises"
import { Client, Pool } from "pg"
import type { ItemGroupSelection } from "../contracts/item-group-actions"
import { getDb } from "../lib/db/postgres"
import { executeItemGroupActionForItemsApp } from "../services/item-group-actions"
import {
  deleteItemForItemsApp,
  listWorkspacesForItemsApp,
  updateItemForItemsApp,
} from "../services/items-app"
import { deleteCategoryForWorkspace, listCategoriesByWorkspace } from "../sql/category"
import {
  createItemForUser,
  deleteItemForUser,
  findWorkspaceIdByItem,
  listItemsByUser,
} from "../sql/item"
import { ItemGroupConflictError, ItemGroupNotFoundError } from "../sql/item-group-errors"
import { previewItemGroup } from "../sql/item-groups"
import { createStatusForWorkspace, listStatusesByWorkspace } from "../sql/status"
import { listTagsByWorkspace } from "../sql/tag"
import {
  createWorkspaceForUser,
  deleteWorkspaceForUser,
  listWorkspacesByUser,
  lockUserWorkspaces,
} from "../sql/workspace"
import { pruneEmptyWorkspaceTaxonomy } from "../sql/workspace-cleanup"

const testDbUrl = process.env.DB_ITEMS_TEST_URL ?? process.env.DB_NOTES_TEST_URL
if (testDbUrl) process.env.DB_ITEMS_URL = testDbUrl

describe("workspace content moves and cleanup (DB)", { skip: !testDbUrl }, () => {
  after(() => getDb().end())

  const user = async () =>
    (
      await getDb().query<{ id: number }>(
        "INSERT INTO public.user_v1(username,is_anonymous) VALUES ($1,true) RETURNING id",
        [`workspace-move-${randomUUID()}`],
      )
    ).rows[0]!.id

  const withUser = async (work: (userId: number) => Promise<void>) => {
    const userId = await user()
    try {
      await work(userId)
    } finally {
      await getDb().query("DELETE FROM public.user_v1 WHERE id=$1", [userId])
    }
  }

  const category = async (workspaceId: number, label: string) =>
    (
      await getDb().query<{ id: number }>(
        "INSERT INTO public.workspace_category_v1(workspace_id,label) VALUES ($1,$2) RETURNING id",
        [workspaceId, label],
      )
    ).rows[0]!.id

  const subcategory = async (categoryId: number, label: string) =>
    (
      await getDb().query<{ id: number }>(
        "INSERT INTO public.workspace_subcategory_v1(category_id,label) VALUES ($1,$2) RETURNING id",
        [categoryId, label],
      )
    ).rows[0]!.id

  const tag = async (workspaceId: number, label: string) =>
    (
      await getDb().query<{ id: number }>(
        "INSERT INTO public.workspace_tag_v1(workspace_id,label) VALUES ($1,$2) RETURNING id",
        [workspaceId, label],
      )
    ).rows[0]!.id

  const item = async (
    userId: number,
    workspaceId: number,
    {
      categoryId = null,
      subcategoryId = null,
      statusId = null,
      tagIds = [],
      description = "workspace move",
    }: Partial<Parameters<typeof createItemForUser>[1]> = {},
  ) =>
    createItemForUser(
      userId,
      {
        workspaceId,
        categoryId,
        subcategoryId,
        statusId,
        tagIds,
        description,
        timeDue: "2027-01-02T00:00:00Z",
        timeRemind: "2027-01-01T00:00:00Z",
      },
      {
        descriptionEmbedding:
          "[" + Array.from({ length: 1024 }, (_, index) => (index === 0 ? 1 : 0)).join(",") + "]",
        embeddingModel: "move-test-model",
      },
    )

  const move = async (
    userId: number,
    selection: ItemGroupSelection,
    destinationWorkspaceId: number,
  ) => {
    const preview = await previewItemGroup(userId, selection)
    return executeItemGroupActionForItemsApp({
      userId,
      selection,
      snapshot: preview.snapshot,
      action: { kind: "move-to-workspace", destinationWorkspaceId },
    })
  }

  test("moving a single item preserves its properties and reuses labels in the correct hierarchy", () =>
    withUser(async (userId) => {
      const source = await createWorkspaceForUser(userId, "source")
      const destination = await createWorkspaceForUser(userId, "destination")
      const keepWorkspace = await createWorkspaceForUser(userId, "unrelated empty workspace")
      const oldParent = await category(source.id, "parent")
      const oldChild = await subcategory(oldParent, "child")
      const unusedCategory = await category(source.id, "unused")
      const newParent = await category(destination.id, "parent")
      const newChild = await subcategory(newParent, "child")
      const anotherParent = await category(destination.id, "other parent")
      const unrelatedChild = await subcategory(anotherParent, "child")
      const oldTag = await tag(source.id, "shared")
      const newTag = await tag(destination.id, "shared")
      const extraTag = await tag(source.id, "only source")
      const oldStatus = (await createStatusForWorkspace(userId, source.id, "doing"))!
      const newStatus = (await createStatusForWorkspace(userId, destination.id, "doing"))!
      const moved = await item(userId, source.id, {
        categoryId: oldParent,
        subcategoryId: oldChild,
        statusId: oldStatus.id,
        tagIds: [oldTag, extraTag],
        description: "carry everything",
      })
      const kept = await item(userId, source.id, { categoryId: oldParent, tagIds: [oldTag] })
      const result = await move(
        userId,
        {
          workspaceId: source.id,
          target: { kind: "item", itemId: moved.id },
        },
        destination.id,
      )

      assert.deepEqual(result.workspaceMove, {
        destinationWorkspaceId: destination.id,
        itemIds: [moved.id],
      })
      assert.equal(result.cleanup?.workspaceRemoved, false)
      assert.deepEqual(
        (await listItemsByUser(userId, source.id)).map(({ id }) => id),
        [kept.id],
      )
      const [saved] = await listItemsByUser(userId, destination.id)
      assert.equal(saved?.id, moved.id)
      assert.equal(saved.uid, moved.uid)
      assert.equal(await findWorkspaceIdByItem(userId, moved.uid), destination.id)
      assert.equal(await deleteItemForUser(moved.id, userId, source.id), false)
      await assert.rejects(
        deleteItemForItemsApp({ itemId: moved.id, userId, workspaceId: source.id }),
        ItemGroupConflictError,
      )
      await assert.rejects(
        updateItemForItemsApp({
          userId,
          itemId: moved.id,
          item: {
            workspaceId: source.id,
            description: "stale editor",
            categoryId: oldParent,
            subcategoryId: oldChild,
            statusId: oldStatus.id,
            tagIds: [oldTag],
            timeDue: null,
            timeRemind: null,
          },
        }),
        ItemGroupConflictError,
      )
      assert.equal(saved.description, moved.description)
      assert.equal(saved.timeDue, moved.timeDue)
      assert.equal(saved.timeRemind, moved.timeRemind)
      assert.equal(saved.timeCreated, moved.timeCreated)
      assert.equal(saved.timeModified, moved.timeModified)
      assert.equal(saved.category?.id, newParent)
      assert.equal(saved.subcategory?.id, newChild)
      assert.notEqual(saved.subcategory?.id, unrelatedChild)
      assert.equal(saved.status?.id, newStatus.id)
      assert.equal(saved.tags.find(({ label }) => label === "shared")?.id, newTag)
      assert.deepEqual(saved.tags.map(({ label }) => label).sort(), ["only source", "shared"])
      const embedding = await getDb().query(
        "SELECT embedding_model, description_embedding IS NOT NULL AS embedded FROM public.workspace_item_v1 WHERE id=$1",
        [moved.id],
      )
      assert.deepEqual(embedding.rows, [{ embedding_model: "move-test-model", embedded: true }])
      const sourceCategories = await listCategoriesByWorkspace(userId, source.id)
      assert.deepEqual(
        sourceCategories.map(({ id }) => id),
        [oldParent],
      )
      assert.ok(!sourceCategories.some(({ id }) => id === unusedCategory))
      assert.deepEqual(sourceCategories[0]?.subcategories, [])
      assert.deepEqual(
        (await listTagsByWorkspace(userId, source.id)).map(({ id }) => id),
        [oldTag],
      )
      assert.deepEqual(await listStatusesByWorkspace(userId, source.id), [])
      assert.ok(
        (await listWorkspacesForItemsApp({ userId })).workspaces.some(
          ({ id }) => id === keepWorkspace.id,
        ),
      )
      assert.deepEqual(
        await listStatusesByWorkspace(userId, source.id),
        [],
        "bootstrap leaves cleaned taxonomy empty",
      )
    }))

  test("moving a category moves every item kind, creates missing vocabulary, and removes the emptied workspace", () =>
    withUser(async (userId) => {
      const source = await createWorkspaceForUser(userId, "source")
      const destination = await createWorkspaceForUser(userId, "destination")
      const parent = await category(source.id, "receipts")
      const child = await subcategory(parent, "travel")
      const status = (await createStatusForWorkspace(userId, source.id, "verify"))!
      const tagId = await tag(source.id, "expense")
      const note = await item(userId, source.id, { categoryId: parent })
      const task = await item(userId, source.id, {
        categoryId: parent,
        subcategoryId: child,
        description: null,
        statusId: status.id,
        tagIds: [tagId],
      })

      const selection: ItemGroupSelection = {
        workspaceId: source.id,
        target: { kind: "category", categoryId: parent },
      }
      await withUser(async (anotherUserId) => {
        const other = await createWorkspaceForUser(anotherUserId, "private")
        await assert.rejects(move(userId, selection, other.id), ItemGroupNotFoundError)
        await assert.rejects(previewItemGroup(anotherUserId, selection), ItemGroupNotFoundError)
      })
      const stale = await previewItemGroup(userId, selection)
      const late = await item(userId, source.id, { categoryId: parent })
      await assert.rejects(
        executeItemGroupActionForItemsApp({
          userId,
          selection,
          snapshot: stale.snapshot,
          action: { kind: "move-to-workspace", destinationWorkspaceId: destination.id },
        }),
        ItemGroupConflictError,
      )
      assert.deepEqual(await listItemsByUser(userId, destination.id), [])

      const result = await move(userId, selection, destination.id)
      assert.deepEqual(result.workspaceMove?.itemIds, [note.id, task.id, late.id])
      assert.equal(result.cleanup?.workspaceRemoved, true)
      assert.deepEqual(
        (await listWorkspacesByUser(userId)).map(({ id }) => id),
        [destination.id],
      )
      const saved = (await listItemsByUser(userId, destination.id)).find(
        ({ id }) => id === task.id,
      )!
      assert.equal(saved.category?.label, "receipts")
      assert.equal(saved.subcategory?.label, "travel")
      assert.equal(saved.status?.label, "verify")
      const statuses = await listStatusesByWorkspace(userId, destination.id)
      assert.equal(statuses.find(({ id }) => id === saved.status?.id)?.position, status.position)
      assert.deepEqual(
        saved.tags.map(({ label }) => label),
        ["expense"],
      )
    }))

  test("creates a destination from its name and moves a group into it", () =>
    withUser(async (userId) => {
      const source = await createWorkspaceForUser(userId, "source")
      const parent = await category(source.id, "parent")
      const child = await subcategory(parent, "child")
      const original = await item(userId, source.id, { categoryId: parent, subcategoryId: child })
      const selection: ItemGroupSelection = {
        workspaceId: source.id,
        target: { kind: "category", categoryId: parent },
      }
      const action = {
        kind: "move-to-workspace",
        destinationWorkspaceLabel: "  New Destination ",
      } as const
      const initial = await previewItemGroup(userId, selection)
      const late = await item(userId, source.id, { categoryId: parent })
      await assert.rejects(
        executeItemGroupActionForItemsApp({
          userId,
          selection,
          action,
          snapshot: initial.snapshot,
        }),
        ItemGroupConflictError,
      )
      assert.deepEqual(
        (await listWorkspacesByUser(userId)).map(({ label }) => label),
        ["source"],
      )

      const { snapshot } = await previewItemGroup(userId, selection)
      await assert.rejects(
        executeItemGroupActionForItemsApp({
          userId,
          selection,
          snapshot,
          action: { ...action, destinationWorkspaceId: source.id },
        }),
        /Choose one destination workspace/,
      )
      await assert.rejects(
        executeItemGroupActionForItemsApp({
          userId,
          selection,
          snapshot,
          action: { ...action, destinationWorkspaceLabel: "source" },
        }),
        /A workspace with that name already exists/,
      )
      const result = await executeItemGroupActionForItemsApp({
        userId,
        selection,
        action,
        snapshot,
      })

      const [destination] = await listWorkspacesByUser(userId)
      assert.equal(destination?.label, "new destination")
      assert.deepEqual(result.workspaceMove, {
        destinationWorkspaceId: destination.id,
        itemIds: [original.id, late.id],
      })
      assert.equal(result.cleanup?.workspaceRemoved, true)
      const items = await listItemsByUser(userId, destination.id)
      assert.equal(items.find(({ uid }) => uid === original.uid)?.subcategory?.label, "child")
    }))

  test("individual deletion prunes only empty taxonomy and removes an empty workspace", () =>
    withUser(async (userId) => {
      const source = await createWorkspaceForUser(userId, "source")
      const parent = await category(source.id, "parent")
      const child = await subcategory(parent, "child")
      const status = (await createStatusForWorkspace(userId, source.id, "doing"))!
      const tagId = await tag(source.id, "shared")
      const retained = await item(userId, source.id, { categoryId: parent, tagIds: [tagId] })
      const removed = await item(userId, source.id, {
        categoryId: parent,
        subcategoryId: child,
        statusId: status.id,
        tagIds: [tagId],
      })
      assert.equal(await deleteItemForUser(removed.id, userId), true)
      assert.equal((await listCategoriesByWorkspace(userId, source.id))[0]?.id, parent)
      assert.deepEqual((await listCategoriesByWorkspace(userId, source.id))[0]?.subcategories, [])
      assert.deepEqual(await listStatusesByWorkspace(userId, source.id), [])
      assert.deepEqual(
        (await listTagsByWorkspace(userId, source.id)).map(({ id }) => id),
        [tagId],
      )
      assert.equal(await deleteItemForUser(retained.id, userId), true)
      const workspaces = await listWorkspacesByUser(userId)
      assert.equal(workspaces.length, 1)
      assert.notEqual(workspaces[0]?.id, source.id)
    }))

  test("explicit workspace deletion preserves the last workspace after concurrent cleanup", () =>
    withUser(async (userId) => {
      const retained = await createWorkspaceForUser(userId, "other workspace")
      const removed = await createWorkspaceForUser(userId, "source")
      const pool = new Pool({ connectionString: testDbUrl })
      const cleanup = await pool.connect()
      try {
        await cleanup.query("BEGIN ISOLATION LEVEL REPEATABLE READ")
        await lockUserWorkspaces(cleanup, userId)
        const deletion = deleteWorkspaceForUser(userId, retained.id)
        try {
          let waiting = false
          for (let attempt = 0; attempt < 300 && !waiting; attempt++) {
            const { rows } = await cleanup.query<{ waiting: boolean }>(
              `SELECT EXISTS (
                SELECT 1 FROM pg_stat_activity WHERE pg_backend_pid()=ANY(pg_blocking_pids(pid))
              ) AS waiting`,
            )
            waiting = rows[0]!.waiting
            if (!waiting) await setTimeout(10)
          }
          assert.ok(waiting, "explicit deletion should wait for cleanup's workspace locks")
          assert.equal(await pruneEmptyWorkspaceTaxonomy(cleanup, userId, removed.id), true)
          await cleanup.query("COMMIT")
        } finally {
          await cleanup.query("ROLLBACK")
        }
        assert.equal(await deletion, false)
        assert.deepEqual(
          (await listWorkspacesByUser(userId)).map(({ id }) => id),
          [retained.id],
        )
      } finally {
        cleanup.release()
        await pool.end()
      }
    }))

  test("deleting an empty category cleans its source workspace and preserves other workspaces", () =>
    withUser(async (userId) => {
      const source = await createWorkspaceForUser(userId, "source")
      const retained = await createWorkspaceForUser(userId, "other workspace")
      const empty = await category(source.id, "unused")
      assert.equal(await deleteCategoryForWorkspace(userId, source.id, empty), true)
      assert.deepEqual(
        (await listWorkspacesByUser(userId)).map(({ id }) => id),
        [retained.id],
      )
    }))

  test("cleanup rolls back when a tag gained an item outside its snapshot", () =>
    withUser(async (userId) => {
      const workspace = await createWorkspaceForUser(userId, "source")
      const tagId = await tag(workspace.id, "concurrent tag")
      const retained = await item(userId, workspace.id)
      const removed = await item(userId, workspace.id)
      const writer = new Client({ connectionString: testDbUrl })
      await writer.connect()
      const cleanup = await getDb().connect()
      try {
        await cleanup.query("BEGIN ISOLATION LEVEL REPEATABLE READ")
        await lockUserWorkspaces(cleanup, userId)
        await writer.query(
          "INSERT INTO public.item_tag_link_v1(workspace_id,item_id,tag_id) VALUES ($1,$2,$3)",
          [workspace.id, retained.id, tagId],
        )
        await cleanup.query("DELETE FROM public.workspace_item_v1 WHERE id=$1", [removed.id])
        await assert.rejects(pruneEmptyWorkspaceTaxonomy(cleanup, userId, workspace.id), {
          code: "40001",
        })
      } finally {
        await cleanup.query("ROLLBACK")
        cleanup.release()
        await writer.end()
      }
      const items = await listItemsByUser(userId, workspace.id)
      assert.equal(items.find(({ id }) => id === retained.id)?.tags[0]?.id, tagId)
      assert.ok(items.some(({ id }) => id === removed.id))
    }))
})
