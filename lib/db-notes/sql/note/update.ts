import { getDb } from "../../lib/db/postgres"
import {
  ensureStatusIdForWorkspace,
  replaceNoteCategoriesForNote,
  replaceNoteTagsForNote,
  selectNoteById,
  toNullableText,
} from "./shared"
import type { NoteEmbeddingWriteInput, NoteInput } from "./types"

export const updateNoteForUser = async (
  noteId: number,
  userId: number,
  note: NoteInput,
  embeddings: NoteEmbeddingWriteInput | null,
  expectedDescription?: string | null,
) => {
  const client = await getDb().connect()
  try {
    await client.query("BEGIN")
    await ensureStatusIdForWorkspace(client, note.workspaceId, note.statusId)
    const values: unknown[] = [
      noteId,
      userId,
      note.workspaceId,
      note.statusId,
      toNullableText(note.description),
      note.timeDue,
      note.timeRemind,
    ]
    let embeddingSql = ""
    if (embeddings !== null) {
      embeddingSql =
        ", description_embedding=$8::vector, embedding_model=$9, embedding_updated_at=$10"
      values.push(
        embeddings.descriptionEmbedding,
        embeddings.embeddingModel,
        embeddings.embeddingModel ? new Date().toISOString() : null,
      )
    }
    let guard = ""
    if (embeddings === null && expectedDescription !== undefined) {
      guard = `AND n.description IS NOT DISTINCT FROM $8::text`
      values.push(toNullableText(expectedDescription ?? ""))
    }
    const result = await client.query(
      `UPDATE public.user_note_v1 n SET workspace_id=$3,status_id=$4,description=$5,time_due=$6,time_remind=$7${embeddingSql}
       FROM public.user_workspace_v1 w WHERE n.id=$1 AND w.id=n.workspace_id AND w.user_id=$2 AND w.id=$3 ${guard}`,
      values,
    )
    if (result.rowCount !== 1) {
      await client.query("ROLLBACK")
      return null
    }
    await replaceNoteCategoriesForNote(client, noteId, note.workspaceId, note.categoryIds)
    await replaceNoteTagsForNote(client, noteId, note.workspaceId, note.tagIds)
    const updated = await selectNoteById(client, noteId, userId)
    if (!updated) throw new Error("Failed to load updated note.")
    await client.query("COMMIT")
    return updated
  } catch (error) {
    await client.query("ROLLBACK")
    throw error
  } finally {
    client.release()
  }
}

export const updateNoteEmbeddingsForUser = async (
  noteId: number,
  userId: number,
  embeddings: NoteEmbeddingWriteInput,
) => {
  await getDb().query(
    `UPDATE public.user_note_v1 n SET description_embedding=$3::vector,embedding_model=$4,embedding_updated_at=$5
    FROM public.user_workspace_v1 w WHERE n.id=$1 AND w.id=n.workspace_id AND w.user_id=$2`,
    [
      noteId,
      userId,
      embeddings.descriptionEmbedding,
      embeddings.embeddingModel,
      embeddings.embeddingModel ? new Date().toISOString() : null,
    ],
  )
}
