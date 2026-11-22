import type { CategoryRef, TagRef, ItemRecord } from "./types"
import type { PoolClient } from "pg"
import { assertCategoryNameAllowed } from "../../contracts/category-name"
import { isJournalDayViolation, JournalDayTakenError } from "../../contracts/item-journal"

export const itemColumns = `
  n.id, n.uid, n.workspace_id, n.description, n.time_start, n.time_end, n.entry_date::text AS entry_date,
  n.time_due, n.time_remind,
  n.time_created, n.time_modified,
  CASE WHEN s.id IS NULL THEN NULL ELSE json_build_object('id', s.id, 'label', s.label) END AS status,
  (SELECT json_build_object('id', c.id, 'label', c.label)
    FROM public.workspace_category_v1 c WHERE c.id=n.category_id) AS category,
  (SELECT json_build_object('id', sc.id, 'label', sc.label)
    FROM public.workspace_subcategory_v1 sc WHERE sc.id=n.subcategory_id) AS subcategory,
  COALESCE((SELECT json_agg(json_build_object('id', t.id, 'label', t.label) ORDER BY lower(t.label), t.id)
    FROM public.item_tag_link_v1 l
    JOIN public.workspace_tag_v1 t ON t.id=l.tag_id AND t.workspace_id=n.workspace_id
    WHERE l.item_id=n.id), '[]'::json) AS tags
`

export const itemSelect = `SELECT ${itemColumns} FROM public.workspace_item_v1 n
  LEFT JOIN public.workspace_status_v1 s ON s.id=n.status_id AND s.workspace_id=n.workspace_id`

export interface ItemRow {
  id: number
  uid: string
  workspace_id: number
  description: string | null
  time_start: Date | null
  time_end: Date | null
  entry_date: string | null
  time_due: Date | null
  time_remind: Date | null
  time_created: Date
  time_modified: Date
  category: unknown
  subcategory: unknown
  status: unknown
  tags: unknown
}

export const toNullableText = (value: string | null) =>
  value == null || value.trim() === "" ? null : value.trim()

const parseRefs = (value: unknown): CategoryRef[] =>
  Array.isArray(value)
    ? value.filter(
        (item): item is CategoryRef =>
          typeof item === "object" &&
          item !== null &&
          typeof (item as CategoryRef).id === "number" &&
          typeof (item as CategoryRef).label === "string",
      )
    : []

export const mapItem = (row: ItemRow): ItemRecord => ({
  id: row.id,
  uid: row.uid,
  workspaceId: row.workspace_id,
  category: parseRefs([row.category])[0] ?? null,
  subcategory: parseRefs([row.subcategory])[0] ?? null,
  status: parseRefs([row.status])[0] ?? null,
  tags: parseRefs(row.tags) as TagRef[],
  description: row.description,
  timeStart: row.time_start?.toISOString() ?? null,
  timeEnd: row.time_end?.toISOString() ?? null,
  entryDate: row.entry_date,
  timeDue: row.time_due?.toISOString() ?? null,
  timeRemind: row.time_remind?.toISOString() ?? null,
  timeCreated: row.time_created.toISOString(),
  timeModified: row.time_modified.toISOString(),
})

const ensureIds = async (
  client: PoolClient,
  table: string,
  workspaceId: number,
  ids: number[],
  label: string,
) => {
  const unique = [...new Set(ids)]
  if (!unique.length) return unique
  const { rows } = await client.query<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM public.${table} WHERE workspace_id=$1 AND id=ANY($2::int[])`,
    [workspaceId, unique],
  )
  if (rows[0]?.count !== unique.length)
    throw new Error(`One or more ${label} were not found for this workspace.`)
  return unique
}

export const ensureStatusIdForWorkspace = async (
  client: PoolClient,
  workspaceId: number,
  statusId: number | null,
) => {
  if (statusId === null) return
  const result = await client.query(
    `SELECT 1 FROM public.workspace_status_v1 WHERE workspace_id=$1 AND id=$2`,
    [workspaceId, statusId],
  )
  if (result.rowCount !== 1) throw new Error("Status was not found for this workspace.")
}

export const CATEGORY_NOT_IN_WORKSPACE_ERROR = "Category was not found for this workspace."

/**
 * The category and subcategory an item write will store. The category must belong to
 * the workspace. A subcategory is kept only when it belongs to that category, so
 * choosing another category, or none, clears a subcategory left over from the old one.
 */
export const resolveItemFiling = async (
  client: PoolClient,
  workspaceId: number,
  categoryId: number | null,
  subcategoryId: number | null,
): Promise<{ categoryId: number | null; subcategoryId: number | null }> => {
  if (categoryId === null) return { categoryId: null, subcategoryId: null }
  const category = await client.query(
    `SELECT 1 FROM public.workspace_category_v1 WHERE workspace_id=$1 AND id=$2`,
    [workspaceId, categoryId],
  )
  if (category.rowCount !== 1) throw new Error(CATEGORY_NOT_IN_WORKSPACE_ERROR)
  if (subcategoryId === null) return { categoryId, subcategoryId: null }
  const subcategory = await client.query(
    `SELECT 1 FROM public.workspace_subcategory_v1 WHERE id=$1 AND category_id=$2`,
    [subcategoryId, categoryId],
  )
  return { categoryId, subcategoryId: subcategory.rowCount === 1 ? subcategoryId : null }
}

/** A category or subcategory removed between the check above and the write. */
export const rethrowFilingRace = (error: unknown): never => {
  if (isJournalDayViolation(error)) throw new JournalDayTakenError()
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    error.code === "23503" &&
    "constraint" in error &&
    (error.constraint === "workspace_item_v1_category_workspace_fkey" ||
      error.constraint === "workspace_item_v1_subcategory_category_fkey")
  )
    throw new Error(CATEGORY_NOT_IN_WORKSPACE_ERROR)
  throw error
}

export const replaceItemTagsForItem = async (
  client: PoolClient,
  itemId: number,
  workspaceId: number,
  ids: number[],
) => {
  const unique = await ensureIds(client, "workspace_tag_v1", workspaceId, ids, "tag ids")
  await client.query(`DELETE FROM public.item_tag_link_v1 WHERE item_id=$1`, [itemId])
  if (unique.length)
    await client.query(
      `INSERT INTO public.item_tag_link_v1 (item_id, tag_id, workspace_id) SELECT $1, value, $2 FROM unnest($3::int[]) value`,
      [itemId, workspaceId, unique],
    )
}

export const selectItemById = async (client: PoolClient, itemId: number, userId: number) => {
  const { rows } = await client.query<ItemRow>(
    `${itemSelect}
    JOIN public.user_workspace_v1 w ON w.id=n.workspace_id
    WHERE n.id=$1 AND w.user_id=$2 LIMIT 1`,
    [itemId, userId],
  )
  return rows[0] ? mapItem(rows[0]) : null
}

const resolve = async (client: PoolClient, table: string, workspaceId: number, label: string) => {
  const normalized = label.trim().toLocaleLowerCase()
  if (!normalized) return null
  const { rows } = await client.query<{ id: number }>(
    `INSERT INTO public.${table} (workspace_id,label) VALUES ($1,$2)
     ON CONFLICT (workspace_id,label) DO UPDATE SET label=EXCLUDED.label RETURNING id`,
    [workspaceId, normalized],
  )
  return rows[0]?.id ?? null
}
export const resolveCategoryIdForWorkspace = (
  client: PoolClient,
  workspaceId: number,
  label: string,
) => {
  assertCategoryNameAllowed(label)
  return resolve(client, "workspace_category_v1", workspaceId, label)
}
export const resolveTagIdForWorkspace = (client: PoolClient, workspaceId: number, label: string) =>
  resolve(client, "workspace_tag_v1", workspaceId, label)

/** Find or create a subcategory of a category that belongs to the workspace. */
export const resolveSubcategoryIdForCategory = async (
  client: PoolClient,
  workspaceId: number,
  categoryId: number,
  label: string,
) => {
  assertCategoryNameAllowed(label)
  const normalized = label.trim().toLocaleLowerCase()
  if (!normalized) return null
  const { rows } = await client.query<{ id: number }>(
    `INSERT INTO public.workspace_subcategory_v1 (category_id,label)
     SELECT c.id,$3 FROM public.workspace_category_v1 c WHERE c.workspace_id=$1 AND c.id=$2
     ON CONFLICT (category_id,label) DO UPDATE SET label=EXCLUDED.label RETURNING id`,
    [workspaceId, categoryId, normalized],
  )
  return rows[0]?.id ?? null
}
