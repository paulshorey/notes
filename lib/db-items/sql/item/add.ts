import { getDb } from "../../lib/db/postgres"
import {
  ensureStatusIdForWorkspace,
  replaceItemTagsForItem,
  resolveItemFiling,
  rethrowFilingRace,
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
    const filing = await resolveItemFiling(
      client,
      item.workspaceId,
      item.categoryId,
      item.subcategoryId,
    )
    const { rows } = await client.query<{ id: number }>(
      `INSERT INTO public.workspace_item_v1
       (workspace_id,category_id,subcategory_id,status_id,description,time_due,time_remind,
        description_embedding,embedding_model,embedding_updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::vector,$9,$10) RETURNING id`,
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
      ],
    )
    const itemId = rows[0]!.id
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
