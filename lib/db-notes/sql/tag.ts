import type { PoolClient } from "pg"
import type { TagRecord } from "../contracts/notes-app"
import { getDb } from "../lib/db/postgres"
import { CURRENT_NOTE_EMBEDDING_MODEL } from "../services/notes-embeddings"
export const DEFAULT_TAG_LABEL = "important"
export interface TagEmbeddingBackfillRow {
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
const map = (r: Row): TagRecord => ({
  id: r.id,
  workspaceId: r.workspace_id,
  label: r.label,
  noteCount: Number(r.note_count ?? 0),
  lastUsedAt: r.last_used_at ? new Date(r.last_used_at).toISOString() : null,
})
const select = `SELECT t.id,t.workspace_id,t.label,(SELECT COUNT(*)::int FROM public.user_note_tag_link_v1 l WHERE l.tag_id=t.id) note_count,
 (SELECT MAX(n.time_modified) FROM public.user_note_tag_link_v1 l JOIN public.user_note_v1 n ON n.id=l.note_id WHERE l.tag_id=t.id) last_used_at FROM public.workspace_note_tag_v1 t`
export const ensureDefaultTagForWorkspace = async (client: PoolClient, workspaceId: number) => {
  await client.query(
    `INSERT INTO public.workspace_note_tag_v1(workspace_id,label) SELECT $1,$2
 WHERE NOT EXISTS(SELECT 1 FROM public.workspace_note_tag_v1 WHERE workspace_id=$1) ON CONFLICT(workspace_id,label) DO NOTHING`,
    [workspaceId, DEFAULT_TAG_LABEL],
  )
}
export const getFirstTagForWorkspace = async (client: PoolClient, workspaceId: number) => {
  const { rows } = await client.query<{ id: number; label: string }>(
    `SELECT id,label FROM public.workspace_note_tag_v1 WHERE workspace_id=$1 ORDER BY id LIMIT 1`,
    [workspaceId],
  )
  return rows[0] ?? null
}
export const listTagsByWorkspace = async (userId: number, workspaceId: number) => {
  const { rows } = await getDb().query<Row>(
    `${select} JOIN public.user_workspace_v1 w ON w.id=t.workspace_id
 WHERE w.user_id=$1 AND t.workspace_id=$2 ORDER BY last_used_at DESC NULLS LAST,lower(t.label),t.id`,
    [userId, workspaceId],
  )
  return rows.map(map)
}
export const getTagByIdForWorkspace = async (userId: number, workspaceId: number, id: number) => {
  const { rows } = await getDb().query<Row>(
    `${select} JOIN public.user_workspace_v1 w ON w.id=t.workspace_id
 WHERE w.user_id=$1 AND t.workspace_id=$2 AND t.id=$3`,
    [userId, workspaceId, id],
  )
  return rows[0] ? map(rows[0]) : null
}
export const listTagsMissingEmbeddingsByUser = async (userId: number, limit: number) => {
  const { rows } = await getDb().query<TagEmbeddingBackfillRow>(
    `SELECT t.id,t.label FROM public.workspace_note_tag_v1 t
 JOIN public.user_workspace_v1 w ON w.id=t.workspace_id WHERE w.user_id=$1 AND t.tag_embedding IS NULL ORDER BY t.id LIMIT $2`,
    [userId, limit],
  )
  return rows
}
export const listTagsStaleEmbeddingsByUser = async (userId: number, limit: number) => {
  const { rows } = await getDb().query<TagEmbeddingBackfillRow>(
    `SELECT t.id,t.label FROM public.workspace_note_tag_v1 t
 JOIN public.user_workspace_v1 w ON w.id=t.workspace_id WHERE w.user_id=$1 AND (t.embedding_model IS DISTINCT FROM $2 OR t.tag_embedding IS NULL) ORDER BY t.id LIMIT $3`,
    [userId, CURRENT_NOTE_EMBEDDING_MODEL, limit],
  )
  return rows
}
export const updateTagEmbeddingById = async (
  userId: number,
  id: number,
  embedding: string | null,
  model: string | null,
) => {
  const r = await getDb().query(
    `UPDATE public.workspace_note_tag_v1 t SET tag_embedding=$3::vector,embedding_model=$4,embedding_updated_at=now()
 FROM public.user_workspace_v1 w WHERE t.id=$1 AND w.id=t.workspace_id AND w.user_id=$2`,
    [id, userId, embedding, model],
  )
  return r.rowCount === 1
}
export const updateTagLabelForWorkspace = async (
  userId: number,
  workspaceId: number,
  id: number,
  label: string,
  embedding: string | null,
  model: string | null,
) => {
  const r = await getDb().query(
    `UPDATE public.workspace_note_tag_v1 t SET label=$4,tag_embedding=$5::vector,embedding_model=$6,embedding_updated_at=CASE WHEN $6::text IS NULL THEN NULL ELSE now() END
 FROM public.user_workspace_v1 w WHERE t.id=$3 AND t.workspace_id=$2 AND w.id=$2 AND w.user_id=$1`,
    [userId, workspaceId, id, label, embedding, model],
  )
  return r.rowCount === 1 ? getTagByIdForWorkspace(userId, workspaceId, id) : null
}
export const deleteTagForWorkspace = async (userId: number, workspaceId: number, id: number) => {
  const links = await getDb().query<{ count: number }>(
    `SELECT COUNT(*)::int count FROM public.user_note_tag_link_v1 WHERE tag_id=$1`,
    [id],
  )
  const r = await getDb().query(
    `DELETE FROM public.workspace_note_tag_v1 t USING public.user_workspace_v1 w
 WHERE t.id=$3 AND t.workspace_id=$2 AND w.id=$2 AND w.user_id=$1`,
    [userId, workspaceId, id],
  )
  return r.rowCount === 1 ? Number(links.rows[0]?.count ?? 0) : null
}
