import type {
  CategoriesRequest,
  CategoriesResponse,
  CreateCategoryRequest,
  CreateCategoryResponse,
  CreateItemRequest,
  CreateStatusRequest,
  CreateTagRequest,
  CreateTagResponse,
  CreateWorkspaceRequest,
  DeleteCategoryRequest,
  DeleteCategoryResponse,
  DeleteItemRequest,
  DeleteResponse,
  DeleteStatusRequest,
  DeleteTagRequest,
  DeleteTagResponse,
  DeleteWorkspaceRequest,
  EmbeddingMaintenanceRequest,
  EmbeddingMaintenanceResponse,
  ItemsRequest,
  ItemsResponse,
  ItemResponse,
  SearchRequest,
  SearchResponse,
  SessionRequest,
  SessionResponse,
  StatusResponse,
  StatusesRequest,
  StatusesResponse,
  TagsRequest,
  TagsResponse,
  TokenLoginRequest,
  TokenLoginResponse,
  UpdateCategoryRequest,
  UpdateCategoryResponse,
  UpdateStatusRequest,
  UpdateTagRequest,
  UpdateTagResponse,
  UpdateUserPreferencesRequest,
  UpdateWorkspaceRequest,
  UserPreferences,
  WorkspaceResponse,
  WorkspacesRequest,
  WorkspacesResponse,
} from "../contracts/items-app"
import { getDb } from "../lib/db/postgres"
import { ItemGroupConflictError, ItemGroupNotFoundError } from "../sql/item-group-errors"
import {
  executeItemGroupActionForItemsApp,
  previewItemGroupForItemsApp,
} from "./item-group-actions"
export {
  parseExecuteItemGroupActionRequest,
  parsePreviewItemGroupRequest,
} from "./item-group-actions"
import { assertCategoryNameAllowed } from "../contracts/category-name"
import { exportUserBackup, restoreUserBackup } from "../sql/user/backup"
export { BackupAccountError } from "../sql/user/backup"
import { ITEMS_APP_SEARCH_MAX_RESULTS } from "../item-search-constants"
import {
  createItemForUser,
  deleteItemForUser,
  listItemsByUser,
  listItemsMissingEmbeddingsByUser,
  listItemsStaleEmbeddingsByUser,
  parseItemInput,
  searchItemsByEmbedding,
  selectItemEmbeddingStateById,
  updateItemEmbeddingsForUser,
  updateItemForUser,
} from "../sql/item"
import { resolveCategoryIdForWorkspace, resolveTagIdForWorkspace } from "../sql/item/shared"
import {
  deleteCategoryForWorkspace,
  getCategoryByIdForWorkspace,
  listCategoriesByWorkspace,
  listCategoriesMissingEmbeddingsByUser,
  listCategoriesStaleEmbeddingsByUser,
  updateCategoryEmbeddingById,
  updateCategoryLabelForWorkspace,
} from "../sql/category"
import {
  deleteTagForWorkspace,
  getTagByIdForWorkspace,
  listTagsByWorkspace,
  listTagsMissingEmbeddingsByUser,
  listTagsStaleEmbeddingsByUser,
  updateTagEmbeddingById,
  updateTagLabelForWorkspace,
} from "../sql/tag"
import {
  createStatusForWorkspace,
  deleteStatusForWorkspace,
  getStatusByIdForWorkspace,
  listStatusesByWorkspace,
  updateStatusForWorkspace,
} from "../sql/status"
import {
  createWorkspaceForUser,
  deleteWorkspaceForUser,
  ensureDefaultWorkspaceForUser,
  getWorkspaceByIdForUser,
  listWorkspacesByUser,
  updateWorkspaceForUser,
} from "../sql/workspace"
import {
  CLAIM_IDENTIFIER_TAKEN_ERROR,
  claimAnonymousUser,
  createAnonymousUser,
  createApiTokenForUser,
  deleteApiToken,
  findUserIdByApiToken,
  getUserById,
  mergeAnonymousUserInto,
  updateUserPreferencesById,
  verifyUserCredentials,
} from "../sql/user"
import {
  createBackfillEmbeddingInputs,
  createBackfillTagEmbeddings,
  createItemEmbeddingInput,
  createQueryEmbedding,
  createTagLabelEmbedding,
  CURRENT_ITEM_EMBEDDING_MODEL,
  EmbeddingConfigurationError,
  EmbeddingRequestError,
} from "./item-embeddings"

export const ITEMS_APP_ITEM_NOT_FOUND_ERROR = "Item not found."
export const ITEMS_APP_CATEGORY_NOT_FOUND_ERROR = "Category not found."
export const ITEMS_APP_TAG_NOT_FOUND_ERROR = "Tag not found."
export const ITEMS_APP_STATUS_NOT_FOUND_ERROR = "Status not found."
export const ITEMS_APP_WORKSPACE_NOT_FOUND_ERROR = "Workspace not found."
export const ITEMS_APP_USER_NOT_FOUND_ERROR = "User not found."
export const ITEMS_APP_INVALID_CREDENTIALS_ERROR = "Invalid username, email, phone, or password."
export const ITEMS_APP_AUTH_REQUIRED_ERROR = "Authentication required."
export const ITEMS_APP_EMBEDDING_MAINTENANCE_MISSING_MODE = "missing"
export const ITEMS_APP_EMBEDDING_MAINTENANCE_STALE_MODE = "stale"

const object = (value: unknown) => {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("Request body must be a JSON object.")
  return value as Record<string, unknown>
}
const label = (value: unknown) =>
  typeof value === "string" ? value.trim().toLocaleLowerCase() : ""
export const parsePositiveInteger = (
  value: unknown,
  field: string,
  { min = 1, max }: { min?: number; max?: number } = {},
) => {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number.parseInt(value, 10)
        : NaN
  if (!Number.isInteger(parsed) || parsed < min || (max !== undefined && parsed > max))
    throw new Error(
      `${field} must be an integer of at least ${min}${max !== undefined ? ` and at most ${max}` : ""}.`,
    )
  return parsed
}
const isDatabaseAvailabilityError = (error: unknown) => {
  if (!(error instanceof Error)) return false
  const code =
    "code" in error && typeof error.code === "string" ? error.code.toUpperCase() : undefined
  return (
    code?.startsWith("08") === true ||
    code === "53300" ||
    code === "57P01" ||
    code === "57P02" ||
    code === "57P03" ||
    code === "ECONNREFUSED" ||
    code === "ECONNRESET" ||
    code === "ETIMEDOUT" ||
    code === "EHOSTUNREACH" ||
    code === "ENETUNREACH" ||
    /connection (?:terminated|timeout|timed out|refused|reset)|connect econn(?:refused|reset)|connect etimedout|timeout exceeded when trying to connect/i.test(
      error.message,
    )
  )
}
const workspaceRequest = (userId: unknown, workspaceId: unknown) => ({
  userId: parsePositiveInteger(userId, "userId"),
  workspaceId: parsePositiveInteger(workspaceId, "workspaceId"),
})
const labelRequest = (value: unknown) => {
  const b = object(value)
  return { ...workspaceRequest(b.userId, b.workspaceId), label: label(b.label) }
}
export const getItemsAppErrorStatus = (error: unknown) =>
  error instanceof ItemGroupConflictError
    ? 409
    : error instanceof ItemGroupNotFoundError
      ? 404
      : isDatabaseAvailabilityError(error)
        ? 503
        : error instanceof EmbeddingConfigurationError
          ? 500
          : error instanceof EmbeddingRequestError
            ? error.status >= 400 && error.status < 500
              ? 502
              : error.status
            : error instanceof Error && error.message === CLAIM_IDENTIFIER_TAKEN_ERROR
              ? 409
              : 400
export const parseSessionRequest = (userId: unknown): SessionRequest => ({
  userId: parsePositiveInteger(userId, "userId"),
})
export const parseItemsRequest = (userId: unknown, workspaceId?: unknown): ItemsRequest =>
  workspaceRequest(userId, workspaceId)
export const parseCategoriesRequest = (userId: unknown, workspaceId?: unknown): CategoriesRequest =>
  workspaceRequest(userId, workspaceId)
export const parseTagsRequest = (userId: unknown, workspaceId?: unknown): TagsRequest =>
  workspaceRequest(userId, workspaceId)
export const parseStatusesRequest = (userId: unknown, workspaceId?: unknown): StatusesRequest =>
  workspaceRequest(userId, workspaceId)
export const parseWorkspacesRequest = (userId: unknown): WorkspacesRequest => ({
  userId: parsePositiveInteger(userId, "userId"),
})
export const parseCreateCategoryRequest = (v: unknown): CreateCategoryRequest => {
  const request = labelRequest(v)
  assertCategoryNameAllowed(request.label)
  return request
}
export const parseCreateTagRequest = (v: unknown): CreateTagRequest => labelRequest(v)
export const parseCreateStatusRequest = (v: unknown): CreateStatusRequest => labelRequest(v)
export const parseCreateWorkspaceRequest = (v: unknown): CreateWorkspaceRequest => {
  const b = object(v)
  return { userId: parsePositiveInteger(b.userId, "userId"), label: label(b.label) }
}
export const parseUpdateCategoryRequest = (v: unknown): UpdateCategoryRequest => {
  const b = object(v)
  assertCategoryNameAllowed(label(b.label))
  return {
    ...workspaceRequest(b.userId, b.workspaceId),
    categoryId: parsePositiveInteger(b.categoryId, "categoryId"),
    label: label(b.label),
  }
}
export const parseUpdateTagRequest = (v: unknown): UpdateTagRequest => {
  const b = object(v)
  return {
    ...workspaceRequest(b.userId, b.workspaceId),
    tagId: parsePositiveInteger(b.tagId, "tagId"),
    label: label(b.label),
  }
}
export const parseUpdateStatusRequest = (v: unknown): UpdateStatusRequest => {
  const b = object(v)
  return {
    ...workspaceRequest(b.userId, b.workspaceId),
    statusId: parsePositiveInteger(b.statusId, "statusId"),
    label: label(b.label),
    ...(b.position === undefined
      ? {}
      : { position: parsePositiveInteger(b.position, "position", { min: 0 }) }),
  }
}
export const parseUpdateWorkspaceRequest = (v: unknown): UpdateWorkspaceRequest => {
  const b = object(v)
  return {
    userId: parsePositiveInteger(b.userId, "userId"),
    workspaceId: parsePositiveInteger(b.workspaceId, "workspaceId"),
    label: label(b.label),
  }
}
export const parseDeleteCategoryRequest = (v: unknown): DeleteCategoryRequest => {
  const b = object(v)
  return {
    ...workspaceRequest(b.userId, b.workspaceId),
    categoryId: parsePositiveInteger(b.categoryId, "categoryId"),
  }
}
export const parseDeleteTagRequest = (v: unknown): DeleteTagRequest => {
  const b = object(v)
  return {
    ...workspaceRequest(b.userId, b.workspaceId),
    tagId: parsePositiveInteger(b.tagId, "tagId"),
  }
}
export const parseDeleteStatusRequest = (v: unknown): DeleteStatusRequest => {
  const b = object(v)
  return {
    ...workspaceRequest(b.userId, b.workspaceId),
    statusId: parsePositiveInteger(b.statusId, "statusId"),
  }
}
export const parseDeleteWorkspaceRequest = (v: unknown): DeleteWorkspaceRequest => {
  const b = object(v)
  if (b.confirmation !== "delete-workspace")
    throw new Error('confirmation must be "delete-workspace".')
  return {
    userId: parsePositiveInteger(b.userId, "userId"),
    workspaceId: parsePositiveInteger(b.workspaceId, "workspaceId"),
    confirmation: b.confirmation,
  }
}
export const parseCreateItemRequest = (v: unknown): CreateItemRequest => {
  const b = object(v)
  return { userId: parsePositiveInteger(b.userId, "userId"), item: parseItemInput(b.item) }
}
export const parseUpdateItemRequest = (v: unknown) => {
  const b = object(v)
  return {
    userId: parsePositiveInteger(b.userId, "userId"),
    itemId: parsePositiveInteger(b.itemId, "itemId"),
    item: parseItemInput(b.item),
  }
}
export const parseDeleteItemRequest = (v: unknown): DeleteItemRequest => {
  const b = object(v)
  return {
    userId: parsePositiveInteger(b.userId, "userId"),
    itemId: parsePositiveInteger(b.itemId, "itemId"),
  }
}
export const parseSearchRequest = (v: unknown): SearchRequest => {
  const b = object(v)
  const query = label(b.query)
  if (!query) throw new Error("Search query is required.")
  return {
    ...workspaceRequest(b.userId, b.workspaceId),
    query,
    limit: parsePositiveInteger(b.limit ?? ITEMS_APP_SEARCH_MAX_RESULTS, "limit", {
      max: ITEMS_APP_SEARCH_MAX_RESULTS,
    }),
  }
}
export const parseTokenLoginRequest = (v: unknown): TokenLoginRequest => {
  const b = object(v)
  return {
    identifier: typeof b.identifier === "string" ? b.identifier.trim() : "",
    password: typeof b.password === "string" ? b.password : "",
  }
}
export const parseUpdateUserPreferencesRequest = (v: unknown): UpdateUserPreferencesRequest => {
  const b = object(v)
  if (typeof b.preferences !== "object" || b.preferences === null || Array.isArray(b.preferences))
    throw new Error("preferences must be a JSON object.")
  return {
    userId: parsePositiveInteger(b.userId, "userId"),
    preferences: b.preferences as UserPreferences,
  }
}
export interface ClaimAnonymousSessionRequest {
  username: string
  password: string
  email?: string
}
export const parseClaimAnonymousSessionRequest = (v: unknown): ClaimAnonymousSessionRequest => {
  const b = object(v)
  const username = typeof b.username === "string" ? b.username.trim() : ""
  const password = typeof b.password === "string" ? b.password : ""
  if (!username) throw new Error("username is required.")
  if (password.length < 8) throw new Error("password must be at least 8 characters.")
  const email = typeof b.email === "string" && b.email.trim() ? b.email.trim() : undefined
  if (email && !email.includes("@")) throw new Error("email must be a valid email address.")
  return { username, password, ...(email ? { email } : {}) }
}
export const parseEmbeddingMaintenanceRequest = (v: unknown): EmbeddingMaintenanceRequest => {
  const b = object(v)
  const mode = typeof b.mode === "string" ? b.mode.toLowerCase() : ""
  if (mode !== "missing" && mode !== "stale") throw new Error('mode must be "missing" or "stale".')
  return {
    userId: parsePositiveInteger(b.userId, "userId"),
    mode,
    limit: parsePositiveInteger(b.limit ?? 100, "limit", { max: 500 }),
  }
}

export const getItemsAppSession = async (r: SessionRequest): Promise<SessionResponse | null> => {
  const user = await getUserById(r.userId)
  return user ? { user } : null
}
export const loginItemsAppUser = async (
  r: TokenLoginRequest,
): Promise<TokenLoginResponse | null> => {
  const user = await verifyUserCredentials(r.identifier, r.password)
  return user ? { token: await createApiTokenForUser(user.id), user } : null
}
export const getItemsAppUserIdForToken = ({ token }: { token: string }) =>
  token ? findUserIdByApiToken(token) : Promise.resolve(null)
export const revokeItemsAppToken = ({ token }: { token: string }) =>
  token ? deleteApiToken(token) : Promise.resolve(false)
export const updateItemsAppUserPreferences = async (r: UpdateUserPreferencesRequest) => {
  const user = await updateUserPreferencesById(r.userId, r.preferences)
  return user ? { user } : null
}

export const listWorkspacesForItemsApp = async (
  r: WorkspacesRequest,
): Promise<WorkspacesResponse> => {
  const client = await getDb().connect()
  try {
    await ensureDefaultWorkspaceForUser(client, r.userId)
  } finally {
    client.release()
  }
  return { workspaces: await listWorkspacesByUser(r.userId) }
}
export const createWorkspaceForItemsApp = async (
  r: CreateWorkspaceRequest,
): Promise<WorkspaceResponse> => {
  if (!r.label) throw new Error("label is required.")
  return { workspace: await createWorkspaceForUser(r.userId, r.label) }
}
export const updateWorkspaceForItemsApp = async (
  r: UpdateWorkspaceRequest,
): Promise<WorkspaceResponse | null> => {
  if (!r.label) throw new Error("label is required.")
  const workspace = await updateWorkspaceForUser(r.userId, r.workspaceId, r.label)
  return workspace ? { workspace } : null
}
export const deleteWorkspaceForItemsApp = async (
  r: DeleteWorkspaceRequest,
): Promise<DeleteResponse | null> =>
  (await deleteWorkspaceForUser(r.userId, r.workspaceId)) ? { ok: true } : null
export const listItemsForItemsApp = async (r: ItemsRequest): Promise<ItemsResponse> => ({
  items: await listItemsByUser(r.userId, r.workspaceId),
})
export const listCategoriesForItemsApp = async (
  r: CategoriesRequest,
): Promise<CategoriesResponse> => ({
  categories: await listCategoriesByWorkspace(r.userId, r.workspaceId),
})
export const listTagsForItemsApp = async (r: TagsRequest): Promise<TagsResponse> => ({
  tags: await listTagsByWorkspace(r.userId, r.workspaceId),
})
export const listStatusesForItemsApp = async (r: StatusesRequest): Promise<StatusesResponse> => ({
  statuses: await listStatusesByWorkspace(r.userId, r.workspaceId),
})

const createLabelEntity = async (
  kind: "category" | "tag",
  userId: number,
  workspaceId: number,
  value: string,
) => {
  if (!value) throw new Error("label is required.")
  if (!(await getWorkspaceByIdForUser(userId, workspaceId))) throw new Error("Workspace not found.")
  // Embedding generation is an external request and may take tens of seconds.
  // Finish it before checking out a client so the small DB pool remains
  // available to ordinary item reads and writes while that request is pending.
  const e = await createTagLabelEmbedding(value)
  const client = await getDb().connect()
  try {
    await client.query("BEGIN")
    const id =
      kind === "category"
        ? await resolveCategoryIdForWorkspace(client, workspaceId, value)
        : await resolveTagIdForWorkspace(client, workspaceId, value)
    if (!id) throw new Error("Failed to resolve label.")
    const table = kind === "category" ? "workspace_category_v1" : "workspace_tag_v1"
    const column = kind === "category" ? "category_embedding" : "tag_embedding"
    await client.query(
      `UPDATE public.${table} SET ${column}=$1::vector,embedding_model=$2,embedding_updated_at=$3 WHERE id=$4 AND workspace_id=$5`,
      [
        e.vectorLiteral,
        e.embeddingModel,
        e.embeddingModel ? new Date().toISOString() : null,
        id,
        workspaceId,
      ],
    )
    await client.query("COMMIT")
    return id
  } catch (e) {
    await client.query("ROLLBACK")
    throw e
  } finally {
    client.release()
  }
}
export const createCategoryForItemsApp = async (
  r: CreateCategoryRequest,
): Promise<CreateCategoryResponse> => {
  assertCategoryNameAllowed(r.label)
  const id = await createLabelEntity("category", r.userId, r.workspaceId, r.label)
  const category = await getCategoryByIdForWorkspace(r.userId, r.workspaceId, id)
  if (!category) throw new Error("Failed to load category.")
  return { category }
}
export const createTagForItemsApp = async (r: CreateTagRequest): Promise<CreateTagResponse> => {
  const id = await createLabelEntity("tag", r.userId, r.workspaceId, r.label)
  const tag = await getTagByIdForWorkspace(r.userId, r.workspaceId, id)
  if (!tag) throw new Error("Failed to load tag.")
  return { tag }
}
export const createStatusForItemsApp = async (r: CreateStatusRequest): Promise<StatusResponse> => {
  if (!r.label) throw new Error("label is required.")
  const status = await createStatusForWorkspace(r.userId, r.workspaceId, r.label)
  if (!status) throw new Error("Workspace not found.")
  return { status }
}
export const updateCategoryForItemsApp = async (
  r: UpdateCategoryRequest,
): Promise<UpdateCategoryResponse | null> => {
  assertCategoryNameAllowed(r.label)
  if (!r.label) throw new Error("label is required.")
  const e = await createTagLabelEmbedding(r.label)
  const category = await updateCategoryLabelForWorkspace(
    r.userId,
    r.workspaceId,
    r.categoryId,
    r.label,
    e.vectorLiteral,
    e.embeddingModel,
  )
  return category ? { category } : null
}
export const updateTagForItemsApp = async (
  r: UpdateTagRequest,
): Promise<UpdateTagResponse | null> => {
  if (!r.label) throw new Error("label is required.")
  const e = await createTagLabelEmbedding(r.label)
  const tag = await updateTagLabelForWorkspace(
    r.userId,
    r.workspaceId,
    r.tagId,
    r.label,
    e.vectorLiteral,
    e.embeddingModel,
  )
  return tag ? { tag } : null
}
export const updateStatusForItemsApp = async (
  r: UpdateStatusRequest,
): Promise<StatusResponse | null> => {
  if (!r.label) throw new Error("label is required.")
  const status = await updateStatusForWorkspace(
    r.userId,
    r.workspaceId,
    r.statusId,
    r.label,
    r.position,
  )
  return status ? { status } : null
}
export const deleteCategoryForItemsApp = async (
  r: DeleteCategoryRequest,
): Promise<DeleteCategoryResponse | null> =>
  (await deleteCategoryForWorkspace(r.userId, r.workspaceId, r.categoryId)) ? { ok: true } : null
export const deleteTagForItemsApp = async (
  r: DeleteTagRequest,
): Promise<DeleteTagResponse | null> => {
  const count = await deleteTagForWorkspace(r.userId, r.workspaceId, r.tagId)
  return count === null ? null : { ok: true, deletedLinks: count }
}
export const deleteStatusForItemsApp = async (
  r: DeleteStatusRequest,
): Promise<DeleteResponse | null> =>
  (await deleteStatusForWorkspace(r.userId, r.workspaceId, r.statusId)) ? { ok: true } : null
export const createItemForItemsApp = async (r: CreateItemRequest): Promise<ItemResponse> => ({
  item: await createItemForUser(
    r.userId,
    r.item,
    await createItemEmbeddingInput({ description: r.item.description }),
  ),
})
const normalized = (v: string | null | undefined) => (v ?? "").trim()
const canReuse = (
  s: { description: string | null; has_embedding: boolean; embedding_model: string | null } | null,
  d: string | null,
) =>
  !!s &&
  normalized(s.description) === normalized(d) &&
  (normalized(d) === ""
    ? s.embedding_model === null && !s.has_embedding
    : s.has_embedding && s.embedding_model === CURRENT_ITEM_EMBEDDING_MODEL)
export const updateItemForItemsApp = async (
  r: ReturnType<typeof parseUpdateItemRequest>,
): Promise<ItemResponse | null> => {
  const stored = await selectItemEmbeddingStateById(r.itemId, r.userId)
  // A stale editor must see the deletion immediately, before any provider call.
  if (!stored) return null
  if (canReuse(stored, r.item.description)) {
    const item = await updateItemForUser(
      r.itemId,
      r.userId,
      r.item,
      null,
      stored?.description ?? null,
    )
    if (item) return { item }
  }
  const item = await updateItemForUser(
    r.itemId,
    r.userId,
    r.item,
    await createItemEmbeddingInput({ description: r.item.description }),
  )
  return item ? { item } : null
}
export const deleteItemForItemsApp = async (
  r: DeleteItemRequest,
): Promise<DeleteResponse | null> =>
  (await deleteItemForUser(r.itemId, r.userId)) ? { ok: true } : null
export const searchItemsForItemsApp = async (r: SearchRequest): Promise<SearchResponse> => ({
  results: await searchItemsByEmbedding(
    r.userId,
    r.workspaceId,
    await createQueryEmbedding(r.query),
    r.limit,
  ),
})

export const maintainItemEmbeddingsForItemsApp = async (
  r: EmbeddingMaintenanceRequest,
): Promise<EmbeddingMaintenanceResponse> => {
  const stale = r.mode === "stale"
  const categories = await (
    stale ? listCategoriesStaleEmbeddingsByUser : listCategoriesMissingEmbeddingsByUser
  )(r.userId, r.limit)
  let categoriesUpdated = 0
  for (const job of await createBackfillTagEmbeddings(categories)) {
    if (
      await updateCategoryEmbeddingById(r.userId, job.tagId, job.vectorLiteral, job.embeddingModel)
    )
      categoriesUpdated++
  }
  const tags = await (stale ? listTagsStaleEmbeddingsByUser : listTagsMissingEmbeddingsByUser)(
    r.userId,
    r.limit,
  )
  let tagsUpdated = 0
  for (const job of await createBackfillTagEmbeddings(tags)) {
    if (await updateTagEmbeddingById(r.userId, job.tagId, job.vectorLiteral, job.embeddingModel))
      tagsUpdated++
  }
  const items = await (stale ? listItemsStaleEmbeddingsByUser : listItemsMissingEmbeddingsByUser)(
    r.userId,
    r.limit,
  )
  let updated = 0
  for (const job of await createBackfillEmbeddingInputs(items)) {
    await updateItemEmbeddingsForUser(job.itemId, r.userId, job.input)
    updated++
  }
  return {
    mode: r.mode,
    processed: items.length,
    updated,
    categoriesUpdated,
    tagsUpdated,
    hasMore: [categories.length, tags.length, items.length].some((n) => n === r.limit),
  }
}
export const createAnonymousItemsAppSession = async (): Promise<SessionResponse> => ({
  user: await createAnonymousUser(),
})
export const claimAnonymousItemsAppSession = async (r: {
  anonUserId: number
  username: string
  password: string
  email?: string
}): Promise<SessionResponse> => ({
  user: await claimAnonymousUser(r.anonUserId, {
    username: r.username,
    password: r.password,
    email: r.email,
  }),
})
export const mergeAnonymousItemsAppSession = async (r: {
  anonUserId: number
  realUserId: number
}): Promise<SessionResponse> => {
  await mergeAnonymousUserInto(r.anonUserId, r.realUserId)
  const user = await getUserById(r.realUserId)
  if (!user) throw new Error("Real user not found after merge.")
  return { user }
}

export const itemsAppService = {
  executeItemGroupActionForItemsApp,
  previewItemGroupForItemsApp,
  exportUserBackup,
  restoreUserBackup,
  getItemsAppErrorStatus,
  getItemsAppSession,
  loginItemsAppUser,
  getItemsAppUserIdForToken,
  revokeItemsAppToken,
  updateItemsAppUserPreferences,
  listWorkspacesForItemsApp,
  createWorkspaceForItemsApp,
  updateWorkspaceForItemsApp,
  deleteWorkspaceForItemsApp,
  listItemsForItemsApp,
  listCategoriesForItemsApp,
  listStatusesForItemsApp,
  listTagsForItemsApp,
  createCategoryForItemsApp,
  createStatusForItemsApp,
  createTagForItemsApp,
  updateCategoryForItemsApp,
  updateStatusForItemsApp,
  updateTagForItemsApp,
  deleteCategoryForItemsApp,
  deleteStatusForItemsApp,
  deleteTagForItemsApp,
  createItemForItemsApp,
  updateItemForItemsApp,
  deleteItemForItemsApp,
  searchItemsForItemsApp,
  maintainItemEmbeddingsForItemsApp,
  createAnonymousItemsAppSession,
  claimAnonymousItemsAppSession,
  mergeAnonymousItemsAppSession,
}
export type ItemsAppService = typeof itemsAppService
export { EmbeddingConfigurationError, EmbeddingRequestError } from "./item-embeddings"
