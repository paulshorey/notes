import { getDb } from "../../lib/db/postgres"
export const deleteNoteForUser = async (noteId: number, userId: number) => {
  const result = await getDb().query(
    `DELETE FROM public.user_note_v1 n USING public.user_workspace_v1 w
    WHERE n.id=$1 AND w.id=n.workspace_id AND w.user_id=$2`,
    [noteId, userId],
  )
  return (result.rowCount ?? 0) > 0
}
