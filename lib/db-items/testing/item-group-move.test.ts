import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { after, describe, test } from "node:test"
import type { ItemGroupAction, ItemGroupSelection } from "../contracts/item-group-actions"
import { getDb } from "../lib/db/postgres"
import { listCategoriesForItemsApp } from "../services/items-app"
import {
  executeItemGroupActionForItemsApp,
  parseExecuteItemGroupActionRequest,
} from "../services/item-group-actions"
import { createItemForUser, listItemsByUser } from "../sql/item"
import { previewItemGroup } from "../sql/item-groups"
import { ItemGroupConflictError, ItemGroupNotFoundError } from "../sql/item-group-errors"
import { createWorkspaceForUser } from "../sql/workspace"

const testDbUrl = process.env.DB_ITEMS_TEST_URL ?? process.env.DB_NOTES_TEST_URL
if (testDbUrl) process.env.DB_ITEMS_URL = testDbUrl

test("a move request names a destination that fits its target", () => {
  const request = (target: unknown, action: unknown) =>
    parseExecuteItemGroupActionRequest({
      userId: 1,
      selection: { workspaceId: 1, target },
      snapshot: "a".repeat(64),
      action,
    })
  const subcategory = { kind: "subcategory", subcategoryId: 5 }
  const category = { kind: "category", categoryId: 3 }
  assert.deepEqual(request(subcategory, { kind: "move", categoryId: 4 }).action, {
    kind: "move",
    categoryId: 4,
  })
  // A subcategory with no destination becomes a category.
  assert.deepEqual(request(subcategory, { kind: "move", categoryId: null }).action, {
    kind: "move",
    categoryId: null,
  })
  assert.deepEqual(request(category, { kind: "move", categoryId: 4 }).action, {
    kind: "move",
    categoryId: 4,
  })
  for (const [target, action] of [
    // A category is already at the top level, and cannot contain itself.
    [category, { kind: "move", categoryId: null }],
    [category, { kind: "move", categoryId: 3 }],
    // Unfiled items are filed by naming a category, not by moving a group.
    [{ kind: "uncategorized" }, { kind: "move", categoryId: 4 }],
    [subcategory, { kind: "move" }],
    [subcategory, { kind: "move", categoryId: "4" }],
    [subcategory, { kind: "move", categoryId: 0 }],
  ])
    assert.throws(() => request(target, action), JSON.stringify([target, action]))
})

describe("moving a group within the hierarchy (DB)", { skip: !testDbUrl }, () => {
  const userIds: number[] = []
  const savedKey = process.env.JINA_API_KEY
  // Reorganizing never asks the embedding provider for anything.
  delete process.env.JINA_API_KEY

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
        [`move-${randomUUID()}`],
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
        await getDb().query<{ id: number }>(
          `INSERT INTO public.workspace_subcategory_v1(category_id,label) VALUES($1,$2) RETURNING id`,
          [categoryId, label],
        )
      ).rows[0]!.id
    const item = (
      description: string,
      categoryId: number | null = null,
      subcategoryId: number | null = null,
    ) =>
      createItemForUser(
        userId,
        {
          workspaceId: workspace.id,
          categoryId,
          subcategoryId,
          statusId: null,
          tagIds: [],
          description,
          timeDue: null,
          timeRemind: null,
        },
        { descriptionEmbedding: null, embeddingModel: null },
      )
    const run = async (target: ItemGroupSelection["target"], action: ItemGroupAction) => {
      const selection = { workspaceId: workspace.id, target }
      const preview = await previewItemGroup(userId, selection)
      return executeItemGroupActionForItemsApp({
        userId,
        selection,
        action,
        snapshot: preview.snapshot,
      })
    }
    /** `label: [direct item texts]` and `label › sub: [item texts]`, sorted. */
    const tree = async () => {
      const items = await listItemsByUser(userId, workspace.id)
      const { categories } = await listCategoriesForItemsApp({ userId, workspaceId: workspace.id })
      const texts = (categoryId: number | null, subcategoryId: number | null) =>
        items
          .filter(
            (row) =>
              (row.category?.id ?? null) === categoryId &&
              (row.subcategory?.id ?? null) === subcategoryId,
          )
          .map((row) => row.description)
          .sort()
      const lines = [`(none): ${texts(null, null).join(",")}`]
      for (const entry of categories) {
        lines.push(`${entry.label}: ${texts(entry.id, null).join(",")}`)
        for (const nested of entry.subcategories)
          lines.push(`${entry.label} › ${nested.label}: ${texts(entry.id, nested.id).join(",")}`)
      }
      // Every item is filed somewhere this listing shows.
      assert.equal(
        lines
          .join("\n")
          .split(/[:,]\s?/)
          .filter((part) => /^n\d/.test(part)).length,
        items.length,
      )
      return lines.sort()
    }
    return { userId, workspace, category, subcategory, item, run, tree }
  }

  test("a subcategory moves to another category and takes its items along", async () => {
    const f = await fixture()
    const work = await f.category("work")
    const home = await f.category("home")
    const ideas = await f.subcategory(work, "ideas")
    const direct = await f.item("n1", work)
    const nested = await f.item("n2", work, ideas)
    const elsewhere = await f.item("n3", home)

    const result = await f.run(
      { kind: "subcategory", subcategoryId: ideas },
      {
        kind: "move",
        categoryId: home,
      },
    )

    assert.deepEqual(await f.tree(), ["(none): ", "home › ideas: n2", "home: n3", "work: n1"])
    // The subcategory row is the same row: its id and its items' subcategory are kept.
    assert.equal(result.category!.id, home)
    assert.deepEqual(
      result.category!.subcategories.map((entry) => [entry.id, entry.itemCount]),
      [[ideas, 1]],
    )
    assert.equal(result.removedSubcategoryId, null)
    assert.equal(result.removedCategoryId, null)
    assert.deepEqual(result.deletedItemIds, [])
    assert.deepEqual(
      result.items.map((row) => [row.id, row.category?.id, row.subcategory?.id]),
      [[nested.id, home, ideas]],
    )
    // Notes outside the moved group are not touched.
    const rows = await listItemsByUser(f.userId, f.workspace.id)
    for (const untouched of [direct, elsewhere])
      assert.equal(
        rows.find((row) => row.id === untouched.id)!.timeModified,
        untouched.timeModified,
      )
  })

  test("a subcategory does not move onto an existing name, into its own category, or out of its workspace", async () => {
    const f = await fixture()
    const outsider = await fixture()
    const work = await f.category("work")
    const home = await f.category("home")
    const ideas = await f.subcategory(work, "ideas")
    await f.subcategory(home, "ideas")
    await f.item("n1", work, ideas)
    const before = await f.tree()
    const target = { kind: "subcategory" as const, subcategoryId: ideas }

    await assert.rejects(f.run(target, { kind: "move", categoryId: home }), (error) => {
      assert.ok(error instanceof ItemGroupConflictError)
      assert.match(error.message, /subcategory with that name already exists/)
      return true
    })
    await assert.rejects(f.run(target, { kind: "move", categoryId: work }), ItemGroupConflictError)
    const other = await createWorkspaceForUser(f.userId, "other")
    for (const categoryId of [
      await f.category("elsewhere", other.id),
      await outsider.category("foreign"),
      2_000_000_000,
    ])
      await assert.rejects(f.run(target, { kind: "move", categoryId }), ItemGroupNotFoundError)
    assert.deepEqual(await f.tree(), before)
  })

  test("a subcategory becomes a category of the same name with its items", async () => {
    const f = await fixture()
    const work = await f.category("work")
    const ideas = await f.subcategory(work, "ideas")
    await f.subcategory(work, "archive")
    await f.item("n1", work)
    const nested = await f.item("n2", work, ideas)

    const result = await f.run(
      { kind: "subcategory", subcategoryId: ideas },
      {
        kind: "move",
        categoryId: null,
      },
    )

    assert.deepEqual(await f.tree(), ["(none): ", "ideas: n2", "work › archive: ", "work: n1"])
    assert.equal(result.category!.label, "ideas")
    assert.equal(result.category!.itemCount, 1)
    assert.deepEqual(result.category!.subcategories, [])
    assert.equal(result.removedSubcategoryId, ideas)
    assert.deepEqual(
      result.items.map((row) => [row.id, row.category?.label, row.subcategory]),
      [[nested.id, "ideas", null]],
    )
    assert.equal(
      (await getDb().query(`SELECT 1 FROM public.workspace_subcategory_v1 WHERE id=$1`, [ideas]))
        .rowCount,
      0,
    )
  })

  test("a subcategory does not become a category when that name is taken", async () => {
    const f = await fixture()
    const work = await f.category("work")
    await f.category("ideas")
    const ideas = await f.subcategory(work, "ideas")
    await f.item("n1", work, ideas)
    const before = await f.tree()

    await assert.rejects(
      f.run({ kind: "subcategory", subcategoryId: ideas }, { kind: "move", categoryId: null }),
      (error) => {
        assert.ok(error instanceof ItemGroupConflictError)
        assert.match(error.message, /category with that name already exists/)
        return true
      },
    )
    assert.deepEqual(await f.tree(), before)
  })

  test("a category moves into another and becomes its subcategory with its items", async () => {
    const f = await fixture()
    const work = await f.category("work")
    const trips = await f.category("trips")
    const existing = await f.subcategory(work, "ideas")
    const first = await f.item("n1", trips)
    const second = await f.item("n2", trips)
    const kept = await f.item("n3", work, existing)

    const result = await f.run(
      { kind: "category", categoryId: trips },
      {
        kind: "move",
        categoryId: work,
      },
    )

    assert.deepEqual(await f.tree(), [
      "(none): ",
      "work › ideas: n3",
      "work › trips: n1,n2",
      "work: ",
    ])
    assert.equal(result.removedCategoryId, trips)
    assert.equal(result.removedSubcategoryId, null)
    assert.equal(result.category!.id, work)
    assert.equal(result.category!.itemCount, 3)
    const created = result.category!.subcategories.find((entry) => entry.label === "trips")!
    assert.deepEqual(
      result.items.map((row) => [row.id, row.category?.id, row.subcategory?.id]),
      [first, second].map((row) => [row.id, work, created.id]),
    )
    assert.equal(
      (await listItemsByUser(f.userId, f.workspace.id)).find((row) => row.id === kept.id)!
        .timeModified,
      kept.timeModified,
    )
    assert.equal(
      (await getDb().query(`SELECT 1 FROM public.workspace_category_v1 WHERE id=$1`, [trips]))
        .rowCount,
      0,
    )
  })

  test("a category with subcategories, or a name already used there, does not move into another", async () => {
    const f = await fixture()
    const outsider = await fixture()
    const work = await f.category("work")
    const trips = await f.category("trips")
    const ideas = await f.category("ideas")
    await f.subcategory(work, "ideas")
    const japan = await f.subcategory(trips, "japan")
    await f.item("n1", trips, japan)
    await f.item("n2", ideas)
    const before = await f.tree()

    // Two levels only: a category that has subcategories cannot become one.
    await assert.rejects(
      f.run({ kind: "category", categoryId: trips }, { kind: "move", categoryId: work }),
      (error) => {
        assert.ok(error instanceof ItemGroupConflictError)
        assert.match(error.message, /subcategories before moving/)
        return true
      },
    )
    // "work" already has a subcategory named "ideas".
    await assert.rejects(
      f.run({ kind: "category", categoryId: ideas }, { kind: "move", categoryId: work }),
      (error) => {
        assert.ok(error instanceof ItemGroupConflictError)
        assert.match(error.message, /subcategory with that name already exists/)
        return true
      },
    )
    await assert.rejects(
      f.run(
        { kind: "category", categoryId: ideas },
        { kind: "move", categoryId: await outsider.category("foreign") },
      ),
      ItemGroupNotFoundError,
    )
    assert.deepEqual(await f.tree(), before)
  })

  test("an empty category or subcategory can still be moved", async () => {
    const f = await fixture()
    const work = await f.category("work")
    const empty = await f.category("empty")
    const moved = await f.run(
      { kind: "category", categoryId: empty },
      {
        kind: "move",
        categoryId: work,
      },
    )
    assert.deepEqual(moved.items, [])
    assert.deepEqual(await f.tree(), ["(none): ", "work › empty: ", "work: "])
    const nested = moved.category!.subcategories[0]!.id
    await f.run({ kind: "subcategory", subcategoryId: nested }, { kind: "move", categoryId: null })
    assert.deepEqual(await f.tree(), ["(none): ", "empty: ", "work: "])
  })
})
