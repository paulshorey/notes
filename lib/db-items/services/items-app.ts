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
  CombineJournalDayRequest,
  DeleteItemRequest,
  ErrorCode,
  ItemEmbeddingRequest,
  DeleteResponse,
  ItemRecord,
  UpdateItemRequest,
  PurgeTrashRequest,
  PurgeTrashResponse,
  RestoreTrashedItemRequest,
  TrashRequest,
  TrashResponse,
  DeleteStatusRequest,
  DeleteTagRequest,
  DeleteTagResponse,
  DeleteWorkspaceRequest,
  EmbeddingMaintenanceRequest,
  EmbeddingMaintenanceResponse,
  ItemsRequest,
  ItemsResponse,
  CreateItemResponse,
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
import {
  assertItemHasContent,
  ItemContentRequiredError,
  ItemRequirementError,
} from "../contracts/item-capabilities"
import { JournalDayTakenError, parseEntryDate } from "../contracts/item-journal"
import { normalizeTimeBlock } from "../contracts/item-time"
import { combineItemIntoJournalDay } from "../sql/item/journal"
import { exportUserBackup, restoreUserBackup } from "../sql/user/backup"
export { BackupAccountError } from "../sql/user/backup"
import { ITEMS_APP_SEARCH_MAX_RESULTS } from "../item-search-constants"
import {
  createOrFindItemForUser,
  deleteItemForUser,
  findItemByIdForUser,
  listTrashedItemsByUser,
  purgeTrashedItemsForUser,
  restoreTrashedItemForUser,
  TRASH_RETENTION_DAYS,
  ItemChangedError,
  findWorkspaceIdByItem,
  listItemsByUser,
  listItemsMissingEmbeddingsByUser,
  listItemsStaleEmbeddingsByUser,
  parseItemInput,
  parseItemPatch,
  searchItemsByEmbedding,
  selectItemEmbeddingStateById,
  updateItemEmbeddingsForUser,
  updateItemForUser,
} from "../sql/item"
import { resolveCategoryIdForWorkspace, resolveTagIdForWorkspace } from "../sql/item/shared"
import {
  createSubcategoryForWorkspace,
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
import { PUBLIC_UID_TAKEN_ERROR } from "../contracts/public-uid"
import {
  createBackfillEmbeddingInputs,
  createBackfillTagEmbeddings,
  createItemEmbeddingInput,
  createQueryEmbedding,
  CURRENT_ITEM_EMBEDDING_MODEL,
  EmbeddingConfigurationError,
  EmbeddingRequestError,
} from "./item-embeddings"

export const ITEMS_APP_ITEM_NOT_FOUND_ERROR = "Item not found."
export const ITEMS_APP_TRASHED_ITEM_NOT_FOUND_ERROR = "This item is no longer in the trash."
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
const errorCodeOf = (error: unknown) =>
  typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
    ? error.code
    : null

/** A PostgreSQL error, as opposed to a request the service refused. */
const isDatabaseError = (error: unknown) => /^[0-9A-Z]{5}$/.test(errorCodeOf(error) ?? "")

/** A fault in the program itself: never the caller's doing, never shown to the caller. */
const isProgramError = (error: unknown) =>
  error instanceof TypeError ||
  error instanceof RangeError ||
  error instanceof ReferenceError ||
  error instanceof SyntaxError

export interface ItemsAppErrorDescription {
  status: number
  code: ErrorCode
  /** The sentence the caller is shown. */
  message: string
  /** True when the cause is the server's and belongs in its log, not in the answer. */
  internal: boolean
}

const refused = (status: number, code: ErrorCode, error: unknown): ItemsAppErrorDescription => ({
  status,
  code,
  message: error instanceof Error ? error.message : "The request was refused.",
  internal: false,
})

/**
 * What an error thrown by this service means to a caller. A request the service
 * refused keeps its sentence. A database or program fault is reported without its
 * detail, which stays in the server log.
 */
export const describeItemsAppError = (error: unknown): ItemsAppErrorDescription => {
  if (error instanceof ItemChangedError) return refused(409, "item_changed", error)
  if (error instanceof JournalDayTakenError) return refused(409, "journal_day_taken", error)
  if (error instanceof ItemGroupConflictError) return refused(409, "conflict", error)
  if (error instanceof ItemGroupNotFoundError) return refused(404, "not_found", error)
  if (error instanceof ItemContentRequiredError) return refused(400, "content_required", error)
  if (error instanceof ItemRequirementError) return refused(400, "requirement_missing", error)
  if (
    error instanceof Error &&
    (error.message === CLAIM_IDENTIFIER_TAKEN_ERROR || error.message === PUBLIC_UID_TAKEN_ERROR)
  )
    return refused(409, "conflict", error)
  if (error instanceof EmbeddingConfigurationError || error instanceof EmbeddingRequestError)
    return {
      status: 503,
      code: "search_unavailable",
      message: "Search is temporarily unavailable.",
      internal: true,
    }
  if (isDatabaseAvailabilityError(error))
    return {
      status: 503,
      code: "unavailable",
      message: "The database is unavailable. Please retry.",
      internal: true,
    }
  // A label that is already taken, reported by the unique index that keeps it so.
  if (errorCodeOf(error) === "23505")
    return {
      status: 409,
      code: "conflict",
      message: "That name is already in use.",
      internal: false,
    }
  if (isDatabaseError(error) || isProgramError(error) || !(error instanceof Error))
    return { status: 500, code: "internal", message: "Unexpected server error.", internal: true }
  return refused(400, "invalid_request", error)
}
export const getItemsAppErrorStatus = (error: unknown) => describeItemsAppError(error).status
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
  const parent = object(v).categoryId
  return parent == null
    ? request
    : { ...request, categoryId: parsePositiveInteger(parent, "categoryId") }
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
export const parseUpdateItemRequest = (v: unknown): UpdateItemRequest => {
  const b = object(v)
  const expected = b.expectedTimeModified
  if (expected != null && (typeof expected !== "string" || Number.isNaN(Date.parse(expected))))
    throw new Error("expectedTimeModified must be a valid date.")
  return {
    userId: parsePositiveInteger(b.userId, "userId"),
    itemId: parsePositiveInteger(b.itemId, "itemId"),
    item: parseItemPatch(b.item),
    ...(typeof expected === "string"
      ? { expectedTimeModified: new Date(expected).toISOString() }
      : {}),
  }
}
export const parseDeleteItemRequest = (v: unknown): DeleteItemRequest => {
  const b = object(v)
  return {
    userId: parsePositiveInteger(b.userId, "userId"),
    itemId: parsePositiveInteger(b.itemId, "itemId"),
    ...(b.workspaceId === undefined
      ? {}
      : { workspaceId: parsePositiveInteger(b.workspaceId, "workspaceId") }),
  }
}
export const parseTrashRequest = (userId: unknown, before?: unknown): TrashRequest => ({
  userId: parsePositiveInteger(userId, "userId"),
  ...(before == null || before === "" ? {} : { before: parsePositiveInteger(before, "before") }),
})
export const parseRestoreTrashedItemRequest = (v: unknown): RestoreTrashedItemRequest => {
  const b = object(v)
  return {
    ...parseTrashRequest(b.userId),
    trashId: parsePositiveInteger(b.trashId, "trashId"),
    ...(b.combineJournalDay === true ? { combineJournalDay: true } : {}),
  }
}
export const parseCombineJournalDayRequest = (v: unknown): CombineJournalDayRequest => {
  const b = object(v)
  const entryDate = parseEntryDate(b.entryDate)
  if (entryDate === null) throw new Error("Journal day is required.")
  return {
    userId: parsePositiveInteger(b.userId, "userId"),
    itemId: parsePositiveInteger(b.itemId, "itemId"),
    entryDate,
  }
}
export const parsePurgeTrashRequest = (v: unknown): PurgeTrashRequest => {
  const b = object(v)
  return {
    ...parseTrashRequest(b.userId),
    ...(b.trashId === undefined ? {} : { trashId: parsePositiveInteger(b.trashId, "trashId") }),
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
  const verified = await verifyUserCredentials(r.identifier, r.password)
  if (!verified) return null

  const { user, credentialVersion } = verified
  const token = await createApiTokenForUser(user.id, credentialVersion)
  return token ? { token, user } : null
}
export const getItemsAppUserIdForToken = ({ token }: { token: string }) =>
  token ? findUserIdByApiToken(token) : Promise.resolve(null)
export const revokeItemsAppToken = ({ token }: { token: string }) =>
  token ? deleteApiToken(token) : Promise.resolve(false)
export const updateItemsAppUserPreferences = async (r: UpdateUserPreferencesRequest) => {
  const user = await updateUserPreferencesById(r.userId, r.preferences)
  return user ? { user } : null
}

/**
 * Resolve a bookmark to the workspace that currently owns the item for this user.
 */
export const findItemWorkspaceForItemsApp = async (r: {
  userId: number
  target: string | number
}) => findWorkspaceIdByItem(r.userId, r.target)

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

// A label is stored without an embedding; embedding maintenance writes it afterwards,
// so creating or renaming a category or tag never waits on the provider.
const createLabelEntity = async (
  kind: "category" | "tag",
  userId: number,
  workspaceId: number,
  value: string,
) => {
  if (!value) throw new Error("label is required.")
  if (!(await getWorkspaceByIdForUser(userId, workspaceId))) throw new Error("Workspace not found.")
  const client = await getDb().connect()
  try {
    const id =
      kind === "category"
        ? await resolveCategoryIdForWorkspace(client, workspaceId, value)
        : await resolveTagIdForWorkspace(client, workspaceId, value)
    if (!id) throw new Error("Failed to resolve label.")
    return id
  } finally {
    client.release()
  }
}
export const createCategoryForItemsApp = async (
  r: CreateCategoryRequest,
): Promise<CreateCategoryResponse> => {
  assertCategoryNameAllowed(r.label)
  if (r.categoryId !== undefined) {
    if (!r.label) throw new Error("label is required.")
    const created = await createSubcategoryForWorkspace(
      r.userId,
      r.workspaceId,
      r.categoryId,
      r.label,
    )
    if (!created) throw new Error(ITEMS_APP_CATEGORY_NOT_FOUND_ERROR)
    return created
  }
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
  const category = await updateCategoryLabelForWorkspace(
    r.userId,
    r.workspaceId,
    r.categoryId,
    r.label,
    null,
    null,
  )
  return category ? { category } : null
}
export const updateTagForItemsApp = async (
  r: UpdateTagRequest,
): Promise<UpdateTagResponse | null> => {
  if (!r.label) throw new Error("label is required.")
  const tag = await updateTagLabelForWorkspace(
    r.userId,
    r.workspaceId,
    r.tagId,
    r.label,
    null,
    null,
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
// Storage accepts a bare item. The service refuses an item that holds no content, which
// the item model defines; nothing here names a field.
//
// An item write never waits on the embedding provider. A new item, or one whose text
// changed, is stored without an embedding, and `embedItemForItemsApp` writes it
// afterwards. Until then search does not rank the item; when the provider is down,
// embedding maintenance writes it later.
export const createItemForItemsApp = async (
  request: CreateItemRequest,
): Promise<CreateItemResponse> => {
  const r = { ...request, item: normalizeTimeBlock(request.item) }
  assertItemHasContent(r.item)
  return createOrFindItemForUser(r.userId, r.item)
}

export { ITEM_CHANGED_ERROR, ItemChangedError } from "../sql/item"

/**
 * Apply a patch to an item: the fields it names are written and the rest stay as
 * stored. Returns null when the user has no such item.
 */
export const updateItemForItemsApp = async (r: UpdateItemRequest): Promise<ItemResponse | null> => {
  const item = await updateItemForUser(r.itemId, r.userId, normalizeTimeBlock(r.item), {
    expectedTimeModified: r.expectedTimeModified ?? null,
  })
  return item ? { item } : null
}

/**
 * Write the embedding of an item's text when it has none or an outdated one. Call it
 * after a write that may have changed the text; it does nothing for an item that is
 * already embedded, has no text, or is gone. Returns whether an embedding was stored.
 * It throws when the provider fails, which leaves the item to embedding maintenance.
 */
export const embedItemForItemsApp = async (r: ItemEmbeddingRequest): Promise<boolean> => {
  const stored = await selectItemEmbeddingStateById(r.itemId, r.userId)
  if (!stored || (stored.description ?? "").trim() === "") return false
  if (stored.has_embedding && stored.embedding_model === CURRENT_ITEM_EMBEDDING_MODEL) return false
  return updateItemEmbeddingsForUser(
    r.itemId,
    r.userId,
    await createItemEmbeddingInput({ description: stored.description }),
    stored.description,
  )
}
export const deleteItemForItemsApp = async (
  r: DeleteItemRequest,
): Promise<DeleteResponse | null> => {
  if (await deleteItemForUser(r.itemId, r.userId, r.workspaceId)) return { ok: true }
  if (r.workspaceId !== undefined) {
    const workspaceId = await findWorkspaceIdByItem(r.userId, r.itemId)
    if (workspaceId !== null && workspaceId !== r.workspaceId) {
      throw new ItemGroupConflictError("This item moved to another workspace.")
    }
  }
  return null
}
export const listTrashForItemsApp = async (r: TrashRequest): Promise<TrashResponse> => ({
  ...(await listTrashedItemsByUser(r.userId, r.before ?? null)),
  retentionDays: TRASH_RETENTION_DAYS,
})
/** The restored item has no embedding; the caller follows with `embedItemForItemsApp`. */
export const restoreTrashedItemForItemsApp = async (
  r: RestoreTrashedItemRequest,
): Promise<ItemResponse | null> => {
  const itemId = await restoreTrashedItemForUser(r.userId, r.trashId, {
    combineJournalDay: r.combineJournalDay === true,
  })
  if (itemId === null) return null
  const item = await findItemByIdForUser(r.userId, itemId)
  return item ? { item } : null
}
/**
 * Combining two journal days is permanent: the item's text and tags join the entry the
 * day already has, and the item is deleted without going to the trash. The entry's
 * embedding is cleared when its text changes; the caller follows with
 * `embedItemForItemsApp`.
 */
export const combineJournalDayForItemsApp = async (
  r: CombineJournalDayRequest,
): Promise<ItemResponse | null> => {
  const item = await combineItemIntoJournalDay(r.userId, r.itemId, r.entryDate)
  return item ? { item } : null
}
export const purgeTrashForItemsApp = async (r: PurgeTrashRequest): Promise<PurgeTrashResponse> => ({
  ok: true,
  purged: await purgeTrashedItemsForUser(r.userId, r.trashId ?? null),
})
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
  const textById = new Map(items.map((item) => [item.id, item.description]))
  let updated = 0
  for (const job of await createBackfillEmbeddingInputs(items)) {
    // An item edited while the provider answered keeps no embedding of its old text.
    if (
      await updateItemEmbeddingsForUser(
        job.itemId,
        r.userId,
        job.input,
        textById.get(job.itemId) ?? null,
      )
    )
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
  describeItemsAppError,
  getItemsAppSession,
  loginItemsAppUser,
  getItemsAppUserIdForToken,
  revokeItemsAppToken,
  updateItemsAppUserPreferences,
  findItemWorkspaceForItemsApp,
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
  embedItemForItemsApp,
  deleteItemForItemsApp,
  listTrashForItemsApp,
  restoreTrashedItemForItemsApp,
  combineJournalDayForItemsApp,
  purgeTrashForItemsApp,
  searchItemsForItemsApp,
  maintainItemEmbeddingsForItemsApp,
  createAnonymousItemsAppSession,
  claimAnonymousItemsAppSession,
  mergeAnonymousItemsAppSession,
}
export type ItemsAppService = typeof itemsAppService
export { EmbeddingConfigurationError, EmbeddingRequestError } from "./item-embeddings"
