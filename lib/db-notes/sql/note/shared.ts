import type { NoteCategoryRef, NoteTagRef, NoteRecord } from "./types"
import type { PoolClient } from "pg"

export const noteColumns = `
  n.id, n.workspace_id, n.description, n.time_due, n.time_remind,
  n.time_created, n.time_modified,
  CASE WHEN s.id IS NULL THEN NULL ELSE json_build_object('id', s.id, 'label', s.label) END AS status,
  COALESCE((SELECT json_agg(json_build_object('id', c.id, 'label', c.label) ORDER BY lower(c.label), c.id)
    FROM public.user_note_category_link_v1 l
    JOIN public.workspace_note_category_v1 c ON c.id=l.category_id AND c.workspace_id=n.workspace_id
    WHERE l.note_id=n.id), '[]'::json) AS categories,
  COALESCE((SELECT json_agg(json_build_object('id', t.id, 'label', t.label) ORDER BY lower(t.label), t.id)
    FROM public.user_note_tag_link_v1 l
    JOIN public.workspace_note_tag_v1 t ON t.id=l.tag_id AND t.workspace_id=n.workspace_id
    WHERE l.note_id=n.id), '[]'::json) AS tags
`

export const noteSelect = `SELECT ${noteColumns} FROM public.user_note_v1 n
  LEFT JOIN public.workspace_note_status_v1 s ON s.id=n.status_id AND s.workspace_id=n.workspace_id`

export interface NoteRow {
  id: number
  workspace_id: number
  description: string | null
  time_due: Date | null
  time_remind: Date | null
  time_created: Date
  time_modified: Date
  categories: unknown
  status: unknown
  tags: unknown
}

export const toNullableText = (value: string) => (value.trim() === "" ? null : value.trim())

const parseRefs = (value: unknown): NoteCategoryRef[] =>
  Array.isArray(value)
    ? value.filter(
        (item): item is NoteCategoryRef =>
          typeof item === "object" &&
          item !== null &&
          typeof (item as NoteCategoryRef).id === "number" &&
          typeof (item as NoteCategoryRef).label === "string",
      )
    : []

export const mapNote = (row: NoteRow): NoteRecord => ({
  id: row.id,
  workspaceId: row.workspace_id,
  categories: parseRefs(row.categories),
  status: parseRefs([row.status])[0] ?? null,
  tags: parseRefs(row.tags) as NoteTagRef[],
  description: row.description,
  timeDue: row.time_due?.toISOString() ?? null,
  timeRemind: row.time_remind?.toISOString() ?? null,
  timeCreated: row.time_created.toISOString(),
  timeModified: row.time_modified.toISOString(),
})

const ensureIds = async (
  client: PoolClient,
  table: string,
  workspaceId: number,
  ids: number[],
  label: string,
) => {
  const unique = [...new Set(ids)]
  if (!unique.length) return unique
  const { rows } = await client.query<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM public.${table} WHERE workspace_id=$1 AND id=ANY($2::int[])`,
    [workspaceId, unique],
  )
  if (rows[0]?.count !== unique.length)
    throw new Error(`One or more ${label} were not found for this workspace.`)
  return unique
}

export const ensureStatusIdForWorkspace = async (
  client: PoolClient,
  workspaceId: number,
  statusId: number | null,
) => {
  if (statusId === null) return
  const result = await client.query(
    `SELECT 1 FROM public.workspace_note_status_v1 WHERE workspace_id=$1 AND id=$2`,
    [workspaceId, statusId],
  )
  if (result.rowCount !== 1) throw new Error("Status was not found for this workspace.")
}

const replaceLinks = async (
  client: PoolClient,
  kind: "category" | "tag",
  noteId: number,
  workspaceId: number,
  ids: number[],
) => {
  const vocabulary = kind === "category" ? "workspace_note_category_v1" : "workspace_note_tag_v1"
  const unique = await ensureIds(client, vocabulary, workspaceId, ids, `${kind} ids`)
  const links = `user_note_${kind}_link_v1`
  const column = `${kind}_id`
  await client.query(`DELETE FROM public.${links} WHERE note_id=$1`, [noteId])
  if (unique.length)
    await client.query(
      `INSERT INTO public.${links} (note_id, ${column}, workspace_id) SELECT $1, value, $2 FROM unnest($3::int[]) value`,
      [noteId, workspaceId, unique],
    )
}

export const replaceNoteCategoriesForNote = (
  client: PoolClient,
  noteId: number,
  workspaceId: number,
  ids: number[],
) => replaceLinks(client, "category", noteId, workspaceId, ids)
export const replaceNoteTagsForNote = (
  client: PoolClient,
  noteId: number,
  workspaceId: number,
  ids: number[],
) => replaceLinks(client, "tag", noteId, workspaceId, ids)

export const selectNoteById = async (client: PoolClient, noteId: number, userId: number) => {
  const { rows } = await client.query<NoteRow>(
    `${noteSelect}
    JOIN public.user_workspace_v1 w ON w.id=n.workspace_id
    WHERE n.id=$1 AND w.user_id=$2 LIMIT 1`,
    [noteId, userId],
  )
  return rows[0] ? mapNote(rows[0]) : null
}

const resolve = async (client: PoolClient, table: string, workspaceId: number, label: string) => {
  const normalized = label.trim().toLocaleLowerCase()
  if (!normalized) return null
  const { rows } = await client.query<{ id: number }>(
    `INSERT INTO public.${table} (workspace_id,label) VALUES ($1,$2)
     ON CONFLICT (workspace_id,label) DO UPDATE SET label=EXCLUDED.label RETURNING id`,
    [workspaceId, normalized],
  )
  return rows[0]?.id ?? null
}
export const resolveCategoryIdForWorkspace = (
  client: PoolClient,
  workspaceId: number,
  label: string,
) => resolve(client, "workspace_note_category_v1", workspaceId, label)
export const resolveTagIdForWorkspace = (client: PoolClient, workspaceId: number, label: string) =>
  resolve(client, "workspace_note_tag_v1", workspaceId, label)
