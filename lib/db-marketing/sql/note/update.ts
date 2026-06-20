import { getDb } from "../../lib/db/postgres";
import {
  ensureCategoryIdForUser,
  replaceNoteTagsForNote,
  resolveNoteWorkflowFields,
  selectNoteById,
  toNullableText,
} from "./shared";
import type { NoteEmbeddingWriteInput, NoteInput } from "./types";

export const updateNoteForUser = async (
  noteId: number,
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

    const currentResult = await client.query<{ time_completed: Date | null }>(
      `
        SELECT time_completed
        FROM public.user_note_v1
        WHERE id = $1
          AND user_id = $2
      `,
      [noteId, userId]
    );

    if (!currentResult.rows[0]) {
      await client.query("ROLLBACK");
      return null;
    }

    const workflowFields = await resolveNoteWorkflowFields(
      client,
      userId,
      note.workflowStatusId,
      currentResult.rows[0].time_completed
    );

    const { rowCount } = await client.query(
      `
        UPDATE public.user_note_v1
        SET
          category_id = $3,
          workflow_status_id = $4,
          description = $5,
          time_due = $6,
          time_remind = $7,
          time_completed = $8,
          description_embedding = $9::vector,
          embedding_model = $10,
          embedding_updated_at = $11,
          time_modified = CURRENT_TIMESTAMP
        WHERE id = $1
          AND user_id = $2
      `,
      [
        noteId,
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

    if (rowCount !== 1) {
      await client.query("ROLLBACK");
      return null;
    }

    await replaceNoteTagsForNote(client, noteId, userId, note.tagIds);

    const updatedNote = await selectNoteById(client, noteId, userId);

    if (!updatedNote) {
      throw new Error("Failed to load updated note.");
    }

    await client.query("COMMIT");
    return updatedNote;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

export const updateNoteEmbeddingsForUser = async (
  noteId: number,
  userId: number,
  embeddings: NoteEmbeddingWriteInput
) => {
  const embeddingUpdatedAt = embeddings.embeddingModel
    ? new Date().toISOString()
    : null;

  await getDb().query(
    `
      UPDATE public.user_note_v1
      SET
        description_embedding = $3::vector,
        embedding_model = $4,
        embedding_updated_at = $5
      WHERE id = $1
        AND user_id = $2
    `,
    [
      noteId,
      userId,
      embeddings.descriptionEmbedding,
      embeddings.embeddingModel,
      embeddingUpdatedAt,
    ]
  );
};
