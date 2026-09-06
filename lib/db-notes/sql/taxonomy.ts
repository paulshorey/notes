import { getDb } from "../lib/db/postgres";
import type { TaxonomyRecord } from "../contracts/notes-app";
import {
  DEFAULT_TAXONOMY_NODE_LABELS,
  TAXONOMY_LEVEL_CATEGORY,
  TAXONOMY_LEVEL_EPIC,
  TAXONOMY_LEVEL_GROUP,
} from "../contracts/notes-app";
import { CURRENT_NOTE_EMBEDDING_MODEL } from "../services/notes-embeddings";
import type { PoolClient } from "pg";

export interface TaxonomyEmbeddingBackfillRow {
  id: number;
  label: string;
}

interface TaxonomyRow {
  id: number;
  user_id: number;
  level: number;
  parent_id: number | null;
  label: string;
  note_count: number | string | null;
  direct_note_count: number | string | null;
  last_used_at: Date | string | null;
}

const toIsoStringOrNull = (value: Date | string | null): string | null => {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  return new Date(value).toISOString();
};

const mapTaxonomy = (row: TaxonomyRow): TaxonomyRecord => ({
  id: row.id,
  userId: row.user_id,
  level: Number(row.level),
  parentId: row.parent_id,
  label: row.label,
  noteCount: Number(row.note_count ?? 0),
  directNoteCount: Number(row.direct_note_count ?? 0),
  lastUsedAt: toIsoStringOrNull(row.last_used_at),
});

/**
 * Subtree note counts and last-used times for every row, in one query.
 *
 * Deliberately fixed-depth aggregates rather than a recursive CTE over
 * parent_id. The depth is three and this runs on every taxonomy read, which the
 * client refetches on a coalesced debounce while notes autosave in the
 * background. Measured on 20k notes across ~490 taxonomy rows: 5.5 ms here
 * against 26-31 ms recursive, with identical results. The recursive form is
 * kept in the test suite as the independent oracle this is checked against.
 */
const taxonomySelect = `
  WITH direct AS (
    SELECT g.id AS group_id,
           g.parent_id AS category_id,
           c.parent_id AS epic_id,
           COUNT(n.id)::int AS direct_notes,
           MAX(n.time_modified) AS last_used_at
    FROM public.user_taxonomy_v1 g
    JOIN public.user_taxonomy_v1 c ON c.id = g.parent_id
    LEFT JOIN public.user_note_v1 n ON n.group_id = g.id
    WHERE g.user_id = $1 AND g.level = 3
    GROUP BY g.id, g.parent_id, c.parent_id
  ), by_category AS (
    SELECT category_id AS id, SUM(direct_notes)::int AS notes, MAX(last_used_at) AS last_used_at
    FROM direct GROUP BY category_id
  ), by_epic AS (
    SELECT epic_id AS id, SUM(direct_notes)::int AS notes, MAX(last_used_at) AS last_used_at
    FROM direct GROUP BY epic_id
  )
  SELECT
    t.id,
    t.user_id,
    t.level,
    t.parent_id,
    t.label,
    COALESCE(d.direct_notes, bc.notes, be.notes, 0) AS note_count,
    COALESCE(d.direct_notes, 0) AS direct_note_count,
    COALESCE(d.last_used_at, bc.last_used_at, be.last_used_at) AS last_used_at
  FROM public.user_taxonomy_v1 t
  LEFT JOIN direct d ON t.level = 3 AND d.group_id = t.id
  LEFT JOIN by_category bc ON t.level = 2 AND bc.id = t.id
  LEFT JOIN by_epic be ON t.level = 1 AND be.id = t.id
  WHERE t.user_id = $1
`;

export const listTaxonomyByUser = async (userId: number) => {
  const { rows } = await getDb().query<TaxonomyRow>(
    `${taxonomySelect} ORDER BY t.level ASC, lower(t.label) ASC, t.id ASC`,
    [userId]
  );

  return rows.map(mapTaxonomy);
};

export const getTaxonomyByIdForUser = async (
  userId: number,
  taxonomyId: number
) => {
  const { rows } = await getDb().query<TaxonomyRow>(
    `${taxonomySelect} AND t.id = $2 LIMIT 1`,
    [userId, taxonomyId]
  );

  return rows[0] ? mapTaxonomy(rows[0]) : null;
};

/**
 * Find or create one row by label within its parent.
 *
 * `DO UPDATE` rather than `DO NOTHING` is load-bearing. With `DO NOTHING`, a
 * concurrent uncommitted insert of the same label makes the insert skip and the
 * follow-up SELECT — running on the statement's snapshot — see nothing, so the
 * statement returns zero rows and this throws. Reproduced on PostgreSQL 17.11.
 * Several notes are open at once and each can create a group, so two of them
 * racing on the same name is an ordinary user action, not a corner case.
 * `DO UPDATE` takes the row lock, waits, and always returns an id.
 */
export const resolveTaxonomyIdForUser = async (
  client: PoolClient,
  userId: number,
  level: number,
  parentId: number | null,
  label: string
) => {
  const trimmed = label.trim().toLocaleLowerCase();
  if (trimmed === "") return null;

  const { rows } = await client.query<{ id: number }>(
    `
      INSERT INTO public.user_taxonomy_v1 (user_id, level, parent_id, label)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (user_id, level, parent_id, label)
      DO UPDATE SET label = EXCLUDED.label
      RETURNING id
    `,
    [userId, level, parentId, trimmed]
  );

  const id = rows[0]?.id;
  if (id === undefined) {
    throw new Error("Failed to resolve taxonomy row.");
  }

  return id;
};

/**
 * Resolve a whole Epic > Category > Group path in one transaction.
 *
 * One call rather than three sequential creates: a failure part-way through the
 * three would leave a stray epic with no children, and the picker needs the
 * group id before it can save a note.
 */
export const resolveTaxonomyPathForUser = async (
  userId: number,
  epicLabel: string,
  categoryLabel: string,
  groupLabel: string
) => {
  const client = await getDb().connect();

  try {
    await client.query("BEGIN");

    const epicId = await resolveTaxonomyIdForUser(
      client,
      userId,
      TAXONOMY_LEVEL_EPIC,
      null,
      epicLabel
    );
    if (epicId === null) throw new Error("An epic name is required.");

    const categoryId = await resolveTaxonomyIdForUser(
      client,
      userId,
      TAXONOMY_LEVEL_CATEGORY,
      epicId,
      categoryLabel
    );
    if (categoryId === null) throw new Error("A category name is required.");

    const groupId = await resolveTaxonomyIdForUser(
      client,
      userId,
      TAXONOMY_LEVEL_GROUP,
      categoryId,
      groupLabel
    );
    if (groupId === null) throw new Error("A group name is required.");

    await client.query("COMMIT");
    return { epicId, categoryId, groupId };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

/**
 * Ensure the user has a complete epic > category > group chain.
 *
 * Without one, `isSaveableForm` on the client is false for every note and
 * autosave returns before reaching the network — a failure that looks exactly
 * like success, because the local snapshot reproduces the notes on reload. The
 * migration seeds the chain for existing users; this catches anyone created
 * afterwards by a path that forgot. Default auto-created item labels are
 * epic `all`, category `uncategorized`, group `ungrouped`.
 */
export const ensureDefaultTaxonomyChainForUser = async (
  client: PoolClient,
  userId: number
) => {
  const { rows } = await client.query<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM public.user_taxonomy_v1 WHERE user_id = $1`,
    [userId]
  );

  if (Number(rows[0]?.count ?? 0) > 0) return;

  const epicId = await resolveTaxonomyIdForUser(
    client,
    userId,
    TAXONOMY_LEVEL_EPIC,
    null,
    DEFAULT_TAXONOMY_NODE_LABELS[TAXONOMY_LEVEL_EPIC]
  );
  const categoryId = await resolveTaxonomyIdForUser(
    client,
    userId,
    TAXONOMY_LEVEL_CATEGORY,
    epicId,
    DEFAULT_TAXONOMY_NODE_LABELS[TAXONOMY_LEVEL_CATEGORY]
  );
  await resolveTaxonomyIdForUser(
    client,
    userId,
    TAXONOMY_LEVEL_GROUP,
    categoryId,
    DEFAULT_TAXONOMY_NODE_LABELS[TAXONOMY_LEVEL_GROUP]
  );
};

export const getFirstTaxonomyChildForUser = async (
  client: PoolClient,
  userId: number,
  level: number,
  parentId: number | null
): Promise<{ id: number; label: string } | null> => {
  const { rows } = await client.query<{ id: number; label: string }>(
    `
      SELECT id, label
      FROM public.user_taxonomy_v1
      WHERE user_id = $1
        AND level = $2
        AND parent_id IS NOT DISTINCT FROM $3
      ORDER BY id ASC
      LIMIT 1
    `,
    [userId, level, parentId]
  );

  return rows[0] ?? null;
};

/** The group a note falls back to when its own is gone. Lowest id wins. */
export const getFallbackGroupIdForUser = async (
  client: PoolClient,
  userId: number
): Promise<number | null> => {
  const { rows } = await client.query<{ id: number }>(
    `
      SELECT id
      FROM public.user_taxonomy_v1
      WHERE user_id = $1 AND level = 3
      ORDER BY id ASC
      LIMIT 1
    `,
    [userId]
  );

  return rows[0]?.id ?? null;
};

export const updateTaxonomyLabelForUser = async (
  client: PoolClient,
  userId: number,
  taxonomyId: number,
  label: string
) => {
  const { rows } = await client.query<{ id: number }>(
    `
      UPDATE public.user_taxonomy_v1
      SET label = $1
      WHERE id = $2
        AND user_id = $3
      RETURNING id
    `,
    [label, taxonomyId, userId]
  );

  return rows[0]?.id ?? null;
};

export const TAXONOMY_SIBLING_LABEL_TAKEN_ERROR =
  "Something with that name is already there.";
export const TAXONOMY_MOVE_LEVEL_ERROR =
  "That is not a valid place to move this to.";

/**
 * Re-parent a node. Moving a category moves its groups and notes implicitly,
 * because children reference the parent by id and notes reference only their
 * group — no note row changes and nothing that is mid-save goes stale.
 */
export const moveTaxonomyNodeForUser = async (
  userId: number,
  taxonomyId: number,
  parentId: number
) => {
  try {
    const { rows } = await getDb().query<{ id: number }>(
      `
        UPDATE public.user_taxonomy_v1
        SET parent_id = $3
        WHERE id = $1
          AND user_id = $2
        RETURNING id
      `,
      [taxonomyId, userId, parentId]
    );

    return rows[0]?.id ?? null;
  } catch (error) {
    const code =
      error instanceof Error && "code" in error
        ? (error as { code?: string }).code
        : undefined;
    if (code === "23505") throw new Error(TAXONOMY_SIBLING_LABEL_TAKEN_ERROR);
    // The composite parent FK rejects a parent at the wrong level or owned by
    // someone else; both are the caller's mistake, not a server fault.
    if (code === "23503") throw new Error(TAXONOMY_MOVE_LEVEL_ERROR);
    throw error;
  }
};

export const listTaxonomyMissingEmbeddingsByUser = async (
  userId: number,
  limit: number
) => {
  const { rows } = await getDb().query<TaxonomyEmbeddingBackfillRow>(
    `
      SELECT id, label
      FROM public.user_taxonomy_v1
      WHERE user_id = $1
        AND NULLIF(btrim(label), '') IS NOT NULL
        AND label_embedding IS NULL
      ORDER BY id ASC
      LIMIT $2
    `,
    [userId, limit]
  );

  return rows;
};

export const listTaxonomyStaleEmbeddingsByUser = async (
  userId: number,
  limit: number
) => {
  const { rows } = await getDb().query<TaxonomyEmbeddingBackfillRow>(
    `
      SELECT id, label
      FROM public.user_taxonomy_v1
      WHERE user_id = $1
        AND NULLIF(btrim(label), '') IS NOT NULL
        AND (
          embedding_model IS DISTINCT FROM $2
          OR label_embedding IS NULL
        )
      ORDER BY id ASC
      LIMIT $3
    `,
    [userId, CURRENT_NOTE_EMBEDDING_MODEL, limit]
  );

  return rows;
};

export const updateTaxonomyEmbeddingById = async (
  taxonomyId: number,
  userId: number,
  vectorLiteral: string | null,
  embeddingModel: string | null
) => {
  await getDb().query(
    `
      UPDATE public.user_taxonomy_v1
      SET
        label_embedding = $1::vector,
        embedding_model = $2,
        embedding_updated_at = $3
      WHERE id = $4
        AND user_id = $5
    `,
    [
      vectorLiteral,
      embeddingModel,
      embeddingModel ? new Date().toISOString() : null,
      taxonomyId,
      userId,
    ]
  );
};

/**
 * Level-scoped label autocomplete.
 *
 * Literal matches first, then semantic ones. A two-keystroke prefix carries
 * almost no semantic signal, and the literal half keeps autocomplete working
 * before embeddings have been backfilled.
 */
export const suggestTaxonomyForUser = async (
  userId: number,
  level: number,
  parentId: number | null,
  query: string,
  limit: number,
  queryEmbedding: string | null
) => {
  const { rows } = await getDb().query<TaxonomyRow & { rank: number }>(
    `
      ${taxonomySelect}
        AND t.level = $2
        AND ($3::int IS NULL OR t.parent_id = $3)
        AND (
          t.label LIKE $4 || '%'
          OR t.label LIKE '%' || $4 || '%'
          OR ($5::vector IS NOT NULL AND t.label_embedding IS NOT NULL)
        )
      ORDER BY
        CASE
          WHEN t.label LIKE $4 || '%' THEN 0
          WHEN t.label LIKE '%' || $4 || '%' THEN 1
          ELSE 2
        END ASC,
        CASE
          WHEN $5::vector IS NULL OR t.label_embedding IS NULL THEN 1
          ELSE t.label_embedding <=> $5::vector
        END ASC,
        lower(t.label) ASC
      LIMIT $6
    `,
    [userId, level, parentId, query, queryEmbedding, limit]
  );

  return rows.map(mapTaxonomy);
};

interface DeleteTaxonomyResult {
  deleted: boolean;
  deletedNotes: number;
  deletedNodes: number;
}

/**
 * Delete a node, either promoting its contents into a sibling or removing the
 * whole subtree.
 *
 * `ON DELETE RESTRICT` on both the parent and note foreign keys means an
 * unhandled case fails loudly instead of orphaning rows, so the work here is to
 * empty the subtree deliberately before removing it.
 */
export const deleteTaxonomyNodeForUser = async (
  userId: number,
  taxonomyId: number,
  mode: "reassign-children" | "delete-subtree"
): Promise<DeleteTaxonomyResult> => {
  const client = await getDb().connect();

  try {
    await client.query("BEGIN");

    const { rows: targetRows } = await client.query<{
      id: number;
      level: number;
      parent_id: number | null;
    }>(
      `SELECT id, level, parent_id FROM public.user_taxonomy_v1
       WHERE id = $1 AND user_id = $2`,
      [taxonomyId, userId]
    );

    const target = targetRows[0];
    if (!target) {
      await client.query("ROLLBACK");
      return { deleted: false, deletedNotes: 0, deletedNodes: 0 };
    }

    // Every user keeps at least one full chain, so the last node at a level
    // cannot be removed — otherwise notes would have nowhere to live and the
    // silent-no-save trap opens back up.
    const { rows: siblingRows } = await client.query<{ id: number }>(
      `SELECT id FROM public.user_taxonomy_v1
       WHERE user_id = $1
         AND level = $2
         AND parent_id IS NOT DISTINCT FROM $3
         AND id <> $4
       ORDER BY id ASC
       LIMIT 1`,
      [userId, target.level, target.parent_id, taxonomyId]
    );

    const sibling = siblingRows[0] ?? null;

    if (mode === "reassign-children") {
      if (!sibling) {
        throw new Error(
          "This is the only one left at its level, so there is nowhere to move its contents."
        );
      }

      // Notes first: a group's notes move to the sibling group. For higher
      // levels the children move and carry their notes with them.
      await client.query(
        `UPDATE public.user_note_v1 SET group_id = $2
         WHERE user_id = $1 AND group_id = $3`,
        [userId, sibling.id, taxonomyId]
      );

      await client.query(
        `UPDATE public.user_taxonomy_v1 SET parent_id = $2
         WHERE user_id = $1 AND parent_id = $3`,
        [userId, sibling.id, taxonomyId]
      );

      const deleteResult = await client.query(
        `DELETE FROM public.user_taxonomy_v1 WHERE id = $1 AND user_id = $2`,
        [taxonomyId, userId]
      );

      await client.query("COMMIT");
      return {
        deleted: (deleteResult.rowCount ?? 0) > 0,
        deletedNotes: 0,
        deletedNodes: 1,
      };
    }

    if (!sibling && target.level === 1) {
      throw new Error("This is your only top-level item, so it cannot be deleted.");
    }

    // delete-subtree: collect the subtree, drop its notes, then remove the
    // rows deepest-first so the parent RESTRICT is never violated.
    const { rows: subtreeRows } = await client.query<{ id: number; level: number }>(
      `WITH RECURSIVE subtree AS (
         SELECT id, level FROM public.user_taxonomy_v1
         WHERE id = $1 AND user_id = $2
         UNION ALL
         SELECT t.id, t.level FROM public.user_taxonomy_v1 t
         JOIN subtree s ON t.parent_id = s.id
       )
       SELECT id, level FROM subtree`,
      [taxonomyId, userId]
    );

    const subtreeIds = subtreeRows.map((row) => row.id);

    const deleteNotesResult = await client.query(
      `DELETE FROM public.user_note_v1
       WHERE user_id = $1 AND group_id = ANY($2::int[])`,
      [userId, subtreeIds]
    );

    const orderedIds = [...subtreeRows]
      .sort((left, right) => right.level - left.level)
      .map((row) => row.id);

    for (const id of orderedIds) {
      await client.query(
        `DELETE FROM public.user_taxonomy_v1 WHERE id = $1 AND user_id = $2`,
        [id, userId]
      );
    }

    await client.query("COMMIT");
    return {
      deleted: true,
      deletedNotes: deleteNotesResult.rowCount ?? 0,
      deletedNodes: orderedIds.length,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};
