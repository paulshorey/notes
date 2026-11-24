import { getDb } from "../lib/db/postgres"
import { deleteItemsForUserWithClient } from "./item/delete"
import { ItemGroupConflictError } from "./item-group-errors"
import { ensureDefaultWorkspaceForUser, lockUserWorkspaces } from "./workspace"

export const WORKSPACE_CHANGED_ERROR =
  "This workspace changed since it was reviewed. Review it again before deleting it."

/**
 * Delete the user's workspace with everything in it. Its items go to the trash first,
 * so they can be restored for as long as the trash keeps them; its categories,
 * statuses, and tags go with the workspace. An account always has a workspace to
 * capture into, so deleting the last one leaves a fresh default.
 *
 * `expectedItemCount` is the number of items the caller reviewed. When the workspace
 * holds a different number, nothing is deleted and `ItemGroupConflictError` is thrown.
 * Returns false when the user has no such workspace.
 */
export const deleteWorkspaceForUser = async (
  userId: number,
  id: number,
  expectedItemCount: number | null = null,
) => {
  const client = await getDb().connect()
  try {
    await client.query("BEGIN")
    const owned = await lockUserWorkspaces(client, userId)
    if (!owned.has(id)) {
      await client.query("ROLLBACK")
      return false
    }
    // Locked in id order, as every other writer of several items does.
    const { rows } = await client.query<{ id: number }>(
      `SELECT id FROM public.workspace_item_v1 WHERE workspace_id=$1 ORDER BY id FOR UPDATE`,
      [id],
    )
    if (expectedItemCount !== null && rows.length !== expectedItemCount)
      throw new ItemGroupConflictError(WORKSPACE_CHANGED_ERROR)
    if (rows.length > 0)
      await deleteItemsForUserWithClient(
        client,
        userId,
        rows.map((row) => row.id),
        id,
      )
    await client.query(`DELETE FROM public.user_workspace_v1 WHERE id=$2 AND user_id=$1`, [
      userId,
      id,
    ])
    await ensureDefaultWorkspaceForUser(client, userId)
    await client.query("COMMIT")
    return true
  } catch (error) {
    await client.query("ROLLBACK")
    throw error
  } finally {
    client.release()
  }
}
