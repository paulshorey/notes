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
import { moveWorkspaceItems } from "./item/workspace-move"
import { createWorkspaceForUserWithClient, lockUserWorkspaces } from "./workspace"
import { pruneEmptyWorkspaceTaxonomy } from "./workspace-cleanup"
import { InvalidRequestError } from "../contracts/request-error"

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
  if (target.kind === "item") {
    values.push(target.itemId)
    return `n.id=$${values.length}`
  }
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
  if (target.kind === "item" && rows.length === 0) throw new ItemGroupNotFoundError()
  if (target.kind === "uncategorized" || target.kind === "item")
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
    label:
      selection.target.kind === "item"
        ? "item"
        : (state.subcategory?.label ?? state.category?.label ?? UNCATEGORIZED_LABEL),
    itemIds: items.map((item) => item.id),
    itemCount: items.length,
    textItemCount: items.filter(isTextItem).length,
    subcategoryCount: state.subcategories.length,
  }
}

const LABEL_CONFLICTS: Record<string, string> = {
  user_workspace_v1_user_id_label_key: "A workspace with that name already exists.",
  workspace_category_v1_workspace_id_label_key: "A category with that name already exists.",
  workspace_subcategory_v1_category_id_label_key:
    "A subcategory with that name already exists in this category.",
}

/**
 * An item filed in the target after the group's items were read but before the target
 * row was locked still references it, so removing the target fails its foreign key.
 */
const FILING_CONSTRAINTS = new Set([
  "workspace_item_v1_category_workspace_fkey",
  "workspace_item_v1_subcategory_category_fkey",
])

const withGroup = async <T>(
  userId: number,
  selection: ItemGroupSelection,
  lock: boolean,
  work: (client: PoolClient, state: GroupState, preview: ItemGroupPreview) => Promise<T>,
  action?: ItemGroupAction,
) => {
  const client = await getDb().connect()
  try {
    await client.query(`BEGIN ISOLATION LEVEL REPEATABLE READ ${lock ? "" : "READ ONLY"}`)
    if (action?.kind === "delete" || action?.kind === "move-to-workspace") {
      const workspaceIds = await lockUserWorkspaces(client, userId)
      if (!workspaceIds.has(selection.workspaceId)) throw new ItemGroupNotFoundError()
      if (action.kind === "move-to-workspace" && action.destinationWorkspaceId !== undefined) {
        if (selection.workspaceId === action.destinationWorkspaceId)
          throw new InvalidRequestError("Choose a different workspace.")
        if (!workspaceIds.has(action.destinationWorkspaceId)) throw new ItemGroupNotFoundError()
      }
    }
    const state = await selectGroup(client, userId, selection, lock)
    const result = await work(client, state, previewOf(userId, selection, state))
    await client.query("COMMIT")
    return result
  } catch (error) {
    await client.query("ROLLBACK")
    if (error && typeof error === "object" && "code" in error) {
      if (error.code === "40001" || error.code === "40P01") throw new ItemGroupConflictError()
      if (
        error.code === "23503" &&
        "constraint" in error &&
        FILING_CONSTRAINTS.has(String(error.constraint))
      )
        throw new ItemGroupConflictError()
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
  workspaceMove?: ItemGroupActionResponse["workspaceMove"]
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
    if (!action.label.trim()) throw new InvalidRequestError("label is required.")
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
      throw new InvalidRequestError(
        "Uncategorized items can only be deleted or assigned to a category.",
      )
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
  "move-to-workspace": async ({ client, userId, selection, ids }, action) => {
    if (ids.length === 0) throw new ItemGroupConflictError("There are no items to move.")
    const destinationWorkspaceId =
      action.destinationWorkspaceId ??
      (action.destinationWorkspaceLabel
        ? await createWorkspaceForUserWithClient(client, userId, action.destinationWorkspaceLabel)
        : undefined)
    if (destinationWorkspaceId === undefined)
      throw new InvalidRequestError("Choose a destination workspace.")
    const itemIds = await moveWorkspaceItems(
      client,
      selection.workspaceId,
      destinationWorkspaceId,
      {
        itemIds: ids,
      },
    )
    return {
      categoryId: null,
      removedCategoryId: null,
      removedSubcategoryId: null,
      deletedItemIds: [],
      workspaceMove: { destinationWorkspaceId, itemIds },
    }
  },
  move: async ({ client, selection, state, ids }, action) => {
    if (!state.category)
      throw new InvalidRequestError("Uncategorized items are filed by naming a category for them.")
    const source = state.category
    // Every branch refiles the same items; nothing is deleted except the row that
    // is replaced by its counterpart on the other level.
    if (state.subcategory) {
      const subcategory = state.subcategory
      if (action.categoryId === null) {
        // Promote: the subcategory becomes a category with the same label.
        const created = await client.query<{ id: number }>(
          `INSERT INTO public.workspace_category_v1(workspace_id,label) VALUES($1,$2) RETURNING id`,
          [selection.workspaceId, subcategory.label],
        )
        const categoryId = created.rows[0]!.id
        await client.query(
          `UPDATE public.workspace_item_v1 SET category_id=$2,subcategory_id=NULL
           WHERE id=ANY($1::int[])`,
          [ids, categoryId],
        )
        await client.query(`DELETE FROM public.workspace_subcategory_v1 WHERE id=$1`, [
          subcategory.id,
        ])
        return {
          categoryId,
          removedCategoryId: null,
          removedSubcategoryId: subcategory.id,
          deletedItemIds: [],
        }
      }
      if (action.categoryId === source.id)
        throw new ItemGroupConflictError("This subcategory is already in that category.")
      const categoryId = await lockDestinationCategory(
        client,
        selection.workspaceId,
        action.categoryId,
      )
      // The item foreign key cascades this update, so the items follow in one statement.
      await client.query(`UPDATE public.workspace_subcategory_v1 SET category_id=$2 WHERE id=$1`, [
        subcategory.id,
        categoryId,
      ])
      return {
        categoryId,
        removedCategoryId: null,
        removedSubcategoryId: null,
        deletedItemIds: [],
      }
    }
    if (action.categoryId === null)
      throw new InvalidRequestError("This group is already a category.")
    if (action.categoryId === source.id)
      throw new ItemGroupConflictError("A category cannot be moved into itself.")
    if (state.subcategories.length > 0)
      throw new ItemGroupConflictError(
        "Move or delete this category's subcategories before moving it into another category.",
      )
    // Nest: the category becomes a subcategory, with the same label, of the destination.
    const categoryId = await lockDestinationCategory(
      client,
      selection.workspaceId,
      action.categoryId,
    )
    const created = await client.query<{ id: number }>(
      `INSERT INTO public.workspace_subcategory_v1(category_id,label) VALUES($1,$2) RETURNING id`,
      [categoryId, source.label],
    )
    await client.query(
      `UPDATE public.workspace_item_v1 SET category_id=$2,subcategory_id=$3
       WHERE id=ANY($1::int[])`,
      [ids, categoryId, created.rows[0]!.id],
    )
    await client.query(`DELETE FROM public.workspace_category_v1 WHERE workspace_id=$1 AND id=$2`, [
      selection.workspaceId,
      source.id,
    ])
    return {
      categoryId,
      removedCategoryId: source.id,
      removedSubcategoryId: null,
      deletedItemIds: [],
    }
  },
}

/** A destination category must be another category of the same workspace. */
const lockDestinationCategory = async (
  client: PoolClient,
  workspaceId: number,
  categoryId: number,
) => {
  const { rows } = await client.query<{ id: number }>(
    `SELECT id FROM public.workspace_category_v1 WHERE workspace_id=$1 AND id=$2 FOR UPDATE`,
    [workspaceId, categoryId],
  )
  if (!rows[0]) throw new ItemGroupNotFoundError()
  return rows[0].id
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
  withGroup(
    userId,
    selection,
    true,
    async (client, state, preview) => {
      if (snapshot !== undefined && snapshot !== preview.snapshot)
        throw new ItemGroupConflictError()
      const context: ActionContext = {
        client,
        userId,
        selection,
        state,
        ids: preview.itemIds,
        embedding,
      }
      const result = await dispatchAction(context, action)
      const cleanup =
        action.kind === "delete" || action.kind === "move-to-workspace"
          ? {
              workspaceRemoved: await pruneEmptyWorkspaceTaxonomy(
                client,
                userId,
                selection.workspaceId,
              ),
            }
          : undefined
      const updated = await client.query<ItemRow>(
        `${itemSelect} WHERE n.workspace_id=$1 AND n.id=ANY($2::int[]) ORDER BY n.id`,
        [selection.workspaceId, preview.itemIds],
      )
      return {
        items: updated.rows.map(mapItem),
        deletedItemIds: result.deletedItemIds,
        ...(result.workspaceMove && { workspaceMove: result.workspaceMove }),
        ...(cleanup && { cleanup }),
        removedCategoryId: result.removedCategoryId,
        removedSubcategoryId: result.removedSubcategoryId,
        category:
          result.categoryId === null
            ? null
            : await readCategory(client, selection.workspaceId, result.categoryId),
      }
    },
    action,
  )
