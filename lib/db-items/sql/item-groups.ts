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

interface GroupState {
  category: { id: number; label: string; revision: string } | null
  rows: (ItemRow & { revision: string })[]
}

export interface GroupLabelEmbedding {
  vectorLiteral: string | null
  embeddingModel: string | null
}

/** The only category/uncategorized membership predicate used by bulk actions. */
const groupPredicate = (selection: ItemGroupSelection, values: unknown[]) => {
  const target = selection.target
  if (target.kind === "uncategorized")
    return `NOT EXISTS (SELECT 1 FROM public.item_category_link_v1 l WHERE l.item_id=n.id)`
  values.push(target.categoryId)
  return `EXISTS (SELECT 1 FROM public.item_category_link_v1 l WHERE l.item_id=n.id AND l.category_id=$${values.length})`
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
  // Ordinary saves lock their item row before replacing memberships. Lock in
  // item-id order here too; never lock a category first and deadlock its writers.
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
  let category: GroupState["category"] = null
  if (selection.target.kind === "category") {
    const result = await client.query<{ id: number; label: string; revision: string }>(
      `SELECT id,label,xmin::text AS revision FROM public.workspace_category_v1
       WHERE workspace_id=$1 AND id=$2 ${lock ? "FOR UPDATE" : ""}`,
      [selection.workspaceId, selection.target.categoryId],
    )
    category = result.rows[0] ?? null
    if (!category) throw new ItemGroupNotFoundError()
  }
  return { category, rows }
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
          items: state.rows.map((row, index) => [row.id, row.revision, items[index]!.categories]),
        }),
      )
      .digest("hex"),
    label: state.category?.label ?? UNCATEGORIZED_LABEL,
    itemIds: items.map((item) => item.id),
    itemCount: items.length,
    textItemCount: items.filter(isTextItem).length,
    sharedItemCount: items.filter((item) => item.categories.length > 1).length,
  }
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
      if (error.code === "23505")
        throw new ItemGroupConflictError("A category with that name already exists.")
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
    if (!state.category && ids.length) {
      await client.query(
        `INSERT INTO public.item_category_link_v1(item_id,category_id,workspace_id)
         SELECT id,$2,$3 FROM unnest($1::int[]) id ON CONFLICT DO NOTHING`,
        [ids, categoryId, selection.workspaceId],
      )
      await touchItems(client, ids)
    }
    return { categoryId, removedCategoryId: null, deletedItemIds: [] }
  },
  delete: async ({ client, userId, selection, state, ids }, action) => {
    if (!state.category && !action.deleteItems)
      throw new Error("Uncategorized items can only be deleted or assigned to a category.")
    if (action.deleteItems) {
      await deleteItemsForUserWithClient(client, userId, ids, selection.workspaceId)
    } else {
      await touchItems(client, ids)
    }
    if (state.category)
      await client.query(
        `DELETE FROM public.workspace_category_v1 WHERE workspace_id=$1 AND id=$2`,
        [selection.workspaceId, state.category.id],
      )
    return {
      categoryId: null,
      removedCategoryId: state.category?.id ?? null,
      deletedItemIds: action.deleteItems ? ids : [],
    }
  },
}

const touchItems = (client: PoolClient, ids: number[]) =>
  client.query(`UPDATE public.workspace_item_v1 SET time_modified=now() WHERE id=ANY($1::int[])`, [
    ids,
  ])

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
      category:
        result.categoryId === null
          ? null
          : await readCategory(client, selection.workspaceId, result.categoryId),
    }
  })
