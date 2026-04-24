import { getDb } from "../../lib/db/postgres";
import { CURRENT_NOTE_EMBEDDING_MODEL } from "../../services/notes-embeddings";
import { mapNote, noteColumns, noteSelect, type NoteRow } from "./shared";
import type {
  NoteEmbeddingBackfillRow,
  SemanticSearchResult,
} from "./types";

interface SemanticSearchRow extends NoteRow {
  semantic_similarity: number;
  tag_similarity: number | null;
  category_similarity: number | null;
  description_similarity: number | null;
}

export const listNotesByUser = async (userId: number) => {
  const { rows } = await getDb().query<NoteRow>(
    `
      ${noteSelect}
      WHERE n.user_id = $1
      ORDER BY n.time_due ASC, n.id ASC
    `,
    [userId]
  );

  return rows.map(mapNote);
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
 * score = description_similarity * 0.67 + avg_taxonomy_similarity * 0.33
 *
 * Description is the primary signal. The note's category and all linked tags
 * contribute equally via their average taxonomy similarity, weighted at 1/3.
 *
 * Every note for the user is included: missing embeddings contribute null
 * similarities, which become 0 in the combined score, so low‑relevance
 * matches still appear (after stronger matches), up to the requested limit.
 */
export const searchNotesByEmbedding = async (
  userId: number,
  queryEmbedding: string,
  limit: number
) => {
  const { rows } = await getDb().query<SemanticSearchRow>(
    `
      SELECT
        s.*,
        COALESCE(s.description_similarity, 0) * 0.67
        + COALESCE(
            CASE
              WHEN s.category_similarity IS NULL AND s.tag_similarity IS NULL THEN NULL
              WHEN s.category_similarity IS NULL THEN s.tag_similarity
              WHEN s.tag_similarity IS NULL THEN s.category_similarity
              ELSE (s.category_similarity + s.tag_similarity) / 2.0
            END,
            0
          ) * 0.33
        AS semantic_similarity
      FROM (
        SELECT
          ${noteColumns},
          CASE WHEN n.description_embedding IS NOT NULL
            THEN 1 - (n.description_embedding <=> $2::vector) ELSE NULL END
            AS description_similarity,
          CASE
            WHEN cat.category_embedding IS NOT NULL
             AND NULLIF(btrim(cat.label), '') IS NOT NULL
            THEN 1 - (cat.category_embedding <=> $2::vector)
            ELSE NULL
          END AS category_similarity,
          (
            SELECT AVG(1 - (tag.tag_embedding <=> $2::vector))
            FROM public.user_note_tag_link_v1 l
            JOIN public.user_note_tag_v1 tag
              ON tag.id = l.tag_id
             AND tag.user_id = n.user_id
            WHERE l.note_id = n.id
              AND tag.tag_embedding IS NOT NULL
              AND NULLIF(btrim(tag.label), '') IS NOT NULL
          ) AS tag_similarity
        FROM public.user_note_v1 n
        JOIN public.user_note_category_v1 cat
          ON cat.id = n.category_id
         AND cat.user_id = n.user_id
        WHERE n.user_id = $1
      ) s
      ORDER BY semantic_similarity DESC, s.time_modified DESC
      LIMIT $3
    `,
    [userId, queryEmbedding, limit]
  );

  return rows.map<SemanticSearchResult>((row) => ({
    note: mapNote(row),
    similarity: row.semantic_similarity,
    tagSimilarity: row.tag_similarity,
    categorySimilarity: row.category_similarity,
    descriptionSimilarity: row.description_similarity,
  }));
};
