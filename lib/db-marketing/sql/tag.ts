import type { UserNoteTagV1Row } from "../generated/typescript/db-types";
import { getDb } from "../lib/db/postgres";
import type { TagRecord } from "../contracts/notes-app";
import { CURRENT_NOTE_EMBEDDING_MODEL } from "../services/notes-embeddings";
import type { PoolClient } from "pg";

export interface TagEmbeddingBackfillRow {
  id: number;
  label: string;
}

interface TagWithCountRow extends UserNoteTagV1Row {
  note_count: number | string | null;
  last_used_at: Date | string | null;
}

const tagSelect = `
  SELECT
    c.id,
    c.user_id,
    c.label,
    (
      SELECT COUNT(*)::int
      FROM public.user_note_tag_link_v1 l
      WHERE l.tag_id = c.id
    ) AS note_count,
    (
      SELECT MAX(n.time_modified)
      FROM public.user_note_tag_link_v1 l
      JOIN public.user_note_v1 n
        ON n.id = l.note_id
       AND n.user_id = c.user_id
      WHERE l.tag_id = c.id
    ) AS last_used_at
  FROM public.user_note_tag_v1 c
`;

const toIsoStringOrNull = (value: Date | string | null): string | null => {
  if (value === null || value === undefined) {
    return null;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  return new Date(value).toISOString();
};

const mapTag = (row: TagWithCountRow): TagRecord => ({
  id: row.id,
  userId: row.user_id,
  label: row.label,
  noteCount: Number(row.note_count ?? 0),
  lastUsedAt: toIsoStringOrNull(row.last_used_at),
});

export const listTagsByUser = async (userId: number) => {
  const { rows } = await getDb().query<TagWithCountRow>(
    `
      ${tagSelect}
      WHERE c.user_id = $1
      ORDER BY last_used_at DESC NULLS LAST, lower(c.label) ASC, c.id ASC
    `,
    [userId]
  );

  return rows.map(mapTag);
};

export const getTagByIdForUser = async (
  userId: number,
  tagId: number
) => {
  const { rows } = await getDb().query<TagWithCountRow>(
    `
      ${tagSelect}
      WHERE c.user_id = $1
        AND c.id = $2
      LIMIT 1
    `,
    [userId, tagId]
  );

  return rows[0] ? mapTag(rows[0]) : null;
};

export const listTagLabelsForUserIds = async (
  userId: number,
  tagIds: number[]
) => {
  const uniqueIds = [...new Set(tagIds)];

  if (uniqueIds.length === 0) {
    return [];
  }

  const { rows } = await getDb().query<{ label: string }>(
    `
      SELECT label
      FROM public.user_note_tag_v1
      WHERE user_id = $1
        AND id = ANY($2::int[])
      ORDER BY lower(label), id
    `,
    [userId, uniqueIds]
  );

  if (rows.length !== uniqueIds.length) {
    throw new Error("One or more tags were not found for this user.");
  }

  return rows.map((row) => row.label);
};

export const listTagsMissingEmbeddingsByUser = async (
  userId: number,
  limit: number
) => {
  const { rows } = await getDb().query<TagEmbeddingBackfillRow>(
    `
      SELECT id, label
      FROM public.user_note_tag_v1
      WHERE user_id = $1
        AND NULLIF(btrim(label), '') IS NOT NULL
        AND tag_embedding IS NULL
      ORDER BY id ASC
      LIMIT $2
    `,
    [userId, limit]
  );

  return rows;
};

export const listTagsStaleEmbeddingsByUser = async (
  userId: number,
  limit: number
) => {
  const { rows } = await getDb().query<TagEmbeddingBackfillRow>(
    `
      SELECT id, label
      FROM public.user_note_tag_v1
      WHERE user_id = $1
        AND NULLIF(btrim(label), '') IS NOT NULL
        AND (
          embedding_model IS DISTINCT FROM $2
          OR tag_embedding IS NULL
        )
      ORDER BY id ASC
      LIMIT $3
    `,
    [userId, CURRENT_NOTE_EMBEDDING_MODEL, limit]
  );

  return rows;
};

export const updateTagEmbeddingById = async (
  tagId: number,
  userId: number,
  vectorLiteral: string | null,
  embeddingModel: string | null
) => {
  await getDb().query(
    `
      UPDATE public.user_note_tag_v1
      SET
        tag_embedding = $1::vector,
        embedding_model = $2,
        embedding_updated_at = $3
      WHERE id = $4
        AND user_id = $5
    `,
    [
      vectorLiteral,
      embeddingModel,
      embeddingModel ? new Date().toISOString() : null,
      tagId,
      userId,
    ]
  );
};

export const updateTagLabelForUser = async (
  client: PoolClient,
  userId: number,
  tagId: number,
  label: string
) => {
  const { rows } = await client.query<{ id: number }>(
    `
      UPDATE public.user_note_tag_v1
      SET label = $1
      WHERE id = $2
        AND user_id = $3
      RETURNING id
    `,
    [label, tagId, userId]
  );

  return rows[0]?.id ?? null;
};

export const deleteTagForUser = async (
  userId: number,
  tagId: number
) => {
  const client = await getDb().connect();

  try {
    await client.query("BEGIN");

    const linkResult = await client.query<{ count: number | string }>(
      `
        SELECT COUNT(*)::int AS count
        FROM public.user_note_tag_link_v1 l
        JOIN public.user_note_tag_v1 c
          ON c.id = l.tag_id
         AND c.user_id = $1
        WHERE l.tag_id = $2
      `,
      [userId, tagId]
    );

    const linkCount = Number(linkResult.rows[0]?.count ?? 0);

    const deleteResult = await client.query(
      `
        DELETE FROM public.user_note_tag_v1
        WHERE id = $1
          AND user_id = $2
      `,
      [tagId, userId]
    );

    await client.query("COMMIT");

    return {
      deleted: (deleteResult.rowCount ?? 0) > 0,
      deletedLinks: linkCount,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};
