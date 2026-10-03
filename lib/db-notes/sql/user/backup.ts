import { randomUUID } from "node:crypto"
import type { PoolClient } from "pg"
import type {
  BackupNote,
  BackupVocabulary,
  BackupStatus,
  BackupWorkspace,
  RestoreBackupResponse,
  UserBackup,
  UserPreferences,
} from "../../contracts/notes-app"
import {
  parseUserBackup,
  USER_BACKUP_FORMAT,
  USER_BACKUP_VERSION,
} from "../../contracts/user-backup"
import { getDb } from "../../lib/db/postgres"
import { mergeAnonymousUserIntoWithClient } from "./anonymous"

export class BackupAccountError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

type DatedRow = { id: number; label: string; time_created: Date; time_modified: Date }
const dated = (row: DatedRow): BackupVocabulary => ({
  label: row.label,
  timeCreated: row.time_created.toISOString(),
  timeModified: row.time_modified.toISOString(),
})

/** Every query sees the same snapshot, even if another tab saves during export. */
export const exportUserBackup = async (userId: number): Promise<UserBackup> => {
  const client = await getDb().connect()
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY")
    const user = (
      await client.query<{ preferences: UserPreferences }>(
        `SELECT preferences FROM public.user_v1 WHERE id=$1`,
        [userId],
      )
    ).rows[0]
    if (!user) throw new BackupAccountError("User not found.", 401)
    const workspaceRows = (
      await client.query<DatedRow>(
        `SELECT id,label,time_created,time_modified FROM public.user_workspace_v1 WHERE user_id=$1 ORDER BY id`,
        [userId],
      )
    ).rows
    const workspaces: BackupWorkspace[] = []
    for (const w of workspaceRows) {
      const categories = (
        await client.query<DatedRow>(
          `SELECT id,label,time_created,time_modified FROM public.workspace_note_category_v1 WHERE workspace_id=$1 ORDER BY label`,
          [w.id],
        )
      ).rows
      const statuses = (
        await client.query<DatedRow & { position: number }>(
          `SELECT id,label,position,time_created,time_modified FROM public.workspace_note_status_v1 WHERE workspace_id=$1 ORDER BY position,label`,
          [w.id],
        )
      ).rows
      const tags = (
        await client.query<DatedRow>(
          `SELECT id,label,time_created,time_modified FROM public.workspace_note_tag_v1 WHERE workspace_id=$1 ORDER BY label`,
          [w.id],
        )
      ).rows
      const notes = (
        await client.query<{
          description: string | null
          categories: string[]
          status: string | null
          tags: string[]
          time_due: Date | null
          time_remind: Date | null
          time_created: Date
          time_modified: Date
        }>(
          `SELECT n.description,n.time_due,n.time_remind,n.time_created,n.time_modified,s.label status,
          ARRAY(SELECT c.label FROM public.user_note_category_link_v1 l
            JOIN public.workspace_note_category_v1 c ON c.id=l.category_id WHERE l.note_id=n.id ORDER BY c.label) categories,
          ARRAY(SELECT t.label FROM public.user_note_tag_link_v1 l
            JOIN public.workspace_note_tag_v1 t ON t.id=l.tag_id WHERE l.note_id=n.id ORDER BY t.label) tags
         FROM public.user_note_v1 n LEFT JOIN public.workspace_note_status_v1 s ON s.id=n.status_id
         WHERE n.workspace_id=$1 ORDER BY n.id`,
          [w.id],
        )
      ).rows
      workspaces.push({
        ...dated(w),
        categories: categories.map(dated),
        tags: tags.map(dated),
        statuses: statuses.map((s) => ({ ...dated(s), position: s.position })),
        notes: notes.map((n) => ({
          description: n.description,
          categories: n.categories,
          status: n.status,
          tags: n.tags,
          timeDue: n.time_due?.toISOString() ?? null,
          timeRemind: n.time_remind?.toISOString() ?? null,
          timeCreated: n.time_created.toISOString(),
          timeModified: n.time_modified.toISOString(),
        })),
      })
    }
    const currentId = user.preferences.notesApp?.currentWorkspaceId
    const activeWorkspaceLabel = workspaceRows.find((w) => w.id === currentId)?.label ?? null
    const preferences = structuredClone(user.preferences)
    if (preferences.notesApp) delete preferences.notesApp.currentWorkspaceId
    await client.query("COMMIT")
    return {
      format: USER_BACKUP_FORMAT,
      version: USER_BACKUP_VERSION,
      exportedAt: new Date().toISOString(),
      preferences,
      activeWorkspaceLabel,
      workspaces,
    }
  } catch (error) {
    await client.query("ROLLBACK")
    throw error
  } finally {
    client.release()
  }
}

// These identifiers are fixed here; no SQL identifier comes from an uploaded file.
const insertVocabulary = async (
  client: PoolClient,
  workspaceId: number,
  table: "workspace_note_category_v1" | "workspace_note_status_v1" | "workspace_note_tag_v1",
  values: BackupVocabulary[] | BackupStatus[],
) => {
  const status = table === "workspace_note_status_v1"
  await client.query(
    `INSERT INTO public.${table}(workspace_id,label,time_created,time_modified${status ? ",position" : ""})
     SELECT $1,label,"timeCreated","timeModified"${status ? ",position" : ""}
     FROM jsonb_to_recordset($2::jsonb) v(label text,"timeCreated" timestamptz,"timeModified" timestamptz,position int)`,
    [workspaceId, JSON.stringify(values)],
  )
}

const insertNotes = async (client: PoolClient, workspaceId: number, values: BackupNote[]) => {
  // One statement stages every note and its relations. Link inserts depend on
  // inserted ids, so foreign keys see the notes written by the same statement.
  await client.query(
    `WITH notes AS MATERIALIZED (
       SELECT nextval('public.user_note_v1_id_seq')::int id,v.* FROM jsonb_to_recordset($2::jsonb)
         v(description text,status text,categories text[],tags text[],"timeDue" timestamptz,
           "timeRemind" timestamptz,"timeCreated" timestamptz,"timeModified" timestamptz)
     ), inserted AS (
       INSERT INTO public.user_note_v1(id,workspace_id,status_id,description,time_due,time_remind,time_created,time_modified)
       SELECT n.id,$1,s.id,n.description,n."timeDue",n."timeRemind",n."timeCreated",n."timeModified"
       FROM notes n LEFT JOIN public.workspace_note_status_v1 s ON s.workspace_id=$1 AND s.label=n.status
       RETURNING id
     ), category_links AS (
       INSERT INTO public.user_note_category_link_v1(note_id,category_id,workspace_id)
       SELECT n.id,c.id,$1 FROM notes n JOIN inserted i ON i.id=n.id
       CROSS JOIN LATERAL unnest(n.categories) labels(label)
       JOIN public.workspace_note_category_v1 c ON c.workspace_id=$1 AND c.label=labels.label
     ), tag_links AS (
       INSERT INTO public.user_note_tag_link_v1(note_id,tag_id,workspace_id)
       SELECT n.id,t.id,$1 FROM notes n JOIN inserted i ON i.id=n.id
       CROSS JOIN LATERAL unnest(n.tags) labels(label)
       JOIN public.workspace_note_tag_v1 t ON t.workspace_id=$1 AND t.label=labels.label
     ) SELECT COUNT(*) FROM inserted`,
    [workspaceId, JSON.stringify(values)],
  )
}

/** Stage the validated file as an anonymous source, then call the sign-in merge
 * in the SAME transaction. Failed staging/merge cannot leave temporary users or
 * partially imported data. No source account identity is ever used from the file.
 */
export const restoreUserBackup = async (
  userId: number,
  value: unknown,
): Promise<RestoreBackupResponse> => {
  const backup = parseUserBackup(value)
  const client = await getDb().connect()
  try {
    await client.query("BEGIN")
    const destination = (
      await client.query<{ is_anonymous: boolean }>(
        `SELECT is_anonymous FROM public.user_v1 WHERE id=$1 FOR UPDATE`,
        [userId],
      )
    ).rows[0]
    if (!destination) throw new BackupAccountError("User not found.", 401)
    if (destination.is_anonymous)
      throw new BackupAccountError("Sign in or create an account before restoring a backup.", 403)
    const sourceId = (
      await client.query<{ id: number }>(
        `INSERT INTO public.user_v1(username,is_anonymous,preferences) VALUES($1,true,$2::jsonb) RETURNING id`,
        [`backup-${randomUUID()}`, JSON.stringify(backup.preferences)],
      )
    ).rows[0]!.id
    for (const w of backup.workspaces) {
      const workspaceId = (
        await client.query<{ id: number }>(
          `INSERT INTO public.user_workspace_v1(user_id,label,time_created,time_modified) VALUES($1,$2,$3,$4) RETURNING id`,
          [sourceId, w.label, w.timeCreated, w.timeModified],
        )
      ).rows[0]!.id
      await insertVocabulary(client, workspaceId, "workspace_note_category_v1", w.categories)
      await insertVocabulary(client, workspaceId, "workspace_note_status_v1", w.statuses)
      await insertVocabulary(client, workspaceId, "workspace_note_tag_v1", w.tags)
      await insertNotes(client, workspaceId, w.notes)
    }
    const result = await mergeAnonymousUserIntoWithClient(client, sourceId, userId, {
      deduplicateNotes: true,
    })
    if (backup.activeWorkspaceLabel !== null) {
      await client.query(
        `UPDATE public.user_v1 SET preferences=jsonb_set(preferences,'{notesApp}',
          COALESCE(preferences->'notesApp','{}'::jsonb) || jsonb_build_object('currentWorkspaceId',w.id))
         FROM public.user_workspace_v1 w WHERE user_v1.id=$1 AND w.user_id=$1 AND w.label=$2`,
        [userId, backup.activeWorkspaceLabel],
      )
    }
    await client.query("COMMIT")
    return result
  } catch (error) {
    await client.query("ROLLBACK")
    throw error
  } finally {
    client.release()
  }
}
