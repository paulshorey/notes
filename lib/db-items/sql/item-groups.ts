import { createHash } from "node:crypto"
import type { PoolClient } from "pg"
import type {
  ItemGroupAction,
  ItemGroupActionResponse,
  ItemGroupPreview,
  ItemGroupSelection,
} from "../contracts/item-group-actions"
import { assertCategoryNameAllowed, UNCATEGORIZED_LABEL } from "../contracts/category-name"
import { isTextItem } from "../contracts/item-content"
import { getDb } from "../lib/db/postgres"
import { readCategory } from "./category-shared"
import { ItemGroupConflictError, ItemGroupNotFoundError } from "./item-group-errors"
import { itemSelect, mapItem, resolveCategoryIdForWorkspace, type ItemRow } from "./item/shared"
import { deleteItemsForUserWithClient } from "./item/delete"

interface GroupRow {
  id: number
  label: string
  revision: string
}

interface GroupState {
  /** The targeted category, or the parent of the targeted subcategory. */
  category: GroupRow | null
  /** The targeted subcategory. */
  subcategory: GroupRow | null
  /** Every subcategory a category target would remove with it. */
  subcategories: GroupRow[]
  rows: (ItemRow & { revision: string })[]
}

export interface GroupLabelEmbedding {
  vectorLiteral: string | null
  embeddingModel: string | null
}

/** The only group membership predicate used by bulk actions. */
const groupPredicate = (selection: ItemGroupSelection, values: unknown[]) => {
  const target = selection.target
  if (target.kind === "uncategorized") return `n.category_id IS NULL`
  values.push(target.kind === "category" ? target.categoryId : target.subcategoryId)
  return `n.${target.kind === "category" ? "category_id" : "subcategory_id"}=$${values.length}`
}

const selectGroup = async (
  client: PoolClient,
  userId: number,
  selection: ItemGroupSelection,
  lock: boolean,
): Promise<GroupState> => {
  const workspace = await client.query(
    `SELECT 1 FROM public.user_workspace_v1 WHERE id=$1 AND user_id=$2`,
    [selection.workspaceId, userId],
  )
  if (workspace.rowCount !== 1) throw new ItemGroupNotFoundError()
  const values: unknown[] = [selection.workspaceId]
  const predicate = groupPredicate(selection, values)
  // An ordinary save locks its item row before its foreign keys touch the category
  // and subcategory rows. Lock in item-id order here too, and only then the category
  // and its subcategories; never lock a category first and deadlock its writers.
  if (lock)
    await client.query(
      `SELECT n.id FROM public.workspace_item_v1 n WHERE n.workspace_id=$1 AND ${predicate}
       ORDER BY n.id FOR UPDATE OF n`,
      values,
    )
  const { rows } = await client.query<ItemRow & { revision: string }>(
    `${itemSelect.replace("SELECT", "SELECT n.xmin::text AS revision,")}
     WHERE n.workspace_id=$1 AND ${predicate} ORDER BY n.id`,
    values,
  )
  const target = selection.target
  if (target.kind === "uncategorized")
    return { category: null, subcategory: null, subcategories: [], rows }

  const forUpdate = lock ? "FOR UPDATE" : ""
  let categoryId: number
  let subcategory: GroupRow | null = null
  if (target.kind === "subcategory") {
    const result = await client.query<GroupRow & { category_id: number }>(
      `SELECT sc.id,sc.label,sc.xmin::text AS revision,sc.category_id
       FROM public.workspace_subcategory_v1 sc
       JOIN public.workspace_category_v1 c ON c.id=sc.category_id
       WHERE c.workspace_id=$1 AND sc.id=$2 ${lock ? "FOR UPDATE OF sc" : ""}`,
      [selection.workspaceId, target.subcategoryId],
    )
    const found = result.rows[0]
    if (!found) throw new ItemGroupNotFoundError()
    categoryId = found.category_id
    subcategory = { id: found.id, label: found.label, revision: found.revision }
  } else {
    categoryId = target.categoryId
  }
  const category = (
    await client.query<GroupRow>(
      `SELECT id,label,xmin::text AS revision FROM public.workspace_category_v1
       WHERE workspace_id=$1 AND id=$2 ${target.kind === "category" ? forUpdate : ""}`,
      [selection.workspaceId, categoryId],
    )
  ).rows[0]
  if (!category) throw new ItemGroupNotFoundError()
  const subcategories =
    target.kind === "category"
      ? (
          await client.query<GroupRow>(
            `SELECT id,label,xmin::text AS revision FROM public.workspace_subcategory_v1
             WHERE category_id=$1 ORDER BY id ${forUpdate}`,
            [categoryId],
          )
        ).rows
      : []
  return { category, subcategory, subcategories, rows }
}

const previewOf = (
  userId: number,
  selection: ItemGroupSelection,
  state: GroupState,
): ItemGroupPreview => {
  const items = state.rows.map(mapItem)
  return {
    // This is a change detector, not an authorization token. Every execution
    // reselects the authenticated workspace and derives its own affected IDs.
    snapshot: createHash("sha256")
      .update(
        JSON.stringify({
          userId,
          selection,
          category: state.category,
          subcategory: state.subcategory,
          subcategories: state.subcategories,
          items: state.rows.map((row, index) => [
            row.id,
            row.revision,
            items[index]!.category,
            items[index]!.subcategory,
          ]),
        }),
      )
      .digest("hex"),
    label: state.subcategory?.label ?? state.category?.label ?? UNCATEGORIZED_LABEL,
    itemIds: items.map((item) => item.id),
    itemCount: items.length,
    textItemCount: items.filter(isTextItem).length,
    subcategoryCount: state.subcategories.length,
  }
}

const LABEL_CONFLICTS: Record<string, string> = {
  workspace_category_v1_workspace_id_label_key: "A category with that name already exists.",
  workspace_subcategory_v1_category_id_label_key:
    "A subcategory with that name already exists in this category.",
}

const withGroup = async <T>(
  userId: number,
  selection: ItemGroupSelection,
  lock: boolean,
  work: (client: PoolClient, state: GroupState, preview: ItemGroupPreview) => Promise<T>,
) => {
  const client = await getDb().connect()
  try {
    await client.query(`BEGIN ISOLATION LEVEL REPEATABLE READ ${lock ? "" : "READ ONLY"}`)
    const state = await selectGroup(client, userId, selection, lock)
    const result = await work(client, state, previewOf(userId, selection, state))
    await client.query("COMMIT")
    return result
  } catch (error) {
    await client.query("ROLLBACK")
    if (error && typeof error === "object" && "code" in error) {
      if (error.code === "40001" || error.code === "40P01") throw new ItemGroupConflictError()
      if (error.code === "23505") {
        const constraint = "constraint" in error ? String(error.constraint) : ""
        throw new ItemGroupConflictError(
          LABEL_CONFLICTS[constraint] ?? "A category with that name already exists.",
        )
      }
    }
    throw error
  } finally {
    client.release()
  }
}

export const previewItemGroup = (userId: number, selection: ItemGroupSelection) =>
  withGroup(userId, selection, false, async (_client, _state, preview) => preview)

type ActionContext = {
  userId: number
  client: PoolClient
  selection: ItemGroupSelection
  state: GroupState
  ids: number[]
  embedding?: GroupLabelEmbedding
}
type ActionResult = {
  categoryId: number | null
  removedCategoryId: number | null
  removedSubcategoryId: number | null
  deletedItemIds: number[]
}

/** Adding an action does not add another selector, transaction or preview path. */
const actions: {
  [K in ItemGroupAction["kind"]]: (
    context: ActionContext,
    action: Extract<ItemGroupAction, { kind: K }>,
  ) => Promise<ActionResult>
} = {
  rename: async ({ client, selection, state, ids, embedding }, action) => {
    if (!state.category && ids.length === 0)
      throw new ItemGroupConflictError("This group is empty. There are no items to categorize.")
    assertCategoryNameAllowed(action.label)
    if (!action.label.trim()) throw new Error("label is required.")
    const label = action.label.trim().toLocaleLowerCase()
    const unchanged = { removedCategoryId: null, removedSubcategoryId: null, deletedItemIds: [] }
    if (state.subcategory) {
      await client.query(`UPDATE public.workspace_subcategory_v1 SET label=$2 WHERE id=$1`, [
        state.subcategory.id,
        label,
      ])
      return { categoryId: state.category!.id, ...unchanged }
    }
    const categoryId =
      state.category?.id ??
      (await resolveCategoryIdForWorkspace(client, selection.workspaceId, label))
    if (!categoryId) throw new Error("Failed to resolve category.")
    if (state.category || embedding) {
      await client.query(
        `UPDATE public.workspace_category_v1 SET label=$3,
         category_embedding=$4::vector,embedding_model=$5,
         embedding_updated_at=CASE WHEN $5::text IS NULL THEN NULL ELSE now() END
         WHERE workspace_id=$1 AND id=$2`,
        [
          selection.workspaceId,
          categoryId,
          label,
          embedding?.vectorLiteral ?? null,
          embedding?.embeddingModel ?? null,
        ],
      )
    }
    // Naming the uncategorized group files its items in that category.
    if (!state.category && ids.length)
      await client.query(
        `UPDATE public.workspace_item_v1 SET category_id=$2 WHERE id=ANY($1::int[])`,
        [ids, categoryId],
      )
    return { categoryId, ...unchanged }
  },
  delete: async ({ client, userId, selection, state, ids }, action) => {
    if (!state.category && !action.deleteItems)
      throw new Error("Uncategorized items can only be deleted or assigned to a category.")
    // Items are deleted or unfiled first: the item foreign keys take no delete action,
    // so a category or subcategory that still files an item cannot be removed.
    if (action.deleteItems) {
      await deleteItemsForUserWithClient(client, userId, ids, selection.workspaceId)
    } else if (state.subcategory) {
      await client.query(
        `UPDATE public.workspace_item_v1 SET subcategory_id=NULL WHERE id=ANY($1::int[])`,
        [ids],
      )
    } else {
      await client.query(
        `UPDATE public.workspace_item_v1 SET category_id=NULL,subcategory_id=NULL
         WHERE id=ANY($1::int[])`,
        [ids],
      )
    }
    const deletedItemIds = action.deleteItems ? ids : []
    if (state.subcategory) {
      await client.query(`DELETE FROM public.workspace_subcategory_v1 WHERE id=$1`, [
        state.subcategory.id,
      ])
      return {
        categoryId: state.category!.id,
        removedCategoryId: null,
        removedSubcategoryId: state.subcategory.id,
        deletedItemIds,
      }
    }
    if (state.category)
      await client.query(
        `DELETE FROM public.workspace_category_v1 WHERE workspace_id=$1 AND id=$2`,
        [selection.workspaceId, state.category.id],
      )
    return {
      categoryId: null,
      removedCategoryId: state.category?.id ?? null,
      removedSubcategoryId: null,
      deletedItemIds,
    }
  },
}

const dispatchAction = <K extends ItemGroupAction["kind"]>(
  context: ActionContext,
  action: Extract<ItemGroupAction, { kind: K }>,
) => {
  // The mapped registry guarantees that each discriminant has its matching
  // handler. Keep the correlated-union assertion here, away from callers.
  const handler = actions[action.kind] as (
    context: ActionContext,
    value: typeof action,
  ) => Promise<ActionResult>
  return handler(context, action)
}

export const executeItemGroupAction = (
  userId: number,
  selection: ItemGroupSelection,
  action: ItemGroupAction,
  snapshot?: string,
  embedding?: GroupLabelEmbedding,
): Promise<ItemGroupActionResponse> =>
  withGroup(userId, selection, true, async (client, state, preview) => {
    if (snapshot !== undefined && snapshot !== preview.snapshot) throw new ItemGroupConflictError()
    const context: ActionContext = {
      client,
      userId,
      selection,
      state,
      ids: preview.itemIds,
      embedding,
    }
    const result = await dispatchAction(context, action)
    const updated = await client.query<ItemRow>(
      `${itemSelect} WHERE n.workspace_id=$1 AND n.id=ANY($2::int[]) ORDER BY n.id`,
      [selection.workspaceId, preview.itemIds],
    )
    return {
      items: updated.rows.map(mapItem),
      deletedItemIds: result.deletedItemIds,
      removedCategoryId: result.removedCategoryId,
      removedSubcategoryId: result.removedSubcategoryId,
      category:
        result.categoryId === null
          ? null
          : await readCategory(client, selection.workspaceId, result.categoryId),
    }
  })
