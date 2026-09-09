import type { PoolClient } from "pg"
import type { StatusRecord } from "../contracts/notes-app"
import { getDb } from "../lib/db/postgres"
export const DEFAULT_STATUS_LABEL = "backlog"
interface Row {
  id: number
  workspace_id: number
  label: string
  position: number
  note_count: number | string | null
  last_used_at: Date | string | null
}
const map = (r: Row): StatusRecord => ({
  id: r.id,
  workspaceId: r.workspace_id,
  label: r.label,
  position: r.position,
  noteCount: Number(r.note_count ?? 0),
  lastUsedAt: r.last_used_at ? new Date(r.last_used_at).toISOString() : null,
})
const select = `SELECT s.id,s.workspace_id,s.label,s.position,(SELECT COUNT(*)::int FROM public.user_note_v1 n WHERE n.status_id=s.id) note_count,
 (SELECT MAX(n.time_modified) FROM public.user_note_v1 n WHERE n.status_id=s.id) last_used_at FROM public.workspace_note_status_v1 s`
export const ensureDefaultStatusForWorkspace = async (client: PoolClient, workspaceId: number) => {
  await client.query(
    `INSERT INTO public.workspace_note_status_v1(workspace_id,label,position) SELECT $1,$2,0
 WHERE NOT EXISTS(SELECT 1 FROM public.workspace_note_status_v1 WHERE workspace_id=$1) ON CONFLICT(workspace_id,label) DO NOTHING`,
    [workspaceId, DEFAULT_STATUS_LABEL],
  )
}
export const listStatusesByWorkspace = async (userId: number, workspaceId: number) => {
  const { rows } = await getDb().query<Row>(
    `${select} JOIN public.user_workspace_v1 w ON w.id=s.workspace_id
 WHERE w.user_id=$1 AND s.workspace_id=$2 ORDER BY s.position,lower(s.label),s.id`,
    [userId, workspaceId],
  )
  return rows.map(map)
}
export const getStatusByIdForWorkspace = async (
  userId: number,
  workspaceId: number,
  id: number,
) => {
  const { rows } = await getDb().query<Row>(
    `${select} JOIN public.user_workspace_v1 w ON w.id=s.workspace_id
 WHERE w.user_id=$1 AND s.workspace_id=$2 AND s.id=$3`,
    [userId, workspaceId, id],
  )
  return rows[0] ? map(rows[0]) : null
}
export const createStatusForWorkspace = async (
  userId: number,
  workspaceId: number,
  label: string,
) => {
  const { rows } = await getDb().query<{ id: number }>(
    `INSERT INTO public.workspace_note_status_v1(workspace_id,label,position)
 SELECT $2,$3,COALESCE(MAX(s.position)+1,0) FROM public.user_workspace_v1 w LEFT JOIN public.workspace_note_status_v1 s ON s.workspace_id=w.id
 WHERE w.user_id=$1 AND w.id=$2 GROUP BY w.id RETURNING id`,
    [userId, workspaceId, label],
  )
  return rows[0] ? getStatusByIdForWorkspace(userId, workspaceId, rows[0].id) : null
}
export const updateStatusForWorkspace = async (
  userId: number,
  workspaceId: number,
  id: number,
  label: string,
  position?: number,
) => {
  const r = await getDb().query(
    `UPDATE public.workspace_note_status_v1 s SET label=$4,position=COALESCE($5,position)
 FROM public.user_workspace_v1 w WHERE s.id=$3 AND s.workspace_id=$2 AND w.id=$2 AND w.user_id=$1`,
    [userId, workspaceId, id, label, position ?? null],
  )
  return r.rowCount === 1 ? getStatusByIdForWorkspace(userId, workspaceId, id) : null
}
export const deleteStatusForWorkspace = async (userId: number, workspaceId: number, id: number) => {
  const client = await getDb().connect()
  try {
    await client.query("BEGIN")
    const owned = await client.query(
      `SELECT 1 FROM public.workspace_note_status_v1 s JOIN public.user_workspace_v1 w ON w.id=s.workspace_id WHERE s.id=$3 AND s.workspace_id=$2 AND w.user_id=$1 FOR UPDATE`,
      [userId, workspaceId, id],
    )
    if (owned.rowCount !== 1) {
      await client.query("ROLLBACK")
      return false
    }
    await client.query(
      `UPDATE public.user_note_v1 SET status_id=NULL WHERE workspace_id=$1 AND status_id=$2`,
      [workspaceId, id],
    )
    await client.query(
      `DELETE FROM public.workspace_note_status_v1 WHERE id=$1 AND workspace_id=$2`,
      [id, workspaceId],
    )
    await client.query("COMMIT")
    return true
  } catch (e) {
    await client.query("ROLLBACK")
    throw e
  } finally {
    client.release()
  }
}
