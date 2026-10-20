import { getDb } from "../../lib/db/postgres"
import {
  ensureStatusIdForWorkspace,
  replaceItemCategoriesForItem,
  replaceItemTagsForItem,
  selectItemById,
  toNullableText,
} from "./shared"
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
    const { rows } = await client.query<{ id: number }>(
      `INSERT INTO public.workspace_item_v1
       (workspace_id,status_id,description,time_due,time_remind,description_embedding,embedding_model,embedding_updated_at)
       VALUES ($1,$2,$3,$4,$5,$6::vector,$7,$8) RETURNING id`,
      [
        item.workspaceId,
        item.statusId,
        toNullableText(item.description),
        item.timeDue,
        item.timeRemind,
        embeddings.descriptionEmbedding,
        embeddings.embeddingModel,
        embeddings.embeddingModel ? new Date().toISOString() : null,
      ],
    )
    const itemId = rows[0]!.id
    await replaceItemCategoriesForItem(client, itemId, item.workspaceId, item.categoryIds)
    await replaceItemTagsForItem(client, itemId, item.workspaceId, item.tagIds)
    const created = await selectItemById(client, itemId, userId)
    if (!created) throw new Error("Failed to load created item.")
    await client.query("COMMIT")
    return created
  } catch (error) {
    await client.query("ROLLBACK")
    throw error
  } finally {
    client.release()
  }
}
