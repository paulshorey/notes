import type { PoolClient } from "pg"
import type { CategoryRecord, SubcategoryRecord } from "../contracts/items-app"

interface SubcategoryJson {
  id: number
  categoryId: number
  label: string
  itemCount: number
  lastUsedAt: string | null
}

export interface CategoryRow {
  id: number
  workspace_id: number
  label: string
  item_count: number | string | null
  last_used_at: Date | string | null
  subcategories: SubcategoryJson[] | null
}

const isoOrNull = (value: Date | string | null) => (value ? new Date(value).toISOString() : null)

const mapSubcategory = (value: SubcategoryJson): SubcategoryRecord => ({
  id: value.id,
  categoryId: value.categoryId,
  label: value.label,
  itemCount: Number(value.itemCount ?? 0),
  lastUsedAt: isoOrNull(value.lastUsedAt),
})

export const mapCategory = (r: CategoryRow): CategoryRecord => ({
  id: r.id,
  workspaceId: r.workspace_id,
  label: r.label,
  itemCount: Number(r.item_count ?? 0),
  lastUsedAt: isoOrNull(r.last_used_at),
  subcategories: (r.subcategories ?? []).map(mapSubcategory),
})

/** A category counts every item filed in it, whether or not the item has a subcategory. */
export const categorySelect = `SELECT c.id,c.workspace_id,c.label,
  (SELECT COUNT(*)::int FROM public.workspace_item_v1 n WHERE n.category_id=c.id) item_count,
  (SELECT MAX(n.time_modified) FROM public.workspace_item_v1 n WHERE n.category_id=c.id) last_used_at,
  COALESCE((SELECT json_agg(json_build_object(
      'id',sc.id,'categoryId',sc.category_id,'label',sc.label,
      'itemCount',(SELECT COUNT(*)::int FROM public.workspace_item_v1 n WHERE n.subcategory_id=sc.id),
      'lastUsedAt',(SELECT MAX(n.time_modified) FROM public.workspace_item_v1 n WHERE n.subcategory_id=sc.id)
    ) ORDER BY lower(sc.label),sc.id)
    FROM public.workspace_subcategory_v1 sc WHERE sc.category_id=c.id),'[]'::json) subcategories
  FROM public.workspace_category_v1 c`

export const readCategory = async (client: PoolClient, workspaceId: number, id: number) => {
  const { rows } = await client.query<CategoryRow>(
    `${categorySelect} WHERE c.workspace_id=$1 AND c.id=$2`,
    [workspaceId, id],
  )
  return rows[0] ? mapCategory(rows[0]) : null
}
