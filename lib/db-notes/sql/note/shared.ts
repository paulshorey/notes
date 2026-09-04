import type { NoteTagRef, NoteRecord } from "./types";
import type { PoolClient } from "pg";

/**
 * No taxonomy join: a note carries only its group id, and clients resolve the
 * epic/category/group path from the taxonomy tree they already hold. That keeps
 * labels to one source of truth, so renaming a category does not require
 * refetching every note.
 */
export const noteColumns = `
  n.id,
  n.user_id,
  n.group_id,
  n.description,
  n.time_due,
  n.time_remind,
  n.time_created,
  n.time_modified,
  COALESCE(
    (
      SELECT json_agg(
        json_build_object('id', c.id, 'label', c.label)
        ORDER BY lower(c.label), c.id
      )
      FROM public.user_note_tag_link_v1 l
      JOIN public.user_note_tag_v1 c
        ON c.id = l.tag_id
       AND c.user_id = n.user_id
      WHERE l.note_id = n.id
    ),
    '[]'::json
  ) AS tags
`;

export const noteSelect = `
  SELECT
    ${noteColumns}
  FROM public.user_note_v1 n
`;

export interface NoteRow {
  id: number;
  user_id: number;
  group_id: number;
  description: string | null;
  time_due: Date | null;
  time_remind: Date | null;
  time_created: Date;
  time_modified: Date;
  tags: unknown;
}

export const toNullableText = (value: string) => {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
};

const parseTags = (value: unknown): NoteTagRef[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(
    (item): item is NoteTagRef =>
      typeof item === "object" &&
      item !== null &&
      typeof (item as NoteTagRef).id === "number" &&
      typeof (item as NoteTagRef).label === "string"
  );
};

export const mapNote = (row: NoteRow): NoteRecord => ({
  id: row.id,
  userId: row.user_id,
  groupId: row.group_id,
  tags: parseTags(row.tags),
  description: row.description,
  timeDue: row.time_due?.toISOString() ?? null,
  timeRemind: row.time_remind?.toISOString() ?? null,
  timeCreated: row.time_created.toISOString(),
  timeModified: row.time_modified.toISOString(),
});

export const resolveTagIdForUser = async (
  client: PoolClient,
  userId: number,
  label: string
) => {
  const trimmedLabel = label.trim().toLocaleLowerCase();

  if (trimmedLabel === "") {
    return null;
  }

  // DO UPDATE rather than DO NOTHING: under a concurrent uncommitted insert of
  // the same label, DO NOTHING skips and a follow-up SELECT on the statement's
  // snapshot sees nothing, so the resolve returns no row and throws. Several
  // notes are open at once and each can create a tag.
  const { rows } = await client.query<{ id: number }>(
    `
      INSERT INTO public.user_note_tag_v1 (user_id, label)
      VALUES ($1, $2)
      ON CONFLICT (user_id, label)
      DO UPDATE SET label = EXCLUDED.label
      RETURNING id
    `,
    [userId, trimmedLabel]
  );

  if (!rows[0]) {
    throw new Error("Failed to resolve note tag.");
  }

  return rows[0].id;
};

export const replaceNoteTagsForNote = async (
  client: PoolClient,
  noteId: number,
  userId: number,
  tagIds: number[]
) => {
  const uniqueIds = [...new Set(tagIds)];

  if (uniqueIds.length > 0) {
    const { rows } = await client.query<{ c: number }>(
      `
        SELECT COUNT(*)::int AS c
        FROM public.user_note_tag_v1
        WHERE user_id = $1
          AND id = ANY($2::int[])
      `,
      [userId, uniqueIds]
    );

    if (!rows[0] || rows[0].c !== uniqueIds.length) {
      throw new Error("One or more tags were not found for this user.");
    }
  }

  await client.query(
    `
      DELETE FROM public.user_note_tag_link_v1
      WHERE note_id = $1
    `,
    [noteId]
  );

  if (uniqueIds.length === 0) {
    return;
  }

  await client.query(
    `
      INSERT INTO public.user_note_tag_link_v1 (note_id, tag_id)
      SELECT $1, unnest($2::int[])
    `,
    [noteId, uniqueIds]
  );
};

export const selectNoteById = async (
  client: PoolClient,
  noteId: number,
  userId: number
) => {
  const { rows } = await client.query<NoteRow>(
    `
      ${noteSelect}
      WHERE n.id = $1
        AND n.user_id = $2
    `,
    [noteId, userId]
  );

  return rows[0] ? mapNote(rows[0]) : null;
};
