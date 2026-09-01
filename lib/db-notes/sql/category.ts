import { getDb } from "../lib/db/postgres";
import type { CategoryRecord } from "../contracts/notes-app";
import { CURRENT_NOTE_EMBEDDING_MODEL } from "../services/notes-embeddings";
import type { PoolClient } from "pg";

export interface CategoryEmbeddingBackfillRow {
  id: number;
  label: string;
}

interface CategoryWithCountRow {
  id: number;
  user_id: number;
  label: string;
  time_created: Date;
  time_modified: Date;
  category_embedding: string | null;
  embedding_model: string | null;
  embedding_updated_at: Date | null;
  note_count: number | string | null;
  last_used_at: Date | string | null;
}

const categorySelect = `
  SELECT
    c.id,
    c.user_id,
    c.label,
    c.time_created,
    c.time_modified,
    c.category_embedding,
    c.embedding_model,
    c.embedding_updated_at,
    (
      SELECT COUNT(*)::int
      FROM public.user_note_v1 n
      WHERE n.category_id = c.id
    ) AS note_count,
    (
      SELECT MAX(n.time_modified)
      FROM public.user_note_v1 n
      WHERE n.category_id = c.id
        AND n.user_id = c.user_id
    ) AS last_used_at
  FROM public.user_note_category_v1 c
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

const mapCategory = (row: CategoryWithCountRow): CategoryRecord => ({
  id: row.id,
  userId: row.user_id,
  label: row.label,
  noteCount: Number(row.note_count ?? 0),
  lastUsedAt: toIsoStringOrNull(row.last_used_at),
});

export const DEFAULT_CATEGORY_LABEL = "uncategorized";

/**
 * Give a new user somewhere to put their first note.
 *
 * A note requires a real category — `ensureCategoryIdForUser` rejects anything
 * else, and the editor will not even attempt a save without one — so a user
 * with no categories cannot save at all. Tags already seed a default this way;
 * categories did not, which left every brand-new account unable to store a
 * note until it created a category by hand.
 */
export const ensureDefaultCategoryForUser = async (
  client: PoolClient,
  userId: number
) => {
  // Only for an account with none at all. Seeding unconditionally would add an
  // "uncategorized" category to every existing user, including those who have
  // deliberately curated their own set.
  await client.query(
    `
      INSERT INTO public.user_note_category_v1 (user_id, label)
      SELECT $1, $2
      WHERE NOT EXISTS (
        SELECT 1 FROM public.user_note_category_v1 WHERE user_id = $1
      )
      ON CONFLICT (user_id, label) DO NOTHING
    `,
    [userId, DEFAULT_CATEGORY_LABEL]
  );
};

export const getFirstCategoryForUser = async (
  client: PoolClient,
  userId: number
): Promise<{ id: number; label: string } | null> => {
  const { rows } = await client.query<{ id: number; label: string }>(
    `
      SELECT id, label
      FROM public.user_note_category_v1
      WHERE user_id = $1
      ORDER BY id ASC
      LIMIT 1
    `,
    [userId]
  );
  return rows[0] ?? null;
};

export const listCategoriesByUser = async (userId: number) => {
  const { rows } = await getDb().query<CategoryWithCountRow>(
    `
      ${categorySelect}
      WHERE c.user_id = $1
      ORDER BY last_used_at DESC NULLS LAST, lower(c.label) ASC, c.id ASC
    `,
    [userId]
  );

  return rows.map(mapCategory);
};

export const getCategoryByIdForUser = async (
  userId: number,
  categoryId: number
) => {
  const { rows } = await getDb().query<CategoryWithCountRow>(
    `
      ${categorySelect}
      WHERE c.user_id = $1
        AND c.id = $2
      LIMIT 1
    `,
    [userId, categoryId]
  );

  return rows[0] ? mapCategory(rows[0]) : null;
};

export const listCategoriesMissingEmbeddingsByUser = async (
  userId: number,
  limit: number
) => {
  const { rows } = await getDb().query<CategoryEmbeddingBackfillRow>(
    `
      SELECT id, label
      FROM public.user_note_category_v1
      WHERE user_id = $1
        AND NULLIF(btrim(label), '') IS NOT NULL
        AND category_embedding IS NULL
      ORDER BY id ASC
      LIMIT $2
    `,
    [userId, limit]
  );

  return rows;
};

export const listCategoriesStaleEmbeddingsByUser = async (
  userId: number,
  limit: number
) => {
  const { rows } = await getDb().query<CategoryEmbeddingBackfillRow>(
    `
      SELECT id, label
      FROM public.user_note_category_v1
      WHERE user_id = $1
        AND NULLIF(btrim(label), '') IS NOT NULL
        AND (
          embedding_model IS DISTINCT FROM $2
          OR category_embedding IS NULL
        )
      ORDER BY id ASC
      LIMIT $3
    `,
    [userId, CURRENT_NOTE_EMBEDDING_MODEL, limit]
  );

  return rows;
};

export const updateCategoryEmbeddingById = async (
  categoryId: number,
  userId: number,
  vectorLiteral: string | null,
  embeddingModel: string | null
) => {
  await getDb().query(
    `
      UPDATE public.user_note_category_v1
      SET
        category_embedding = $1::vector,
        embedding_model = $2,
        embedding_updated_at = $3
      WHERE id = $4
        AND user_id = $5
    `,
    [
      vectorLiteral,
      embeddingModel,
      embeddingModel ? new Date().toISOString() : null,
      categoryId,
      userId,
    ]
  );
};

export const updateCategoryLabelForUser = async (
  client: PoolClient,
  userId: number,
  categoryId: number,
  label: string
) => {
  const { rows } = await client.query<{ id: number }>(
    `
      UPDATE public.user_note_category_v1
      SET label = $1
      WHERE id = $2
        AND user_id = $3
      RETURNING id
    `,
    [label, categoryId, userId]
  );

  return rows[0]?.id ?? null;
};

export const deleteCategoryForUser = async (
  userId: number,
  categoryId: number,
  fallbackCategoryId: number
) => {
  const client = await getDb().connect();

  try {
    await client.query("BEGIN");

    if (categoryId === fallbackCategoryId) {
      throw new Error("Cannot delete the fallback category.");
    }

    const fallbackResult = await client.query<{ count: number | string }>(
      `
        SELECT COUNT(*)::int AS count
        FROM public.user_note_category_v1
        WHERE user_id = $1
          AND id = $2
      `,
      [userId, fallbackCategoryId]
    );

    if (Number(fallbackResult.rows[0]?.count ?? 0) !== 1) {
      throw new Error("Fallback category was not found for this user.");
    }

    const noteCountResult = await client.query<{ count: number | string }>(
      `
        SELECT COUNT(*)::int AS count
        FROM public.user_note_v1 n
        WHERE n.user_id = $1
          AND n.category_id = $2
      `,
      [userId, categoryId]
    );

    const noteCount = Number(noteCountResult.rows[0]?.count ?? 0);

    if (noteCount > 0) {
      await client.query(
        `
          UPDATE public.user_note_v1
          SET category_id = $3
          WHERE user_id = $1
            AND category_id = $2
        `,
        [userId, categoryId, fallbackCategoryId]
      );
    }

    const deleteResult = await client.query(
      `
        DELETE FROM public.user_note_category_v1
        WHERE id = $1
          AND user_id = $2
      `,
      [categoryId, userId]
    );

    await client.query("COMMIT");

    return {
      deleted: (deleteResult.rowCount ?? 0) > 0,
      reassignedNotes: noteCount,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

export const deleteCategoryWithNotesForUser = async (
  userId: number,
  categoryId: number,
  fallbackCategoryId: number
) => {
  const client = await getDb().connect();

  try {
    await client.query("BEGIN");

    if (categoryId === fallbackCategoryId) {
      throw new Error("Cannot delete the fallback category.");
    }

    const categoryResult = await client.query<{ count: number | string }>(
      `
        SELECT COUNT(*)::int AS count
        FROM public.user_note_category_v1
        WHERE user_id = $1
          AND id = $2
      `,
      [userId, categoryId]
    );

    if (Number(categoryResult.rows[0]?.count ?? 0) !== 1) {
      await client.query("COMMIT");
      return {
        deleted: false,
        deletedNotes: 0,
      };
    }

    const deleteNotesResult = await client.query(
      `
        DELETE FROM public.user_note_v1
        WHERE user_id = $1
          AND category_id = $2
      `,
      [userId, categoryId]
    );

    const deletedNotes = deleteNotesResult.rowCount ?? 0;

    const deleteResult = await client.query(
      `
        DELETE FROM public.user_note_category_v1
        WHERE id = $1
          AND user_id = $2
      `,
      [categoryId, userId]
    );

    await client.query("COMMIT");

    return {
      deleted: (deleteResult.rowCount ?? 0) > 0,
      deletedNotes,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};
