import { getDb } from "../../lib/db/postgres"
import type { PoolClient } from "pg"
import { lockUserWorkspaces } from "../workspace"
import { pruneEmptyWorkspaceTaxonomy } from "../workspace-cleanup"
import { ItemGroupConflictError } from "../item-group-errors"
import { TRASH_ITEMS_SQL } from "./stored-capabilities"
import { purgeExpiredTrashWithClient } from "./trash"

/**
 * Single and bulk deletion share ownership checks. Every deleted item goes to the
 * trash, and the user's trash older than the retention is emptied on the way.
 */
export const deleteItemsForUserWithClient = async (
  client: Pick<PoolClient, "query">,
  userId: number,
  itemIds: number[],
  workspaceId: number | null = null,
) => {
  const result = await client.query<{ id: number }>(TRASH_ITEMS_SQL, [itemIds, userId, workspaceId])
  await purgeExpiredTrashWithClient(client, userId)
  return result.rows.map((row) => row.id).sort((a, b) => a - b)
}

const isSerializationFailure = (error: unknown) =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  (error.code === "40001" || error.code === "40P01")

/** Two deletions in one account wait on each other; the one that lost starts again. */
const DELETE_ATTEMPTS = 3

export const deleteItemForUser = async (
  itemId: number,
  userId: number,
  expectedWorkspaceId: number | null = null,
) => {
  for (let attempt = 1; ; attempt++) {
    try {
      return await deleteItemOnce(itemId, userId, expectedWorkspaceId)
    } catch (error) {
      if (!isSerializationFailure(error)) throw error
      if (attempt === DELETE_ATTEMPTS)
        throw new ItemGroupConflictError("The workspace changed. Try deleting the item again.")
    }
  }
}

const deleteItemOnce = async (
  itemId: number,
  userId: number,
  expectedWorkspaceId: number | null,
) => {
  const client = await getDb().connect()
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ")
    await lockUserWorkspaces(client, userId)
    const { rows } = await client.query<{ workspace_id: number }>(
      `SELECT n.workspace_id FROM public.workspace_item_v1 n
       JOIN public.user_workspace_v1 w ON w.id=n.workspace_id
       WHERE n.id=$1 AND w.user_id=$2 AND ($3::int IS NULL OR w.id=$3)`,
      [itemId, userId, expectedWorkspaceId],
    )
    const workspaceId = rows[0]?.workspace_id
    const deleted =
      workspaceId !== undefined &&
      (await deleteItemsForUserWithClient(client, userId, [itemId], workspaceId)).length > 0
    if (deleted) await pruneEmptyWorkspaceTaxonomy(client, userId, workspaceId)
    await client.query("COMMIT")
    return deleted
  } catch (error) {
    await client.query("ROLLBACK")
    throw error
  } finally {
    client.release()
  }
}
