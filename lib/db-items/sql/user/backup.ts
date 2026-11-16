import { randomUUID } from "node:crypto"
import type { PoolClient } from "pg"
import type {
  BackupCategory,
  BackupItem,
  BackupVocabulary,
  BackupStatus,
  BackupWorkspace,
  RestoreBackupResponse,
  UserBackup,
  UserPreferences,
} from "../../contracts/items-app"
import {
  parseUserBackup,
  USER_BACKUP_FORMAT,
  USER_BACKUP_VERSION,
} from "../../contracts/user-backup"
import { getDb } from "../../lib/db/postgres"
import { IMPORT_ITEMS_SQL, PORTABLE_ITEMS_SQL } from "../item/stored-capabilities"
import { mergeAnonymousUserIntoWithClient } from "./anonymous"

export class BackupAccountError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

/** A stored row in its backup form: every field under its own name, times as ISO text. */
const portableItem = ({ id: _id, ...fields }: { id: number } & Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(fields).map(([name, value]) => [
      name,
      value instanceof Date ? value.toISOString() : value,
    ]),
  ) as unknown as BackupItem

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
      await client.query<DatedRow & { uid: string }>(
        `SELECT id,uid,label,time_created,time_modified FROM public.user_workspace_v1 WHERE user_id=$1 ORDER BY id`,
        [userId],
      )
    ).rows
    const workspaces: BackupWorkspace[] = []
    for (const w of workspaceRows) {
      const categories = (
        await client.query<DatedRow>(
          `SELECT id,label,time_created,time_modified FROM public.workspace_category_v1 WHERE workspace_id=$1 ORDER BY label`,
          [w.id],
        )
      ).rows
      const subcategories = (
        await client.query<DatedRow & { category_id: number }>(
          `SELECT sc.id,sc.category_id,sc.label,sc.time_created,sc.time_modified
           FROM public.workspace_subcategory_v1 sc
           JOIN public.workspace_category_v1 c ON c.id=sc.category_id
           WHERE c.workspace_id=$1 ORDER BY sc.label`,
          [w.id],
        )
      ).rows
      const statuses = (
        await client.query<DatedRow & { position: number }>(
          `SELECT id,label,position,time_created,time_modified FROM public.workspace_status_v1 WHERE workspace_id=$1 ORDER BY position,label`,
          [w.id],
        )
      ).rows
      const tags = (
        await client.query<DatedRow>(
          `SELECT id,label,time_created,time_modified FROM public.workspace_tag_v1 WHERE workspace_id=$1 ORDER BY label`,
          [w.id],
        )
      ).rows
      const items = (
        await client.query<{ id: number } & Record<string, unknown>>(PORTABLE_ITEMS_SQL, [w.id])
      ).rows
      workspaces.push({
        uid: w.uid,
        ...dated(w),
        categories: categories.map((category) => ({
          ...dated(category),
          subcategories: subcategories
            .filter((subcategory) => subcategory.category_id === category.id)
            .map(dated),
        })),
        tags: tags.map(dated),
        statuses: statuses.map((s) => ({ ...dated(s), position: s.position })),
        items: items.map(portableItem),
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
  table: "workspace_category_v1" | "workspace_status_v1" | "workspace_tag_v1",
  values: BackupCategory[] | BackupVocabulary[] | BackupStatus[],
) => {
  const status = table === "workspace_status_v1"
  await client.query(
    `INSERT INTO public.${table}(workspace_id,label,time_created,time_modified${status ? ",position" : ""})
     SELECT $1,label,"timeCreated","timeModified"${status ? ",position" : ""}
     FROM jsonb_to_recordset($2::jsonb) v(label text,"timeCreated" timestamptz,"timeModified" timestamptz,position int)`,
    [workspaceId, JSON.stringify(values)],
  )
}

const insertSubcategories = async (
  client: PoolClient,
  workspaceId: number,
  categories: BackupCategory[],
) => {
  const values = categories.flatMap((category) =>
    category.subcategories.map((subcategory) => ({ ...subcategory, category: category.label })),
  )
  if (values.length === 0) return
  await client.query(
    `INSERT INTO public.workspace_subcategory_v1(category_id,label,time_created,time_modified)
     SELECT c.id,v.label,v."timeCreated",v."timeModified"
     FROM jsonb_to_recordset($2::jsonb)
       v(category text,label text,"timeCreated" timestamptz,"timeModified" timestamptz)
     JOIN public.workspace_category_v1 c ON c.workspace_id=$1 AND c.label=v.category`,
    [workspaceId, JSON.stringify(values)],
  )
}

const insertItems = (client: PoolClient, workspaceId: number, values: BackupItem[]) =>
  client.query(IMPORT_ITEMS_SQL, [workspaceId, JSON.stringify(values)])

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
      const workspaceId =
        // A restored workspace keeps its uid when no workspace has it; otherwise this
        // is a second copy and gets its own.
        (
          await client.query<{ id: number }>(
            `INSERT INTO public.user_workspace_v1(user_id,label,time_created,time_modified,uid)
           VALUES($1,$2,$3,$4,COALESCE((SELECT $5::uuid WHERE NOT EXISTS (
             SELECT 1 FROM public.user_workspace_v1 taken WHERE taken.uid=$5::uuid)),
             gen_random_uuid()))
           RETURNING id`,
            [sourceId, w.label, w.timeCreated, w.timeModified, w.uid ?? null],
          )
        ).rows[0]!.id
      await insertVocabulary(client, workspaceId, "workspace_category_v1", w.categories)
      await insertSubcategories(client, workspaceId, w.categories)
      await insertVocabulary(client, workspaceId, "workspace_status_v1", w.statuses)
      await insertVocabulary(client, workspaceId, "workspace_tag_v1", w.tags)
      await insertItems(client, workspaceId, w.items)
    }
    const result = await mergeAnonymousUserIntoWithClient(client, sourceId, userId, {
      deduplicateItems: true,
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
