import type { PoolClient } from "pg"
import { ensureDefaultWorkspaceForUser } from "./workspace"

/**
 * Prune an affected workspace after moving, deleting, or unfiling its items: the
 * categories, subcategories, and tags no item uses any more are removed, and so is a
 * workspace left with no items. Statuses are kept, because they are the columns of a
 * workflow whether or not a task is in each one.
 * Run in a repeatable-read transaction. PostgreSQL rejects a cascading delete
 * if a concurrent foreign-key writer added a referencing row outside its snapshot.
 */
export const pruneEmptyWorkspaceTaxonomy = async (
  client: PoolClient,
  userId: number,
  workspaceId: number,
) => {
  const args = [workspaceId]
  await client.query(
    `DELETE FROM public.workspace_subcategory_v1 s USING public.workspace_category_v1 c
     WHERE s.category_id=c.id AND c.workspace_id=$1
       AND NOT EXISTS (SELECT 1 FROM public.workspace_item_v1 n WHERE n.subcategory_id=s.id)`,
    args,
  )
  await client.query(
    `DELETE FROM public.workspace_category_v1 c WHERE c.workspace_id=$1
       AND NOT EXISTS (SELECT 1 FROM public.workspace_item_v1 n WHERE n.category_id=c.id)`,
    args,
  )
  await client.query(
    `DELETE FROM public.workspace_tag_v1 t WHERE t.workspace_id=$1
       AND NOT EXISTS (SELECT 1 FROM public.item_tag_link_v1 l WHERE l.tag_id=t.id)`,
    args,
  )
  const workspace = await client.query(
    `DELETE FROM public.user_workspace_v1 w WHERE w.id=$1
       AND NOT EXISTS (SELECT 1 FROM public.workspace_item_v1 n WHERE n.workspace_id=w.id)`,
    args,
  )
  if (workspace.rowCount === 1) {
    // Capture still needs a workspace when this was the account's last one.
    await ensureDefaultWorkspaceForUser(client, userId)
    return true
  }
  // Advance the workspace row version so a waiting cleanup cannot commit using
  // a snapshot from before this one pruned a different set of items.
  await client.query(`UPDATE public.user_workspace_v1 SET time_modified=now() WHERE id=$1`, args)
  return false
}
