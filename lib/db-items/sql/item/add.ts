import { getDb } from "../../lib/db/postgres"
import {
  ensureStatusIdForWorkspace,
  replaceItemTagsForItem,
  resolveItemFiling,
  rethrowFilingRace,
  selectItemById,
  toNullableText,
} from "./shared"
import { PUBLIC_UID_TAKEN_ERROR } from "../../contracts/public-uid"
import type { ItemEmbeddingWriteInput, ItemInput } from "./types"

export const createItemForUser = async (
  userId: number,
  item: ItemInput,
  embeddings: ItemEmbeddingWriteInput,
) => {
  const client = await getDb().connect()
  try {
    await client.query("BEGIN")
    const owned = await client.query(
      `SELECT 1 FROM public.user_workspace_v1 WHERE id=$1 AND user_id=$2`,
      [item.workspaceId, userId],
    )
    if (owned.rowCount !== 1) throw new Error("Workspace was not found for this user.")
    await ensureStatusIdForWorkspace(client, item.workspaceId, item.statusId)
    const filing = await resolveItemFiling(
      client,
      item.workspaceId,
      item.categoryId,
      item.subcategoryId,
    )
    // A uid the client chose makes the create repeatable: if a row already has it,
    // nothing is written and that row is the answer.
    const { rows } = await client.query<{ id: number }>(
      `INSERT INTO public.workspace_item_v1
       (workspace_id,category_id,subcategory_id,status_id,description,time_due,time_remind,
        description_embedding,embedding_model,embedding_updated_at,uid)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::vector,$9,$10,COALESCE($11::uuid,gen_random_uuid()))
       ON CONFLICT (uid) DO NOTHING RETURNING id`,
      [
        item.workspaceId,
        filing.categoryId,
        filing.subcategoryId,
        item.statusId,
        toNullableText(item.description),
        item.timeDue,
        item.timeRemind,
        embeddings.descriptionEmbedding,
        embeddings.embeddingModel,
        embeddings.embeddingModel ? new Date().toISOString() : null,
        item.uid ?? null,
      ],
    )
    const inserted = rows[0]?.id
    if (inserted === undefined) {
      // The same create arrived before. Answer with what it stored, as stored: the
      // caller sends its later edits as updates. A uid held by an item of another
      // workspace or user is not this caller's to learn anything about.
      const existing = await client.query<{ id: number }>(
        `SELECT n.id FROM public.workspace_item_v1 n
         WHERE n.uid=$1::uuid AND n.workspace_id=$2`,
        [item.uid, item.workspaceId],
      )
      const existingId = existing.rows[0]?.id
      if (existingId === undefined) throw new Error(PUBLIC_UID_TAKEN_ERROR)
      const stored = await selectItemById(client, existingId, userId)
      if (!stored) throw new Error(PUBLIC_UID_TAKEN_ERROR)
      await client.query("COMMIT")
      return stored
    }
    const itemId = inserted
    await replaceItemTagsForItem(client, itemId, item.workspaceId, item.tagIds)
    const created = await selectItemById(client, itemId, userId)
    if (!created) throw new Error("Failed to load created item.")
    await client.query("COMMIT")
    return created
  } catch (error) {
    await client.query("ROLLBACK")
    return rethrowFilingRace(error)
  } finally {
    client.release()
  }
}
