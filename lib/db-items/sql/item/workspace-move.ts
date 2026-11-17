import type { PoolClient } from "pg"
import { MOVE_ITEMS_SQL } from "./stored-capabilities"

/**
 * Changing who owns a row is not an edit. The timestamp trigger keeps a row's stored
 * modification time while this transaction-scoped setting is on.
 */
export const withStoredTimeModified = async <T>(client: PoolClient, work: () => Promise<T>) => {
  await client.query(`SELECT set_config('app.keep_time_modified','on',true)`)
  try {
    return await work()
  } finally {
    // A failed statement has already aborted the transaction; there is nothing to reset.
    await client.query(`SELECT set_config('app.keep_time_modified','off',true)`).catch(() => {})
  }
}

/**
 * Merge destination vocabulary by label, then rehome the item rows and their relations.
 * Account merges carry the entire vocabulary. A content move carries only labels used
 * by the selected items. The caller owns the transaction and locks the source items.
 */
export const moveWorkspaceItems = async (
  client: PoolClient,
  sourceId: number,
  destinationId: number,
  { itemIds = null, excludeItemIds = [] }: { itemIds?: number[] | null; excludeItemIds?: number[] },
) => {
  const values = [destinationId, sourceId, itemIds]
  const moving = `WITH moving AS (
    SELECT id,category_id,subcategory_id,status_id FROM public.workspace_item_v1
    WHERE workspace_id=$2 AND id=ANY($3::int[])
  )`
  await client.query(
    `${moving} INSERT INTO public.workspace_category_v1(workspace_id,label,category_embedding,embedding_model,embedding_updated_at,time_created,time_modified)
    SELECT $1,s.label,s.category_embedding,s.embedding_model,s.embedding_updated_at,s.time_created,s.time_modified
    FROM public.workspace_category_v1 s WHERE s.workspace_id=$2 AND
      ($3::int[] IS NULL OR EXISTS (SELECT 1 FROM moving n WHERE n.category_id=s.id))
    ON CONFLICT(workspace_id,label) DO NOTHING`,
    values,
  )
  // A subcategory is matched by its label within the category of the same label.
  await client.query(
    `${moving} INSERT INTO public.workspace_subcategory_v1(category_id,label,time_created,time_modified)
    SELECT dc.id,ss.label,ss.time_created,ss.time_modified FROM public.workspace_subcategory_v1 ss
    JOIN public.workspace_category_v1 sc ON sc.id=ss.category_id AND sc.workspace_id=$2
    JOIN public.workspace_category_v1 dc ON dc.workspace_id=$1 AND dc.label=sc.label
    WHERE $3::int[] IS NULL OR EXISTS (SELECT 1 FROM moving n WHERE n.subcategory_id=ss.id)
    ON CONFLICT(category_id,label) DO NOTHING`,
    values,
  )
  await client.query(
    `${moving} INSERT INTO public.workspace_status_v1(workspace_id,label,position,time_created,time_modified)
    SELECT $1,s.label,s.position,s.time_created,s.time_modified
    FROM public.workspace_status_v1 s WHERE s.workspace_id=$2 AND
      ($3::int[] IS NULL OR EXISTS (SELECT 1 FROM moving n WHERE n.status_id=s.id))
    ON CONFLICT(workspace_id,label) DO NOTHING`,
    values,
  )
  await client.query(
    `${moving} INSERT INTO public.workspace_tag_v1(workspace_id,label,tag_embedding,embedding_model,embedding_updated_at,time_created,time_modified)
    SELECT $1,t.label,t.tag_embedding,t.embedding_model,t.embedding_updated_at,t.time_created,t.time_modified
    FROM public.workspace_tag_v1 t WHERE t.workspace_id=$2 AND ($3::int[] IS NULL OR EXISTS (
      SELECT 1 FROM moving n JOIN public.item_tag_link_v1 l ON l.item_id=n.id WHERE l.tag_id=t.id
    ))
    ON CONFLICT(workspace_id,label) DO NOTHING`,
    values,
  )

  const moved = await withStoredTimeModified(client, () =>
    client.query<{ id: number }>(MOVE_ITEMS_SQL, [...values, excludeItemIds]),
  )
  return moved.rows.map(({ id }) => id)
}
