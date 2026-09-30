import type { PoolClient } from "pg"
import type { WorkspaceRecord } from "../contracts/notes-app"
import { getDb } from "../lib/db/postgres"
import { ensureDefaultCategoryForWorkspace } from "./category"
import { ensureDefaultTagForWorkspace } from "./tag"
import { ensureDefaultStatusForWorkspace } from "./status"
export const DEFAULT_WORKSPACE_LABEL = "personal"
interface Row {
  id: number
  user_id: number
  label: string
  note_count: number | string | null
}
const map = (r: Row): WorkspaceRecord => ({
  id: r.id,
  userId: r.user_id,
  label: r.label,
  noteCount: Number(r.note_count ?? 0),
})
const select = `SELECT w.id,w.user_id,w.label,(SELECT COUNT(*)::int FROM public.user_note_v1 n WHERE n.workspace_id=w.id) note_count FROM public.user_workspace_v1 w`
export const seedWorkspaceDefaults = async (client: PoolClient, workspaceId: number) => {
  await ensureDefaultCategoryForWorkspace(client, workspaceId)
  await ensureDefaultStatusForWorkspace(client, workspaceId)
  await ensureDefaultTagForWorkspace(client, workspaceId)
}
export const ensureDefaultWorkspaceForUser = async (client: PoolClient, userId: number) => {
  const { rows } = await client.query<{ id: number }>(
    `INSERT INTO public.user_workspace_v1(user_id,label) SELECT $1,$2
   WHERE NOT EXISTS(SELECT 1 FROM public.user_workspace_v1 WHERE user_id=$1)
   ON CONFLICT(user_id,label) DO UPDATE SET label=EXCLUDED.label RETURNING id`,
    [userId, DEFAULT_WORKSPACE_LABEL],
  )
  let id = rows[0]?.id
  if (!id) {
    const existing = await client.query<{ id: number }>(
      `SELECT id FROM public.user_workspace_v1 WHERE user_id=$1 ORDER BY id LIMIT 1`,
      [userId],
    )
    id = existing.rows[0]?.id
  }
  if (!id) throw new Error("Failed to ensure a workspace.")
  await seedWorkspaceDefaults(client, id)
  return id
}
export const listWorkspacesByUser = async (userId: number) => {
  const { rows } = await getDb().query<Row>(`${select} WHERE w.user_id=$1 ORDER BY w.id`, [userId])
  return rows.map(map)
}
export const getWorkspaceByIdForUser = async (userId: number, id: number) => {
  const { rows } = await getDb().query<Row>(`${select} WHERE w.user_id=$1 AND w.id=$2`, [
    userId,
    id,
  ])
  return rows[0] ? map(rows[0]) : null
}
export const createWorkspaceForUser = async (userId: number, label: string) => {
  const client = await getDb().connect()
  let workspaceId: number
  try {
    await client.query("BEGIN")
    const { rows } = await client.query<{ id: number }>(
      `INSERT INTO public.user_workspace_v1(user_id,label) VALUES($1,$2) RETURNING id`,
      [userId, label],
    )
    workspaceId = rows[0]!.id
    await seedWorkspaceDefaults(client, workspaceId)
    await client.query("COMMIT")
  } catch (e) {
    await client.query("ROLLBACK")
    throw e
  } finally {
    client.release()
  }
  return (await getWorkspaceByIdForUser(userId, workspaceId))!
}
export const updateWorkspaceForUser = async (userId: number, id: number, label: string) => {
  const r = await getDb().query(
    `UPDATE public.user_workspace_v1 SET label=$3 WHERE id=$2 AND user_id=$1`,
    [userId, id, label],
  )
  return r.rowCount === 1 ? getWorkspaceByIdForUser(userId, id) : null
}
export const deleteWorkspaceForUser = async (userId: number, id: number) => {
  const r = await getDb().query(
    `DELETE FROM public.user_workspace_v1 WHERE id=$2 AND user_id=$1
 AND (SELECT COUNT(*) FROM public.user_workspace_v1 WHERE user_id=$1)>1`,
    [userId, id],
  )
  return r.rowCount === 1
}
