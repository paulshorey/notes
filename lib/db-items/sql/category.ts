import { getDb } from "../lib/db/postgres"
import { CURRENT_ITEM_EMBEDDING_MODEL } from "../services/item-embeddings"
import {
  mapCategory as map,
  categorySelect as select,
  readCategory,
  type CategoryRow as Row,
} from "./category-shared"
import { resolveSubcategoryIdForCategory } from "./item/shared"
import { executeItemGroupAction } from "./item-groups"
import { ItemGroupNotFoundError } from "./item-group-errors"
import { assertCategoryNameAllowed } from "../contracts/category-name"
export interface CategoryEmbeddingBackfillRow {
  id: number
  label: string
}
export const listCategoriesByWorkspace = async (userId: number, workspaceId: number) => {
  const { rows } = await getDb().query<Row>(
    `${select} JOIN public.user_workspace_v1 w ON w.id=c.workspace_id
    WHERE w.user_id=$1 AND c.workspace_id=$2 ORDER BY last_used_at DESC NULLS LAST,lower(c.label),c.id`,
    [userId, workspaceId],
  )
  return rows.map(map)
}
export const getCategoryByIdForWorkspace = async (
  userId: number,
  workspaceId: number,
  id: number,
) => {
  const { rows } = await getDb().query<Row>(
    `${select} JOIN public.user_workspace_v1 w ON w.id=c.workspace_id
    WHERE w.user_id=$1 AND c.workspace_id=$2 AND c.id=$3`,
    [userId, workspaceId, id],
  )
  return rows[0] ? map(rows[0]) : null
}
/** Find or create a subcategory, and return it with its refreshed parent category. */
export const createSubcategoryForWorkspace = async (
  userId: number,
  workspaceId: number,
  categoryId: number,
  label: string,
) => {
  const client = await getDb().connect()
  try {
    await client.query("BEGIN")
    const owned = await client.query(
      `SELECT 1 FROM public.user_workspace_v1 WHERE id=$1 AND user_id=$2`,
      [workspaceId, userId],
    )
    const subcategoryId =
      owned.rowCount === 1
        ? await resolveSubcategoryIdForCategory(client, workspaceId, categoryId, label)
        : null
    const category = subcategoryId ? await readCategory(client, workspaceId, categoryId) : null
    await client.query("COMMIT")
    const subcategory = category?.subcategories.find((entry) => entry.id === subcategoryId)
    return category && subcategory ? { category, subcategory } : null
  } catch (error) {
    await client.query("ROLLBACK")
    throw error
  } finally {
    client.release()
  }
}
export const listCategoriesMissingEmbeddingsByUser = async (userId: number, limit: number) => {
  const { rows } = await getDb().query<CategoryEmbeddingBackfillRow>(
    `SELECT c.id,c.label FROM public.workspace_category_v1 c
    JOIN public.user_workspace_v1 w ON w.id=c.workspace_id WHERE w.user_id=$1 AND c.category_embedding IS NULL ORDER BY c.id LIMIT $2`,
    [userId, limit],
  )
  return rows
}
export const listCategoriesStaleEmbeddingsByUser = async (userId: number, limit: number) => {
  const { rows } = await getDb().query<CategoryEmbeddingBackfillRow>(
    `SELECT c.id,c.label FROM public.workspace_category_v1 c
    JOIN public.user_workspace_v1 w ON w.id=c.workspace_id WHERE w.user_id=$1 AND (c.embedding_model IS DISTINCT FROM $2 OR c.category_embedding IS NULL)
    ORDER BY c.id LIMIT $3`,
    [userId, CURRENT_ITEM_EMBEDDING_MODEL, limit],
  )
  return rows
}
export const updateCategoryEmbeddingById = async (
  userId: number,
  id: number,
  embedding: string | null,
  model: string | null,
) => {
  const result = await getDb().query(
    `UPDATE public.workspace_category_v1 c SET category_embedding=$3::vector,embedding_model=$4,embedding_updated_at=now()
    FROM public.user_workspace_v1 w WHERE c.id=$1 AND w.id=c.workspace_id AND w.user_id=$2`,
    [id, userId, embedding, model],
  )
  return result.rowCount === 1
}
export const updateCategoryLabelForWorkspace = async (
  userId: number,
  workspaceId: number,
  id: number,
  label: string,
  embedding: string | null,
  model: string | null,
) => {
  assertCategoryNameAllowed(label)
  try {
    const result = await executeItemGroupAction(
      userId,
      { workspaceId, target: { kind: "category", categoryId: id } },
      { kind: "rename", label },
      undefined,
      { vectorLiteral: embedding, embeddingModel: model },
    )
    return result.category
  } catch (error) {
    if (error instanceof ItemGroupNotFoundError) return null
    throw error
  }
}
export const deleteCategoryForWorkspace = async (
  userId: number,
  workspaceId: number,
  id: number,
) => {
  try {
    await executeItemGroupAction(
      userId,
      { workspaceId, target: { kind: "category", categoryId: id } },
      { kind: "delete", deleteItems: false },
    )
    return true
  } catch (error) {
    if (error instanceof ItemGroupNotFoundError) return false
    throw error
  }
}
