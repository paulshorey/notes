import { getDb } from "../../lib/db/postgres"
import { CURRENT_ITEM_EMBEDDING_MODEL } from "../../services/item-embeddings"
import { mapItem, itemColumns, itemSelect, type ItemRow } from "./shared"
import type { ItemEmbeddingBackfillRow, SemanticSearchResult } from "./types"
interface SemanticSearchRow extends ItemRow {
  semantic_similarity: number
}

export const listItemsByUser = async (userId: number, workspaceId: number) => {
  const { rows } = await getDb().query<ItemRow>(
    `${itemSelect}
    JOIN public.user_workspace_v1 w ON w.id=n.workspace_id
    WHERE w.user_id=$1 AND n.workspace_id=$2
    ORDER BY n.time_due ASC NULLS LAST,n.time_modified DESC,n.id ASC`,
    [userId, workspaceId],
  )
  return rows.map(mapItem)
}
export const selectItemEmbeddingStateById = async (itemId: number, userId: number) => {
  const { rows } = await getDb().query<{
    description: string | null
    has_embedding: boolean
    embedding_model: string | null
  }>(
    `SELECT n.description,(n.description_embedding IS NOT NULL) has_embedding,n.embedding_model
     FROM public.workspace_item_v1 n JOIN public.user_workspace_v1 w ON w.id=n.workspace_id
     WHERE n.id=$1 AND w.user_id=$2`,
    [itemId, userId],
  )
  return rows[0] ?? null
}
export const listItemsMissingEmbeddingsByUser = async (userId: number, limit: number) => {
  const { rows } = await getDb().query<ItemEmbeddingBackfillRow>(
    `SELECT n.id,n.description FROM public.workspace_item_v1 n
    JOIN public.user_workspace_v1 w ON w.id=n.workspace_id WHERE w.user_id=$1 AND NULLIF(btrim(n.description),'') IS NOT NULL
    AND n.description_embedding IS NULL ORDER BY n.id LIMIT $2`,
    [userId, limit],
  )
  return rows
}
export const listItemsStaleEmbeddingsByUser = async (userId: number, limit: number) => {
  const { rows } = await getDb().query<ItemEmbeddingBackfillRow>(
    `SELECT n.id,n.description FROM public.workspace_item_v1 n
    JOIN public.user_workspace_v1 w ON w.id=n.workspace_id WHERE w.user_id=$1 AND NULLIF(btrim(n.description),'') IS NOT NULL
    AND (n.embedding_model IS DISTINCT FROM $2 OR n.description_embedding IS NULL) ORDER BY n.id LIMIT $3`,
    [userId, CURRENT_ITEM_EMBEDDING_MODEL, limit],
  )
  return rows
}
export const searchItemsByEmbedding = async (
  userId: number,
  workspaceId: number,
  queryEmbedding: string,
  limit: number,
) => {
  const { rows } = await getDb().query<SemanticSearchRow>(
    `SELECT ${itemColumns},
    CASE WHEN n.description_embedding IS NOT NULL THEN 1-(n.description_embedding <=> $3::vector) ELSE 0 END semantic_similarity
    FROM public.workspace_item_v1 n LEFT JOIN public.workspace_status_v1 s ON s.id=n.status_id AND s.workspace_id=n.workspace_id
    JOIN public.user_workspace_v1 w ON w.id=n.workspace_id WHERE w.user_id=$1 AND n.workspace_id=$2
    ORDER BY semantic_similarity DESC,n.time_modified DESC LIMIT $4`,
    [userId, workspaceId, queryEmbedding, limit],
  )
  return rows.map<SemanticSearchResult>((row) => ({
    item: mapItem(row),
    similarity: row.semantic_similarity,
  }))
}
