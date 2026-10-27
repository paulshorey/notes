import type { PoolClient } from "pg"
import type { CategoryRecord } from "../contracts/items-app"

export interface CategoryRow {
  id: number
  workspace_id: number
  label: string
  item_count: number | string | null
  last_used_at: Date | string | null
}

export const mapCategory = (r: CategoryRow): CategoryRecord => ({
  id: r.id,
  workspaceId: r.workspace_id,
  label: r.label,
  itemCount: Number(r.item_count ?? 0),
  lastUsedAt: r.last_used_at ? new Date(r.last_used_at).toISOString() : null,
})

export const categorySelect = `SELECT c.id,c.workspace_id,c.label,
  (SELECT COUNT(*)::int FROM public.item_category_link_v1 l WHERE l.category_id=c.id) item_count,
  (SELECT MAX(n.time_modified) FROM public.item_category_link_v1 l JOIN public.workspace_item_v1 n ON n.id=l.item_id WHERE l.category_id=c.id) last_used_at
  FROM public.workspace_category_v1 c`

export const readCategory = async (client: PoolClient, workspaceId: number, id: number) => {
  const { rows } = await client.query<CategoryRow>(
    `${categorySelect} WHERE c.workspace_id=$1 AND c.id=$2`,
    [workspaceId, id],
  )
  return rows[0] ? mapCategory(rows[0]) : null
}
