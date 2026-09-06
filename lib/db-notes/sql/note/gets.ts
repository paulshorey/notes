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
 * Rank a user's notes by how close their text is to the query. Nothing else.
 *
 * The old composite score mixed in the note's category and tag labels at 1/3
 * weight; searching now compares the query only against the note's own text.
 *
 * Two deliberate choices in the shape of this query:
 *
 * Notes with no embedding are excluded rather than scored 0. When the score
 * *is* the description similarity, an un-embedded note has no meaningful score,
 * so padding the results with it is just noise.
 *
 * The ordering expression is the similarity, not the bare `<=>` distance, so
 * this is an exact per-user scan and never an HNSW index scan. That is not an
 * oversight. HNSW walks for the globally nearest vectors and applies `user_id`
 * afterwards, so a user holding a small share of the table can have every
 * candidate filtered out: measured on 20k notes, an index-ordered form returned
 * a full page for a 17k-note account and *zero rows* for a 30-note one, from
 * the same prepared statement. The exact scan is ~55 ms on a 17k-note account
 * and correct at every size.
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
        1 - (n.description_embedding <=> $2::vector) AS semantic_similarity
      FROM public.user_note_v1 n
      WHERE n.user_id = $1
        AND n.description_embedding IS NOT NULL
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
