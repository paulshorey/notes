import { getDb } from "../../lib/db/postgres";
import { CURRENT_NOTE_EMBEDDING_MODEL } from "../../services/notes-embeddings";
import { mapNote, noteColumns, noteSelect, type NoteRow } from "./shared";
import type {
  NoteEmbeddingBackfillRow,
  SemanticSearchResult,
} from "./types";

interface SemanticSearchRow extends NoteRow {
  semantic_similarity: number;
}

export const listNotesByUser = async (userId: number) => {
  const { rows } = await getDb().query<NoteRow>(
    `
      ${noteSelect}
      WHERE n.user_id = $1
      ORDER BY n.time_due ASC NULLS LAST, n.time_modified DESC, n.id ASC
    `,
    [userId]
  );

  return rows.map(mapNote);
};

/**
 * Just enough of a note to decide whether its embedding still needs rewriting.
 * Cheap next to the external embeddings call it can avoid.
 */
export const selectNoteEmbeddingStateById = async (
  noteId: number,
  userId: number
) => {
  const { rows } = await getDb().query<{
    description: string | null;
    has_embedding: boolean;
    embedding_model: string | null;
  }>(
    `
      SELECT
        n.description,
        (n.description_embedding IS NOT NULL) AS has_embedding,
        n.embedding_model
      FROM public.user_note_v1 n
      WHERE n.id = $1
        AND n.user_id = $2
    `,
    [noteId, userId]
  );

  return rows[0] ?? null;
};

export const listNotesMissingEmbeddingsByUser = async (
  userId: number,
  limit: number
) => {
  const { rows } = await getDb().query<NoteEmbeddingBackfillRow>(
    `
      SELECT n.id, n.description
      FROM public.user_note_v1 n
      WHERE n.user_id = $1
        AND NULLIF(btrim(n.description), '') IS NOT NULL
        AND n.description_embedding IS NULL
      ORDER BY n.id ASC
      LIMIT $2
    `,
    [userId, limit]
  );

  return rows;
};

export const listNotesStaleEmbeddingsByUser = async (
  userId: number,
  limit: number
) => {
  const { rows } = await getDb().query<NoteEmbeddingBackfillRow>(
    `
      SELECT n.id, n.description
      FROM public.user_note_v1 n
      WHERE n.user_id = $1
        AND NULLIF(btrim(n.description), '') IS NOT NULL
        AND (
          n.embedding_model IS DISTINCT FROM $2
          OR n.description_embedding IS NULL
        )
      ORDER BY n.id ASC
      LIMIT $3
    `,
    [userId, CURRENT_NOTE_EMBEDDING_MODEL, limit]
  );

  return rows;
};

/**
 * Rank notes by cosine similarity between the query vector and the note's
 * stored description embedding. Category and tag embeddings are stored on
 * write but are not part of search ranking.
 *
 * Every note for the user is included: missing embeddings score 0, so
 * low‑relevance matches still appear (after stronger matches), up to the
 * requested limit.
 */
export const searchNotesByEmbedding = async (
  userId: number,
  queryEmbedding: string,
  limit: number
) => {
  const { rows } = await getDb().query<SemanticSearchRow>(
    `
      SELECT
        ${noteColumns},
        CASE
          WHEN n.description_embedding IS NOT NULL
          THEN 1 - (n.description_embedding <=> $2::vector)
          ELSE 0
        END AS semantic_similarity
      FROM public.user_note_v1 n
      JOIN public.user_note_category_v1 cat
        ON cat.id = n.category_id
       AND cat.user_id = n.user_id
      WHERE n.user_id = $1
      ORDER BY semantic_similarity DESC, n.time_modified DESC
      LIMIT $3
    `,
    [userId, queryEmbedding, limit]
  );

  return rows.map<SemanticSearchResult>((row) => ({
    note: mapNote(row),
    similarity: row.semantic_similarity,
  }));
};
