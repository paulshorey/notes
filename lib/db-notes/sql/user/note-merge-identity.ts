import { createHash } from "node:crypto"
import type { PoolClient } from "pg"

/** Content plus creation time identifies an exact copy without trusting exported ids.
 * Modified time is deliberately excluded: an edit that leaves the same content
 * should not duplicate a note. Counts, rather than a Set, preserve identical twins.
 */
export const noteMergeIdentities = async (client: PoolClient, workspaceId: number) => {
  const { rows } = await client.query<{
    id: number
    description: string | null
    time_created: Date
    time_due: Date | null
    time_remind: Date | null
    status: string | null
    categories: string[]
    tags: string[]
  }>(
    `SELECT n.id,n.description,n.time_created,n.time_due,n.time_remind,s.label status,
       ARRAY(SELECT c.label FROM public.user_note_category_link_v1 l
         JOIN public.workspace_note_category_v1 c ON c.id=l.category_id
         WHERE l.note_id=n.id ORDER BY c.label) categories,
       ARRAY(SELECT t.label FROM public.user_note_tag_link_v1 l
         JOIN public.workspace_note_tag_v1 t ON t.id=l.tag_id
         WHERE l.note_id=n.id ORDER BY t.label) tags
     FROM public.user_note_v1 n LEFT JOIN public.workspace_note_status_v1 s ON s.id=n.status_id
     WHERE n.workspace_id=$1`,
    [workspaceId],
  )
  return new Map(
    rows.map(({ id, ...data }) => [
      id,
      createHash("sha256").update(JSON.stringify(data)).digest("hex"),
    ]),
  )
}
