import { getDb } from "../../lib/db/postgres"
export const deleteItemForUser = async (itemId: number, userId: number) => {
  const result = await getDb().query(
    `DELETE FROM public.workspace_item_v1 n USING public.user_workspace_v1 w
    WHERE n.id=$1 AND w.id=n.workspace_id AND w.user_id=$2`,
    [itemId, userId],
  )
  return (result.rowCount ?? 0) > 0
}
