import { getDb } from "../../lib/db/postgres"
import { CURRENT_NOTE_EMBEDDING_MODEL } from "../../services/notes-embeddings"
import { mapNote, noteColumns, noteSelect, type NoteRow } from "./shared"
import type { NoteEmbeddingBackfillRow, SemanticSearchResult } from "./types"
interface SemanticSearchRow extends NoteRow {
  semantic_similarity: number
}

export const listNotesByUser = async (userId: number, workspaceId: number) => {
  const { rows } = await getDb().query<NoteRow>(
    `${noteSelect}
    JOIN public.user_workspace_v1 w ON w.id=n.workspace_id
    WHERE w.user_id=$1 AND n.workspace_id=$2
    ORDER BY n.time_due ASC NULLS LAST,n.time_modified DESC,n.id ASC`,
    [userId, workspaceId],
  )
  return rows.map(mapNote)
}
export const selectNoteEmbeddingStateById = async (noteId: number, userId: number) => {
  const { rows } = await getDb().query<{
    description: string | null
    has_embedding: boolean
    embedding_model: string | null
  }>(
    `SELECT n.description,(n.description_embedding IS NOT NULL) has_embedding,n.embedding_model
     FROM public.user_note_v1 n JOIN public.user_workspace_v1 w ON w.id=n.workspace_id
     WHERE n.id=$1 AND w.user_id=$2`,
    [noteId, userId],
  )
  return rows[0] ?? null
}
export const listNotesMissingEmbeddingsByUser = async (userId: number, limit: number) => {
  const { rows } = await getDb().query<NoteEmbeddingBackfillRow>(
    `SELECT n.id,n.description FROM public.user_note_v1 n
    JOIN public.user_workspace_v1 w ON w.id=n.workspace_id WHERE w.user_id=$1 AND NULLIF(btrim(n.description),'') IS NOT NULL
    AND n.description_embedding IS NULL ORDER BY n.id LIMIT $2`,
    [userId, limit],
  )
  return rows
}
export const listNotesStaleEmbeddingsByUser = async (userId: number, limit: number) => {
  const { rows } = await getDb().query<NoteEmbeddingBackfillRow>(
    `SELECT n.id,n.description FROM public.user_note_v1 n
    JOIN public.user_workspace_v1 w ON w.id=n.workspace_id WHERE w.user_id=$1 AND NULLIF(btrim(n.description),'') IS NOT NULL
    AND (n.embedding_model IS DISTINCT FROM $2 OR n.description_embedding IS NULL) ORDER BY n.id LIMIT $3`,
    [userId, CURRENT_NOTE_EMBEDDING_MODEL, limit],
  )
  return rows
}
export const searchNotesByEmbedding = async (
  userId: number,
  workspaceId: number,
  queryEmbedding: string,
  limit: number,
) => {
  const { rows } = await getDb().query<SemanticSearchRow>(
    `SELECT ${noteColumns},
    CASE WHEN n.description_embedding IS NOT NULL THEN 1-(n.description_embedding <=> $3::vector) ELSE 0 END semantic_similarity
    FROM public.user_note_v1 n LEFT JOIN public.workspace_note_status_v1 s ON s.id=n.status_id AND s.workspace_id=n.workspace_id
    JOIN public.user_workspace_v1 w ON w.id=n.workspace_id WHERE w.user_id=$1 AND n.workspace_id=$2
    ORDER BY semantic_similarity DESC,n.time_modified DESC LIMIT $4`,
    [userId, workspaceId, queryEmbedding, limit],
  )
  return rows.map<SemanticSearchResult>((row) => ({
    note: mapNote(row),
    similarity: row.semantic_similarity,
  }))
}
