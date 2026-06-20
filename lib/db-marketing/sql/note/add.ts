import { getDb } from "../../lib/db/postgres";
import {
  ensureCategoryIdForUser,
  replaceNoteTagsForNote,
  resolveNoteWorkflowFields,
  selectNoteById,
  toNullableText,
} from "./shared";
import type { NoteEmbeddingWriteInput, NoteInput } from "./types";

export const createNoteForUser = async (
  userId: number,
  note: NoteInput,
  embeddings: NoteEmbeddingWriteInput
) => {
  const embeddingUpdatedAt = embeddings.embeddingModel
    ? new Date().toISOString()
    : null;
  const client = await getDb().connect();

  try {
    await client.query("BEGIN");
    await ensureCategoryIdForUser(client, userId, note.categoryId);

    const workflowFields = await resolveNoteWorkflowFields(
      client,
      userId,
      note.workflowStatusId,
      null
    );

    const { rows } = await client.query<{ id: number }>(
      `
        INSERT INTO public.user_note_v1 (
          user_id,
          category_id,
          workflow_status_id,
          description,
          time_due,
          time_remind,
          time_completed,
          description_embedding,
          embedding_model,
          embedding_updated_at
        )
        VALUES (
          $1,
          $2,
          $3,
          $4,
          $5,
          $6,
          $7,
          $8::vector,
          $9,
          $10
        )
        RETURNING id
      `,
      [
        userId,
        note.categoryId,
        workflowFields.workflowStatusId,
        toNullableText(note.description),
        note.timeDue,
        note.timeRemind,
        workflowFields.timeCompleted?.toISOString() ?? null,
        embeddings.descriptionEmbedding,
        embeddings.embeddingModel,
        embeddingUpdatedAt,
      ]
    );

    if (!rows[0]) {
      throw new Error("Failed to create note.");
    }

    const noteId = rows[0].id;

    await replaceNoteTagsForNote(client, noteId, userId, note.tagIds);

    const createdNote = await selectNoteById(client, noteId, userId);

    if (!createdNote) {
      throw new Error("Failed to load created note.");
    }

    await client.query("COMMIT");
    return createdNote;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};
