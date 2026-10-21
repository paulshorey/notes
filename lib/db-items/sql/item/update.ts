import { getDb } from "../../lib/db/postgres"
import {
  ensureStatusIdForWorkspace,
  replaceItemCategoriesForItem,
  replaceItemTagsForItem,
  selectItemById,
  toNullableText,
} from "./shared"
import type { ItemEmbeddingWriteInput, ItemInput } from "./types"

export const updateItemForUser = async (
  itemId: number,
  userId: number,
  item: ItemInput,
  embeddings: ItemEmbeddingWriteInput | null,
  expectedDescription?: string | null,
) => {
  const client = await getDb().connect()
  try {
    await client.query("BEGIN")
    await ensureStatusIdForWorkspace(client, item.workspaceId, item.statusId)
    const values: unknown[] = [
      itemId,
      userId,
      item.workspaceId,
      item.statusId,
      toNullableText(item.description),
      item.timeDue,
      item.timeRemind,
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
      `UPDATE public.workspace_item_v1 n SET workspace_id=$3,status_id=$4,description=$5,time_due=$6,time_remind=$7${embeddingSql}
       FROM public.user_workspace_v1 w WHERE n.id=$1 AND w.id=n.workspace_id AND w.user_id=$2 AND w.id=$3 ${guard}`,
      values,
    )
    if (result.rowCount !== 1) {
      await client.query("ROLLBACK")
      return null
    }
    await replaceItemCategoriesForItem(client, itemId, item.workspaceId, item.categoryIds)
    await replaceItemTagsForItem(client, itemId, item.workspaceId, item.tagIds)
    const updated = await selectItemById(client, itemId, userId)
    if (!updated) throw new Error("Failed to load updated item.")
    await client.query("COMMIT")
    return updated
  } catch (error) {
    await client.query("ROLLBACK")
    throw error
  } finally {
    client.release()
  }
}

export const updateItemEmbeddingsForUser = async (
  itemId: number,
  userId: number,
  embeddings: ItemEmbeddingWriteInput,
) => {
  await getDb().query(
    `UPDATE public.workspace_item_v1 n SET description_embedding=$3::vector,embedding_model=$4,embedding_updated_at=$5
    FROM public.user_workspace_v1 w WHERE n.id=$1 AND w.id=n.workspace_id AND w.user_id=$2`,
    [
      itemId,
      userId,
      embeddings.descriptionEmbedding,
      embeddings.embeddingModel,
      embeddings.embeddingModel ? new Date().toISOString() : null,
    ],
  )
}
