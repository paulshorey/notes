import type { PoolClient } from "pg"
import type { TrashedItemRecord } from "../../contracts/items-app"
import { getDb } from "../../lib/db/postgres"
import { createWorkspaceForUserWithClient, lockUserWorkspaces } from "../workspace"
import { IMPORT_ITEMS_SQL } from "./stored-capabilities"

type TrashedFields = Record<string, unknown>

interface TrashRow {
  id: number
  workspace_label: string
  item: TrashedFields
  time_deleted: Date
}

const text = (value: unknown) => (typeof value === "string" && value !== "" ? value : null)
const labels = (value: unknown) =>
  Array.isArray(value) ? value.filter((label): label is string => typeof label === "string") : []

/** A trashed item as the trash lists it: the backup fields a person recognizes it by. */
const mapTrashedItem = (row: TrashRow): TrashedItemRecord => ({
  id: row.id,
  workspaceLabel: row.workspace_label,
  timeDeleted: row.time_deleted.toISOString(),
  description: text(row.item.description),
  category: text(row.item.category),
  subcategory: text(row.item.subcategory),
  status: text(row.item.status),
  tags: labels(row.item.tags),
  timeDue: text(row.item.timeDue),
  timeRemind: text(row.item.timeRemind),
})

/** The trash list shows the most recent deletions; older ones stay until they expire. */
export const TRASH_LIST_LIMIT = 200

export const listTrashedItemsByUser = async (userId: number) => {
  const { rows } = await getDb().query<TrashRow>(
    `SELECT id,workspace_label,item,time_deleted FROM public.user_item_trash_v1
     WHERE user_id=$1 ORDER BY time_deleted DESC,id DESC LIMIT $2`,
    [userId, TRASH_LIST_LIMIT],
  )
  return rows.map(mapTrashedItem)
}

/**
 * The workspace a trashed item goes back to: the one it was deleted from while that
 * exists, otherwise the user's workspace of the same label, created when there is none.
 */
const restoreWorkspace = async (
  client: PoolClient,
  userId: number,
  workspaceId: number | null,
  label: string,
) => {
  const { rows } = await client.query<{ id: number }>(
    `SELECT id FROM public.user_workspace_v1 WHERE user_id=$1 AND (id=$2 OR label=$3)
     ORDER BY (id=$2) DESC NULLS LAST LIMIT 1`,
    [userId, workspaceId, label],
  )
  return rows[0]?.id ?? createWorkspaceForUserWithClient(client, userId, label)
}

/**
 * Deleting an item removes the vocabulary nothing else uses, so a restore writes back
 * the labels the item names before importing it. Existing rows are left as they are.
 */
const restoreVocabulary = async (client: PoolClient, workspaceId: number, item: TrashedFields) => {
  const category = text(item.category)
  const subcategory = text(item.subcategory)
  const status = text(item.status)
  if (category !== null) {
    await client.query(
      `INSERT INTO public.workspace_category_v1(workspace_id,label) VALUES($1,$2)
       ON CONFLICT(workspace_id,label) DO NOTHING`,
      [workspaceId, category],
    )
    if (subcategory !== null)
      await client.query(
        `INSERT INTO public.workspace_subcategory_v1(category_id,label)
         SELECT c.id,$3 FROM public.workspace_category_v1 c WHERE c.workspace_id=$1 AND c.label=$2
         ON CONFLICT(category_id,label) DO NOTHING`,
        [workspaceId, category, subcategory],
      )
  }
  if (status !== null)
    await client.query(
      `INSERT INTO public.workspace_status_v1(workspace_id,label,position)
       SELECT $1,$2,COALESCE((SELECT MAX(position)+1 FROM public.workspace_status_v1
         WHERE workspace_id=$1),0)
       ON CONFLICT(workspace_id,label) DO NOTHING`,
      [workspaceId, status],
    )
  await client.query(
    `INSERT INTO public.workspace_tag_v1(workspace_id,label)
     SELECT $1,label FROM unnest($2::text[]) label
     ON CONFLICT(workspace_id,label) DO NOTHING`,
    [workspaceId, labels(item.tags)],
  )
}

/**
 * Put a trashed item back among the user's items and return its new id, or null when
 * the trash no longer holds it. Restoring is an import of that one item: it keeps its
 * uid when no item has taken it, and it is filed and tagged as it was.
 */
export const restoreTrashedItemForUser = async (userId: number, trashId: number) => {
  const client = await getDb().connect()
  try {
    await client.query("BEGIN")
    // A deletion that empties a workspace removes it; waiting here keeps the workspace
    // this restore picks from disappearing before the item is written. It comes before
    // the shared lock below so that waiting on one account never holds up the others.
    await lockUserWorkspaces(client, userId)
    // Imports that keep a uid take turns, so each sees the uids the others wrote.
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('items.restore.uid'))`)
    const taken = await client.query<{
      workspace_id: number | null
      workspace_label: string
      item: TrashedFields
    }>(
      `DELETE FROM public.user_item_trash_v1 WHERE id=$2 AND user_id=$1
       RETURNING workspace_id,workspace_label,item`,
      [userId, trashId],
    )
    const entry = taken.rows[0]
    if (!entry) {
      await client.query("ROLLBACK")
      return null
    }
    const workspaceId = await restoreWorkspace(
      client,
      userId,
      entry.workspace_id,
      entry.workspace_label,
    )
    await restoreVocabulary(client, workspaceId, entry.item)
    const restored = await client.query<{ id: number }>(IMPORT_ITEMS_SQL, [
      workspaceId,
      JSON.stringify([entry.item]),
    ])
    await client.query("COMMIT")
    return restored.rows[0]!.id
  } catch (error) {
    await client.query("ROLLBACK")
    throw error
  } finally {
    client.release()
  }
}

/** Remove one trashed item for good, or the user's whole trash. Returns the count. */
export const purgeTrashedItemsForUser = async (userId: number, trashId: number | null) => {
  const result = await getDb().query(
    `DELETE FROM public.user_item_trash_v1 WHERE user_id=$1 AND ($2::int IS NULL OR id=$2)`,
    [userId, trashId],
  )
  return result.rowCount ?? 0
}
