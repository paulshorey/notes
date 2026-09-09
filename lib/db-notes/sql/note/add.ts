import { getDb } from "../../lib/db/postgres"
import {
  ensureStatusIdForWorkspace,
  replaceNoteCategoriesForNote,
  replaceNoteTagsForNote,
  selectNoteById,
  toNullableText,
} from "./shared"
import type { NoteEmbeddingWriteInput, NoteInput } from "./types"

export const createNoteForUser = async (
  userId: number,
  note: NoteInput,
  embeddings: NoteEmbeddingWriteInput,
) => {
  const client = await getDb().connect()
  try {
    await client.query("BEGIN")
    const owned = await client.query(
      `SELECT 1 FROM public.user_workspace_v1 WHERE id=$1 AND user_id=$2`,
      [note.workspaceId, userId],
    )
    if (owned.rowCount !== 1) throw new Error("Workspace was not found for this user.")
    await ensureStatusIdForWorkspace(client, note.workspaceId, note.statusId)
    const { rows } = await client.query<{ id: number }>(
      `INSERT INTO public.user_note_v1
       (workspace_id,status_id,description,time_due,time_remind,description_embedding,embedding_model,embedding_updated_at)
       VALUES ($1,$2,$3,$4,$5,$6::vector,$7,$8) RETURNING id`,
      [
        note.workspaceId,
        note.statusId,
        toNullableText(note.description),
        note.timeDue,
        note.timeRemind,
        embeddings.descriptionEmbedding,
        embeddings.embeddingModel,
        embeddings.embeddingModel ? new Date().toISOString() : null,
      ],
    )
    const noteId = rows[0]!.id
    await replaceNoteCategoriesForNote(client, noteId, note.workspaceId, note.categoryIds)
    await replaceNoteTagsForNote(client, noteId, note.workspaceId, note.tagIds)
    const created = await selectNoteById(client, noteId, userId)
    if (!created) throw new Error("Failed to load created note.")
    await client.query("COMMIT")
    return created
  } catch (error) {
    await client.query("ROLLBACK")
    throw error
  } finally {
    client.release()
  }
}
