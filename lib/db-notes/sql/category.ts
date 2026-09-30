import type { PoolClient } from "pg"
import type { CategoryRecord } from "../contracts/notes-app"
import { getDb } from "../lib/db/postgres"
import { CURRENT_NOTE_EMBEDDING_MODEL } from "../services/notes-embeddings"
export const DEFAULT_CATEGORY_LABEL = "uncategorized"
export interface CategoryEmbeddingBackfillRow {
  id: number
  label: string
}
interface Row {
  id: number
  workspace_id: number
  label: string
  note_count: number | string | null
  last_used_at: Date | string | null
}
const map = (r: Row): CategoryRecord => ({
  id: r.id,
  workspaceId: r.workspace_id,
  label: r.label,
  noteCount: Number(r.note_count ?? 0),
  lastUsedAt: r.last_used_at ? new Date(r.last_used_at).toISOString() : null,
})
const select = `SELECT c.id,c.workspace_id,c.label,
  (SELECT COUNT(*)::int FROM public.user_note_category_link_v1 l WHERE l.category_id=c.id) note_count,
  (SELECT MAX(n.time_modified) FROM public.user_note_category_link_v1 l JOIN public.user_note_v1 n ON n.id=l.note_id WHERE l.category_id=c.id) last_used_at
  FROM public.workspace_note_category_v1 c`
export const ensureDefaultCategoryForWorkspace = async (
  client: PoolClient,
  workspaceId: number,
) => {
  await client.query(
    `INSERT INTO public.workspace_note_category_v1(workspace_id,label) SELECT $1,$2
    WHERE NOT EXISTS(SELECT 1 FROM public.workspace_note_category_v1 WHERE workspace_id=$1)
    ON CONFLICT(workspace_id,label) DO NOTHING`,
    [workspaceId, DEFAULT_CATEGORY_LABEL],
  )
}
export const getFirstCategoryForWorkspace = async (client: PoolClient, workspaceId: number) => {
  const { rows } = await client.query<{ id: number; label: string }>(
    `SELECT id,label FROM public.workspace_note_category_v1 WHERE workspace_id=$1 ORDER BY id LIMIT 1`,
    [workspaceId],
  )
  return rows[0] ?? null
}
export const listCategoriesByWorkspace = async (userId: number, workspaceId: number) => {
  const { rows } = await getDb().query<Row>(
    `${select} JOIN public.user_workspace_v1 w ON w.id=c.workspace_id
    WHERE w.user_id=$1 AND c.workspace_id=$2 ORDER BY last_used_at DESC NULLS LAST,lower(c.label),c.id`,
    [userId, workspaceId],
  )
  return rows.map(map)
}
export const getCategoryByIdForWorkspace = async (
  userId: number,
  workspaceId: number,
  id: number,
) => {
  const { rows } = await getDb().query<Row>(
    `${select} JOIN public.user_workspace_v1 w ON w.id=c.workspace_id
    WHERE w.user_id=$1 AND c.workspace_id=$2 AND c.id=$3`,
    [userId, workspaceId, id],
  )
  return rows[0] ? map(rows[0]) : null
}
export const listCategoriesMissingEmbeddingsByUser = async (userId: number, limit: number) => {
  const { rows } = await getDb().query<CategoryEmbeddingBackfillRow>(
    `SELECT c.id,c.label FROM public.workspace_note_category_v1 c
    JOIN public.user_workspace_v1 w ON w.id=c.workspace_id WHERE w.user_id=$1 AND c.category_embedding IS NULL ORDER BY c.id LIMIT $2`,
    [userId, limit],
  )
  return rows
}
export const listCategoriesStaleEmbeddingsByUser = async (userId: number, limit: number) => {
  const { rows } = await getDb().query<CategoryEmbeddingBackfillRow>(
    `SELECT c.id,c.label FROM public.workspace_note_category_v1 c
    JOIN public.user_workspace_v1 w ON w.id=c.workspace_id WHERE w.user_id=$1 AND (c.embedding_model IS DISTINCT FROM $2 OR c.category_embedding IS NULL)
    ORDER BY c.id LIMIT $3`,
    [userId, CURRENT_NOTE_EMBEDDING_MODEL, limit],
  )
  return rows
}
export const updateCategoryEmbeddingById = async (
  userId: number,
  id: number,
  embedding: string | null,
  model: string | null,
) => {
  const result = await getDb().query(
    `UPDATE public.workspace_note_category_v1 c SET category_embedding=$3::vector,embedding_model=$4,embedding_updated_at=now()
    FROM public.user_workspace_v1 w WHERE c.id=$1 AND w.id=c.workspace_id AND w.user_id=$2`,
    [id, userId, embedding, model],
  )
  return result.rowCount === 1
}
export const updateCategoryLabelForWorkspace = async (
  userId: number,
  workspaceId: number,
  id: number,
  label: string,
  embedding: string | null,
  model: string | null,
) => {
  const { rows } = await getDb().query<Row>(
    `UPDATE public.workspace_note_category_v1 c SET label=$4,category_embedding=$5::vector,embedding_model=$6,embedding_updated_at=CASE WHEN $6::text IS NULL THEN NULL ELSE now() END
    FROM public.user_workspace_v1 w WHERE c.id=$3 AND c.workspace_id=$2 AND w.id=$2 AND w.user_id=$1
    RETURNING c.id,c.workspace_id,c.label,0::int note_count,NULL::timestamptz last_used_at`,
    [userId, workspaceId, id, label, embedding, model],
  )
  return rows[0] ? getCategoryByIdForWorkspace(userId, workspaceId, id) : null
}
export const deleteCategoryForWorkspace = async (
  userId: number,
  workspaceId: number,
  id: number,
) => {
  const result = await getDb().query(
    `DELETE FROM public.workspace_note_category_v1 c USING public.user_workspace_v1 w
    WHERE c.id=$3 AND c.workspace_id=$2 AND w.id=$2 AND w.user_id=$1`,
    [userId, workspaceId, id],
  )
  return result.rowCount === 1
}
