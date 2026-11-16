import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { after, describe, test } from "node:test"
import { Client } from "pg"
import type { ItemGroupSelection } from "../contracts/item-group-actions"
import type { ItemInput } from "../contracts/items-app"
import { getDb } from "../lib/db/postgres"
import {
  createCategoryForItemsApp,
  listCategoriesForItemsApp,
  mergeAnonymousItemsAppSession,
  parseCreateCategoryRequest,
} from "../services/items-app"
import {
  executeItemGroupActionForItemsApp,
  parsePreviewItemGroupRequest,
} from "../services/item-group-actions"
import { createItemForUser, listItemsByUser, parseItemInput, updateItemForUser } from "../sql/item"
import { executeItemGroupAction, previewItemGroup } from "../sql/item-groups"
import { ItemGroupConflictError, ItemGroupNotFoundError } from "../sql/item-group-errors"
import { createAnonymousUser } from "../sql/user/anonymous"
import { createWorkspaceForUser, listWorkspacesByUser } from "../sql/workspace"

const testDbUrl = process.env.DB_ITEMS_TEST_URL ?? process.env.DB_NOTES_TEST_URL
if (testDbUrl) process.env.DB_ITEMS_URL = testDbUrl

test("an item request names one category, and an old request's list files it in the first", () => {
  const base = { workspaceId: 1, description: "text" }
  assert.deepEqual(
    (({ categoryId, subcategoryId }) => ({ categoryId, subcategoryId }))(
      parseItemInput({ ...base, categoryId: 4, subcategoryId: "9" }),
    ),
    { categoryId: 4, subcategoryId: 9 },
  )
  assert.equal(parseItemInput(base).categoryId, null)
  assert.equal(parseItemInput(base).subcategoryId, null)
  assert.equal(parseItemInput({ ...base, categoryIds: [7, 3] }).categoryId, 7)
  assert.equal(parseItemInput({ ...base, categoryIds: [] }).categoryId, null)
  // The single field wins when a request carries both.
  assert.equal(parseItemInput({ ...base, categoryId: null, categoryIds: [7] }).categoryId, null)
  assert.throws(() => parseItemInput({ ...base, categoryId: 0 }))
  assert.throws(() => parseItemInput({ ...base, categoryIds: "7" }))
})

test("category and group requests accept a parent category and a subcategory target", () => {
  assert.deepEqual(parseCreateCategoryRequest({ userId: 1, workspaceId: 2, label: " Ideas " }), {
    userId: 1,
    workspaceId: 2,
    label: "ideas",
  })
  assert.equal(
    parseCreateCategoryRequest({ userId: 1, workspaceId: 2, label: "ideas", categoryId: 5 })
      .categoryId,
    5,
  )
  assert.throws(() =>
    parseCreateCategoryRequest({ userId: 1, workspaceId: 2, label: "x", categoryId: "none" }),
  )
  assert.deepEqual(
    parsePreviewItemGroupRequest({
      userId: 1,
      selection: { workspaceId: 2, target: { kind: "subcategory", subcategoryId: 9 } },
    }).selection.target,
    { kind: "subcategory", subcategoryId: 9 },
  )
  assert.throws(() =>
    parsePreviewItemGroupRequest({
      userId: 1,
      selection: { workspaceId: 2, target: { kind: "subcategory" } },
    }),
  )
})

describe("one category and one subcategory per item (DB)", { skip: !testDbUrl }, () => {
  const userIds: number[] = []
  const savedKey = process.env.JINA_API_KEY
  // Nothing here may need the embedding provider: items are written through the SQL
  // layer, and creating or renaming a subcategory requests no embedding.
  delete process.env.JINA_API_KEY
  const noEmbedding = { descriptionEmbedding: null, embeddingModel: null }

  after(async () => {
    if (savedKey !== undefined) process.env.JINA_API_KEY = savedKey
    if (!testDbUrl) return
    await getDb().query(`DELETE FROM public.user_v1 WHERE id=ANY($1::int[])`, [userIds])
    await getDb().end()
  })

  const fixture = async () => {
    const userId = (
      await getDb().query<{ id: number }>(
        `INSERT INTO public.user_v1(username,is_anonymous) VALUES($1,false) RETURNING id`,
        [`taxonomy-${randomUUID()}`],
      )
    ).rows[0]!.id
    userIds.push(userId)
    const workspace = await createWorkspaceForUser(userId, "personal")
    const category = async (label: string, workspaceId = workspace.id) =>
      (
        await getDb().query<{ id: number }>(
          `INSERT INTO public.workspace_category_v1(workspace_id,label) VALUES($1,$2) RETURNING id`,
          [workspaceId, label],
        )
      ).rows[0]!.id
    const subcategory = async (categoryId: number, label: string) =>
      (
        await createCategoryForItemsApp({
          userId,
          workspaceId: workspace.id,
          categoryId,
          label,
        })
      ).subcategory!.id
    const input = (values: Partial<ItemInput> = {}): ItemInput => ({
      workspaceId: workspace.id,
      categoryId: null,
      subcategoryId: null,
      statusId: null,
      tagIds: [],
      description: "text",
      timeDue: null,
      timeRemind: null,
      ...values,
    })
    const item = (values: Partial<ItemInput> = {}) =>
      createItemForUser(userId, input(values), noEmbedding)
    const update = (itemId: number, values: Partial<ItemInput> = {}) =>
      updateItemForUser(itemId, userId, input(values), null)
    const stored = async (itemId: number) =>
      (await listItemsByUser(userId, workspace.id)).find((row) => row.id === itemId)!
    const categories = async () =>
      (await listCategoriesForItemsApp({ userId, workspaceId: workspace.id })).categories
    const target = (value: ItemGroupSelection["target"]): ItemGroupSelection => ({
      workspaceId: workspace.id,
      target: value,
    })
    const run = async (
      selection: ItemGroupSelection,
      action: Parameters<typeof executeItemGroupAction>[2],
    ) => {
      const preview = await previewItemGroup(userId, selection)
      return executeItemGroupActionForItemsApp({
        userId,
        selection,
        action,
        snapshot: preview.snapshot,
      })
    }
    return {
      userId,
      workspace,
      category,
      subcategory,
      input,
      item,
      update,
      stored,
      categories,
      target,
      run,
    }
  }

  test("an item is filed in one category and one subcategory of that category", async () => {
    const f = await fixture()
    const work = await f.category("work")
    const home = await f.category("home")
    const ideas = await f.subcategory(work, "ideas")
    const chores = await f.subcategory(home, "chores")

    const filed = await f.item({ categoryId: work, subcategoryId: ideas })
    assert.deepEqual(filed.category, { id: work, label: "work" })
    assert.deepEqual(filed.subcategory, { id: ideas, label: "ideas" })

    // An item can sit directly in a category, or in none.
    assert.equal((await f.item({ categoryId: work })).subcategory, null)
    const unfiled = await f.item()
    assert.equal(unfiled.category, null)
    assert.equal(unfiled.subcategory, null)

    // A subcategory of another category, or one sent without a category, is not kept.
    assert.equal((await f.item({ categoryId: work, subcategoryId: chores })).subcategory, null)
    const orphan = await f.item({ subcategoryId: ideas })
    assert.equal(orphan.category, null)
    assert.equal(orphan.subcategory, null)

    // Moving to another category clears the subcategory left over from the old one.
    const moved = await f.update(filed.id, { categoryId: home, subcategoryId: ideas })
    assert.deepEqual(moved!.category, { id: home, label: "home" })
    assert.equal(moved!.subcategory, null)
    const refiled = await f.update(filed.id, { categoryId: home, subcategoryId: chores })
    assert.deepEqual(refiled!.subcategory, { id: chores, label: "chores" })
    const cleared = await f.update(filed.id)
    assert.equal(cleared!.category, null)
    assert.equal(cleared!.subcategory, null)
  })

  test("a category from another workspace or another user cannot file an item", async () => {
    const f = await fixture()
    const outsider = await fixture()
    const other = await createWorkspaceForUser(f.userId, "other")
    const elsewhere = await f.category("elsewhere", other.id)
    const foreign = await outsider.category("foreign")
    for (const categoryId of [elsewhere, foreign, 2_000_000_000])
      await assert.rejects(f.item({ categoryId }), {
        message: "Category was not found for this workspace.",
      })
    assert.deepEqual(await listItemsByUser(f.userId, f.workspace.id), [])
  })

  test("subcategories are created under a category and are unique within it", async () => {
    const f = await fixture()
    const outsider = await fixture()
    const work = await f.category("work")
    const home = await f.category("home")

    const created = await createCategoryForItemsApp({
      userId: f.userId,
      workspaceId: f.workspace.id,
      categoryId: work,
      label: "ideas",
    })
    assert.equal(created.category.id, work)
    assert.deepEqual(created.subcategory, {
      id: created.subcategory!.id,
      categoryId: work,
      label: "ideas",
      itemCount: 0,
      lastUsedAt: null,
    })
    // Asking again returns the same subcategory.
    assert.equal(await f.subcategory(work, "ideas"), created.subcategory!.id)
    // Two categories can each have a subcategory with the same name.
    const homeIdeas = await f.subcategory(home, "ideas")
    assert.notEqual(homeIdeas, created.subcategory!.id)
    await f.subcategory(work, "archive")

    assert.deepEqual(
      (await f.categories())
        .map((category) => [category.label, category.subcategories.map((entry) => entry.label)])
        .sort(),
      [
        ["home", ["ideas"]],
        ["work", ["archive", "ideas"]],
      ],
    )

    const request = { workspaceId: f.workspace.id, categoryId: work, label: "x" }
    // Another user's category, a missing parent, and a category of another workspace.
    await assert.rejects(
      createCategoryForItemsApp({ ...request, userId: outsider.userId }),
      /Category not found/,
    )
    await assert.rejects(
      createCategoryForItemsApp({ ...request, userId: f.userId, categoryId: 2_000_000_000 }),
      /Category not found/,
    )
    await assert.rejects(
      createCategoryForItemsApp({
        userId: outsider.userId,
        workspaceId: outsider.workspace.id,
        categoryId: work,
        label: "x",
      }),
      /Category not found/,
    )
    await assert.rejects(
      createCategoryForItemsApp({ ...request, userId: f.userId, label: "Uncategorized" }),
      /reserved/,
    )
  })

  test("a category counts every item filed in it, and a subcategory only its own", async () => {
    const f = await fixture()
    const work = await f.category("work")
    const ideas = await f.subcategory(work, "ideas")
    await f.subcategory(work, "empty")
    await f.item({ categoryId: work })
    const nested = await f.item({ categoryId: work, subcategoryId: ideas })
    await f.item()

    const record = (await f.categories()).find((category) => category.id === work)!
    assert.equal(record.itemCount, 2)
    assert.deepEqual(
      record.subcategories.map((entry) => [entry.label, entry.itemCount, entry.lastUsedAt]),
      [
        ["empty", 0, null],
        ["ideas", 1, nested.timeModified],
      ],
    )
  })

  test("a subcategory group renames and deletes without touching the rest of its category", async () => {
    const f = await fixture()
    const work = await f.category("work")
    const ideas = await f.subcategory(work, "ideas")
    const archive = await f.subcategory(work, "archive")
    const direct = await f.item({ categoryId: work, description: "direct" })
    const idea = await f.item({ categoryId: work, subcategoryId: ideas, description: "idea" })
    const old = await f.item({ categoryId: work, subcategoryId: archive, description: "old" })
    const selection = f.target({ kind: "subcategory", subcategoryId: ideas })

    const preview = await previewItemGroup(f.userId, selection)
    assert.equal(preview.label, "ideas")
    assert.deepEqual(preview.itemIds, [idea.id])
    assert.equal(preview.subcategoryCount, 0)

    // A name already used in this category is a conflict, not a merge.
    await assert.rejects(f.run(selection, { kind: "rename", label: "archive" }), (error) => {
      assert.ok(error instanceof ItemGroupConflictError)
      assert.match(error.message, /subcategory with that name already exists/)
      return true
    })
    const renamed = await f.run(selection, { kind: "rename", label: "Sparks" })
    assert.equal(renamed.category!.id, work)
    assert.deepEqual(renamed.category!.subcategories.map((entry) => entry.label).sort(), [
      "archive",
      "sparks",
    ])
    assert.deepEqual(renamed.items[0]!.subcategory, { id: ideas, label: "sparks" })
    assert.equal(renamed.removedSubcategoryId, null)

    // Keeping the items leaves them in the category, without a subcategory.
    const kept = await f.run(selection, { kind: "delete", deleteItems: false })
    assert.equal(kept.removedSubcategoryId, ideas)
    assert.equal(kept.removedCategoryId, null)
    assert.deepEqual(kept.deletedItemIds, [])
    assert.deepEqual(
      kept.category!.subcategories.map((entry) => entry.label),
      ["archive"],
    )
    const unnested = await f.stored(idea.id)
    assert.deepEqual(unnested.category, { id: work, label: "work" })
    assert.equal(unnested.subcategory, null)
    assert.notEqual(unnested.timeModified, idea.timeModified)

    // Deleting with items removes only the items filed in that subcategory.
    const removed = await f.run(f.target({ kind: "subcategory", subcategoryId: archive }), {
      kind: "delete",
      deleteItems: true,
    })
    assert.deepEqual(removed.deletedItemIds, [old.id])
    assert.equal(removed.removedSubcategoryId, archive)
    assert.deepEqual(
      (await listItemsByUser(f.userId, f.workspace.id)).map((row) => row.id).sort(),
      [direct.id, idea.id].sort(),
    )
    assert.equal((await f.stored(direct.id)).timeModified, direct.timeModified)
    await assert.rejects(previewItemGroup(f.userId, selection), ItemGroupNotFoundError)
  })

  test("a category group covers its subcategories and removes them with it", async () => {
    const f = await fixture()
    const work = await f.category("work")
    const home = await f.category("home")
    const ideas = await f.subcategory(work, "ideas")
    const chores = await f.subcategory(home, "chores")
    const direct = await f.item({ categoryId: work })
    const nested = await f.item({ categoryId: work, subcategoryId: ideas })
    const elsewhere = await f.item({ categoryId: home, subcategoryId: chores })
    const selection = f.target({ kind: "category", categoryId: work })

    const preview = await previewItemGroup(f.userId, selection)
    assert.deepEqual(preview.itemIds, [direct.id, nested.id])
    assert.equal(preview.subcategoryCount, 1)

    // A subcategory added after the preview changes what a delete would remove.
    await f.subcategory(work, "late")
    await assert.rejects(
      executeItemGroupAction(
        f.userId,
        selection,
        { kind: "delete", deleteItems: false },
        preview.snapshot,
      ),
      ItemGroupConflictError,
    )

    const result = await f.run(selection, { kind: "delete", deleteItems: false })
    assert.equal(result.removedCategoryId, work)
    assert.equal(result.category, null)
    for (const itemId of [direct.id, nested.id]) {
      const row = await f.stored(itemId)
      assert.equal(row.category, null)
      assert.equal(row.subcategory, null)
    }
    assert.deepEqual(
      (await f.categories()).map((category) => category.label),
      ["home"],
    )
    assert.equal(
      (
        await getDb().query(`SELECT 1 FROM public.workspace_subcategory_v1 WHERE category_id=$1`, [
          work,
        ])
      ).rowCount,
      0,
    )
    const untouched = await f.stored(elsewhere.id)
    assert.deepEqual(untouched.subcategory, { id: chores, label: "chores" })
    assert.equal(untouched.timeModified, elsewhere.timeModified)
  })

  test("an item filed while a category delete waits for its lock makes the delete a conflict", async () => {
    const f = await fixture()
    const work = await f.category("work")
    const existing = await f.item({ categoryId: work, description: "existing" })
    const selection = f.target({ kind: "category", categoryId: work })
    const preview = await previewItemGroup(f.userId, selection)
    const writer = new Client({ connectionString: testDbUrl })
    await writer.connect()
    let operation: Promise<unknown> | undefined
    try {
      // The uncommitted insert holds a key-share lock on the category row, so the
      // delete reads its items without this one and then waits to lock the category.
      await writer.query("BEGIN")
      const late = (
        await writer.query<{ id: number }>(
          `INSERT INTO public.workspace_item_v1(workspace_id,category_id,description)
           VALUES($1,$2,'late') RETURNING id`,
          [f.workspace.id, work],
        )
      ).rows[0]!.id
      await writer.query("SELECT 1 FROM pg_stat_activity WHERE datname=current_database()")
      operation = executeItemGroupAction(
        f.userId,
        selection,
        { kind: "delete", deleteItems: false },
        preview.snapshot,
      )
      let blocked = false
      for (let attempt = 0; attempt < 100 && !blocked; attempt++) {
        await writer.query("SELECT pg_stat_clear_snapshot()")
        blocked =
          (
            await writer.query(
              `SELECT 1 FROM pg_stat_activity WHERE datname=current_database()
               AND wait_event_type='Lock' AND pg_backend_pid()=ANY(pg_blocking_pids(pid))
               AND query LIKE 'SELECT id,label,xmin::text AS revision FROM public.workspace_category_v1%'`,
            )
          ).rowCount! > 0
        if (!blocked) await new Promise((resolve) => setTimeout(resolve, 5))
      }
      assert.equal(blocked, true, "the delete must wait on the writer's category lock")
      await writer.query("COMMIT")

      await assert.rejects(operation, (error) => {
        assert.ok(error instanceof ItemGroupConflictError)
        assert.match(error.message, /This group changed/)
        return true
      })
      // Nothing was removed or unfiled.
      assert.deepEqual(
        (await f.categories()).map((category) => category.id),
        [work],
      )
      for (const itemId of [existing.id, late])
        assert.deepEqual((await f.stored(itemId)).category, { id: work, label: "work" })
    } finally {
      await writer.query("ROLLBACK")
      await operation?.catch(() => undefined)
      await writer.end()
    }
  })

  test("naming the uncategorized group files only unfiled items", async () => {
    const f = await fixture()
    const work = await f.category("work")
    const ideas = await f.subcategory(work, "ideas")
    const nested = await f.item({ categoryId: work, subcategoryId: ideas })
    const loose = await f.item()

    const result = await f.run(f.target({ kind: "uncategorized" }), {
      kind: "rename",
      label: "work",
    })
    assert.equal(result.category!.id, work)
    assert.deepEqual(
      result.items.map((row) => row.id),
      [loose.id],
    )
    assert.deepEqual((await f.stored(loose.id)).category, { id: work, label: "work" })
    assert.equal((await f.stored(loose.id)).subcategory, null)
    assert.deepEqual((await f.stored(nested.id)).subcategory, { id: ideas, label: "ideas" })
  })

  test("a subcategory of another user's workspace is not a group", async () => {
    const f = await fixture()
    const outsider = await fixture()
    const theirs = await outsider.subcategory(await outsider.category("private"), "secret")
    await assert.rejects(
      previewItemGroup(f.userId, f.target({ kind: "subcategory", subcategoryId: theirs })),
      ItemGroupNotFoundError,
    )
  })

  test("signing in keeps an anonymous item's category and subcategory, matched by label", async () => {
    const f = await fixture()
    const realWork = await f.category("work")
    const realIdeas = await f.subcategory(realWork, "ideas")
    const anonymous = await createAnonymousUser()
    userIds.push(anonymous.id)
    const anonymousWorkspace = (await listWorkspacesByUser(anonymous.id))[0]!
    // The visitor's workspace has the same name, so its contents merge into the account's.
    await getDb().query(`UPDATE public.user_workspace_v1 SET label='personal' WHERE id=$1`, [
      anonymousWorkspace.id,
    ])
    const work = await f.category("work", anonymousWorkspace.id)
    const trips = await f.category("trips", anonymousWorkspace.id)
    const nest = async (categoryId: number, label: string) =>
      (
        await getDb().query<{ id: number }>(
          `INSERT INTO public.workspace_subcategory_v1(category_id,label) VALUES($1,$2) RETURNING id`,
          [categoryId, label],
        )
      ).rows[0]!.id
    const ideas = await nest(work, "ideas")
    const drafts = await nest(work, "drafts")
    const japan = await nest(trips, "japan")
    const create = (description: string, categoryId: number | null, subcategoryId: number | null) =>
      createItemForUser(
        anonymous.id,
        f.input({ workspaceId: anonymousWorkspace.id, description, categoryId, subcategoryId }),
        noEmbedding,
      )
    await create("existing subcategory", work, ideas)
    await create("new subcategory", work, drafts)
    await create("new category", trips, japan)
    await create("category only", trips, null)
    await create("unfiled", null, null)

    await mergeAnonymousItemsAppSession({ anonUserId: anonymous.id, realUserId: f.userId })

    const merged = Object.fromEntries(
      (await listItemsByUser(f.userId, f.workspace.id)).map((row) => [
        row.description,
        [row.category?.label ?? null, row.subcategory?.label ?? null],
      ]),
    )
    assert.deepEqual(merged, {
      "existing subcategory": ["work", "ideas"],
      "new subcategory": ["work", "drafts"],
      "new category": ["trips", "japan"],
      "category only": ["trips", null],
      unfiled: [null, null],
    })
    // The account's own rows are reused rather than duplicated.
    const filed = (await listItemsByUser(f.userId, f.workspace.id)).find(
      (row) => row.description === "existing subcategory",
    )!
    assert.equal(filed.category!.id, realWork)
    assert.equal(filed.subcategory!.id, realIdeas)
    assert.deepEqual(
      (await f.categories())
        .map((category) => [category.label, category.subcategories.map((entry) => entry.label)])
        .sort(),
      [
        ["trips", ["japan"]],
        ["work", ["drafts", "ideas"]],
      ],
    )
  })
})
