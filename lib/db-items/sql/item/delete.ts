import { getDb } from "../../lib/db/postgres"
import type { PoolClient } from "pg"

/** Single and bulk deletion share ownership checks and future lifecycle work. */
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

export const deleteItemForUser = async (itemId: number, userId: number) => {
  return (await deleteItemsForUserWithClient(getDb(), userId, [itemId])).length > 0
}
