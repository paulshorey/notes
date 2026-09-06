import { getDb } from "../../lib/db/postgres";
import {
  replaceNoteTagsForNote,
  selectNoteById,
  toNullableText,
} from "./shared";
import type { NoteEmbeddingWriteInput, NoteInput } from "./types";

/**
 * `embeddings: null` means "leave the embedding columns exactly as they are",
 * used when the description did not change and the stored vector is already
 * current. See `updateNoteForNotesApp`, which decides that.
 *
 * That decision is made from a read taken before this transaction, so it can
 * go stale: another client may change the description in between, and writing
 * the old text back while keeping the newer embedding would leave the note and
 * its vector describing different things. `expectedDescription` guards against
 * that — when supplied, the row only updates if its description still matches,
 * and a caller seeing `null` back should re-read and retry with real
 * embeddings rather than assume the note is gone.
 */
export const updateNoteForUser = async (
  noteId: number,
  userId: number,
  note: NoteInput,
  embeddings: NoteEmbeddingWriteInput | null,
  expectedDescription?: string | null
) => {
  const embeddingUpdatedAt =
    embeddings && embeddings.embeddingModel ? new Date().toISOString() : null;
  const client = await getDb().connect();

  try {
    await client.query("BEGIN");

    const embeddingValues =
      embeddings === null
        ? []
        : [
            embeddings.descriptionEmbedding,
            embeddings.embeddingModel,
            embeddingUpdatedAt,
          ];

    const embeddingAssignments =
      embeddings === null
        ? ""
        : `
          description_embedding = $7::vector,
          embedding_model = $8,
          embedding_updated_at = $9,`;

    // Only guard when reusing the stored embedding; a real re-embed is
    // self-consistent whatever the previous description was.
    const guardDescription = embeddings === null && expectedDescription !== undefined;
    const guardClause = guardDescription
      ? `AND description IS NOT DISTINCT FROM $${7 + embeddingValues.length}::text`
      : "";

    const { rowCount } = await client.query(
      `
        UPDATE public.user_note_v1
        SET
          group_id = $3,
          description = $4,
          time_due = $5,
          time_remind = $6,${embeddingAssignments}
          time_modified = CURRENT_TIMESTAMP
        WHERE id = $1
          AND user_id = $2
          ${guardClause}
      `,
      [
        noteId,
        userId,
        note.groupId,
        toNullableText(note.description),
        note.timeDue,
        note.timeRemind,
        ...embeddingValues,
        ...(guardDescription ? [toNullableText(expectedDescription ?? "")] : []),
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
