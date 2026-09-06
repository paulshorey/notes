import { getDb } from "../lib/db/postgres";
import type { TaxonomyLevelRecord } from "../contracts/notes-app";
import { DEFAULT_TAXONOMY_LEVEL_LABELS } from "../contracts/notes-app";
import type { PoolClient } from "pg";

interface TaxonomyLevelRow {
  user_id: number;
  level: number;
  label: string;
}

const mapLevel = (row: TaxonomyLevelRow): TaxonomyLevelRecord => ({
  userId: row.user_id,
  level: Number(row.level),
  label: row.label,
});

/**
 * Give a user the default tier vocabulary if they have none.
 *
 * The analogue of `ensureDefaultTagForUser`: a lazy repair on a read path, so a
 * user-creation route that forgets to seed shows up as a self-healing gap
 * rather than as notes that silently refuse to save. `user_taxonomy_v1` carries
 * a composite FK into this table, so a missing row here makes every taxonomy
 * write for that user fail.
 */
export const ensureTaxonomyLevelsForUser = async (
  client: PoolClient,
  userId: number
) => {
  const values = Object.entries(DEFAULT_TAXONOMY_LEVEL_LABELS)
    .map(([level, label]) => `(${Number(level)}, '${label.replace(/'/g, "''")}')`)
    .join(", ");

  await client.query(
    `
      INSERT INTO public.user_taxonomy_level_v1 (user_id, level, label)
      SELECT $1, v.level, v.label
      FROM (VALUES ${values}) AS v(level, label)
      ON CONFLICT (user_id, level) DO NOTHING
    `,
    [userId]
  );
};

export const listTaxonomyLevelsForUser = async (userId: number) => {
  const { rows } = await getDb().query<TaxonomyLevelRow>(
    `
      SELECT user_id, level, label
      FROM public.user_taxonomy_level_v1
      WHERE user_id = $1
      ORDER BY level ASC
    `,
    [userId]
  );

  return rows.map(mapLevel);
};

export const TAXONOMY_LEVEL_LABEL_TAKEN_ERROR =
  "Another level already uses that name.";

export const updateTaxonomyLevelLabelForUser = async (
  userId: number,
  level: number,
  label: string
) => {
  try {
    const { rows } = await getDb().query<TaxonomyLevelRow>(
      `
        UPDATE public.user_taxonomy_level_v1
        SET label = $3
        WHERE user_id = $1
          AND level = $2
        RETURNING user_id, level, label
      `,
      [userId, level, label]
    );

    return rows[0] ? mapLevel(rows[0]) : null;
  } catch (error) {
    // Two tiers sharing a name makes the UI ambiguous, so the unique index
    // rejects it. That is a conflict the user can act on, not a server fault.
    if (
      error instanceof Error &&
      "code" in error &&
      (error as { code?: string }).code === "23505"
    ) {
      throw new Error(TAXONOMY_LEVEL_LABEL_TAKEN_ERROR);
    }
    throw error;
  }
};
