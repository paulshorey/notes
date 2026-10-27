import type {
  ExecuteItemGroupActionRequest,
  ItemGroupSelection,
  PreviewItemGroupRequest,
} from "../contracts/item-group-actions"
import { assertCategoryNameAllowed } from "../contracts/category-name"
import { executeItemGroupAction, previewItemGroup } from "../sql/item-groups"
import { ItemGroupConflictError } from "../sql/item-group-errors"
import { listCategoriesByWorkspace } from "../sql/category"
import { createTagLabelEmbedding } from "./item-embeddings"

const object = (value: unknown) => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Expected a JSON object.")
  return value as Record<string, unknown>
}
const id = (value: unknown) => {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1)
    throw new Error("Expected a positive integer ID.")
  return value
}
const selection = (value: unknown): ItemGroupSelection => {
  const input = object(value)
  const target = object(input.target)
  const workspaceId = id(input.workspaceId)
  if (target.kind === "uncategorized") return { workspaceId, target: { kind: "uncategorized" } }
  if (target.kind === "category")
    return { workspaceId, target: { kind: "category", categoryId: id(target.categoryId) } }
  throw new Error("Unknown item group.")
}
export const parsePreviewItemGroupRequest = (value: unknown): PreviewItemGroupRequest => {
  const input = object(value)
  return { userId: id(input.userId), selection: selection(input.selection) }
}
export const parseExecuteItemGroupActionRequest = (
  value: unknown,
): ExecuteItemGroupActionRequest => {
  const input = object(value)
  const request = parsePreviewItemGroupRequest(value)
  const action = object(input.action)
  if (typeof input.snapshot !== "string" || !/^[a-f0-9]{64}$/.test(input.snapshot))
    throw new Error("A current group preview is required.")
  if (action.kind === "rename") {
    const label = typeof action.label === "string" ? action.label.trim().toLocaleLowerCase() : ""
    if (!label) throw new Error("label is required.")
    assertCategoryNameAllowed(label)
    return { ...request, snapshot: input.snapshot, action: { kind: "rename", label } }
  }
  if (action.kind === "delete" && typeof action.deleteItems === "boolean") {
    if (request.selection.target.kind === "uncategorized" && !action.deleteItems)
      throw new Error("Uncategorized items can only be deleted or assigned to a category.")
    return {
      ...request,
      snapshot: input.snapshot,
      action: { kind: "delete", deleteItems: action.deleteItems },
    }
  }
  throw new Error("Unknown item group action.")
}
export const previewItemGroupForItemsApp = (request: PreviewItemGroupRequest) =>
  previewItemGroup(request.userId, request.selection)

export const executeItemGroupActionForItemsApp = async (input: ExecuteItemGroupActionRequest) => {
  // Also validate direct service callers before any database/provider work.
  const request = parseExecuteItemGroupActionRequest(input)
  const current = await previewItemGroup(request.userId, request.selection)
  if (current.snapshot !== request.snapshot) throw new ItemGroupConflictError()
  if (
    request.selection.target.kind === "uncategorized" &&
    current.itemCount === 0 &&
    request.action.kind === "rename"
  )
    throw new ItemGroupConflictError("This group is empty. There are no items to categorize.")
  let embedding
  if (request.action.kind === "rename") {
    const label = request.action.label
    const categories = await listCategoriesByWorkspace(
      request.userId,
      request.selection.workspaceId,
    )
    const existing = categories.find((category) => category.label === label)
    // Reusing a category must not depend on the embedding provider. For a new
    // label, do the external work before acquiring the transactional DB client.
    if (request.selection.target.kind === "category" || !existing)
      embedding = await createTagLabelEmbedding(label)
  }
  return executeItemGroupAction(
    request.userId,
    request.selection,
    request.action,
    request.snapshot,
    embedding,
  )
}
