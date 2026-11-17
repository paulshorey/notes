import { getDb } from "../../lib/db/postgres"
import type { PoolClient } from "pg"
import { lockUserWorkspaces } from "../workspace"
import { pruneEmptyWorkspaceTaxonomy } from "../workspace-cleanup"
import { ItemGroupConflictError } from "../item-group-errors"

/** Single and bulk deletion share ownership checks. */
export const deleteItemsForUserWithClient = async (
  client: Pick<PoolClient, "query">,
  userId: number,
  itemIds: number[],
  workspaceId: number | null = null,
) => {
  const result = await client.query<{ id: number }>(
    `DELETE FROM public.workspace_item_v1 n USING public.user_workspace_v1 w
     WHERE n.id=ANY($1::int[]) AND w.id=n.workspace_id AND w.user_id=$2
       AND ($3::int IS NULL OR n.workspace_id=$3) RETURNING n.id`,
    [itemIds, userId, workspaceId],
  )
  return result.rows.map((row) => row.id).sort((a, b) => a - b)
}

export const deleteItemForUser = async (
  itemId: number,
  userId: number,
  expectedWorkspaceId: number | null = null,
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
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error.code === "40001" || error.code === "40P01")
    )
      throw new ItemGroupConflictError("The workspace changed. Try deleting the item again.")
    throw error
  } finally {
    client.release()
  }
}
