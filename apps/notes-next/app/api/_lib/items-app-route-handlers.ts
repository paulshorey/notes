import { after, NextResponse } from "next/server"
import type { ErrorCode } from "@lib/db-items/contracts/items-app"
import { itemModelDocument } from "@lib/db-items/contracts/item-model"
import { InvalidRequestError } from "@lib/db-items/contracts/request-error"
import {
  ITEMS_APP_AUTH_REQUIRED_ERROR,
  ITEMS_APP_CATEGORY_NOT_FOUND_ERROR,
  ITEMS_APP_INVALID_CREDENTIALS_ERROR,
  ITEMS_APP_TAG_NOT_FOUND_ERROR,
  ITEMS_APP_ITEM_NOT_FOUND_ERROR,
  ITEMS_APP_STATUS_NOT_FOUND_ERROR,
  ITEMS_APP_WORKSPACE_NOT_FOUND_ERROR,
  ITEMS_APP_USER_NOT_FOUND_ERROR,
  ITEMS_APP_TRASHED_ITEM_NOT_FOUND_ERROR,
  describeItemsAppError,
  ItemChangedError,
  itemsAppService,
  parseCategoriesRequest,
  parseCombineJournalDayRequest,
  parseCreateCategoryRequest,
  parseCreateItemRequest,
  parseCreateStatusRequest,
  parseCreateTagRequest,
  parseCreateWorkspaceRequest,
  parseDeleteCategoryRequest,
  parseDeleteItemRequest,
  parseDeleteStatusRequest,
  parseDeleteTagRequest,
  parseDeleteWorkspaceRequest,
  parseEmbeddingMaintenanceRequest,
  parseExecuteItemGroupActionRequest,
  parseItemsRequest,
  parsePreviewItemGroupRequest,
  parsePurgeTrashRequest,
  parseRestoreTrashedItemRequest,
  parseSearchRequest,
  parseSessionRequest,
  parseStatusesRequest,
  parseTagsRequest,
  parseTokenLoginRequest,
  parseTrashRequest,
  parseUpdateCategoryRequest,
  parseUpdateItemRequest,
  parseUpdateStatusRequest,
  parseUpdateTagRequest,
  parseUpdateUserPreferencesRequest,
  parseUpdateWorkspaceRequest,
  parseWorkspacesRequest,
  type ItemsAppService,
} from "@lib/db-items/services/items-app"

/**
 * Resolves the NextAuth (cookie) session to a Notes user id. Kept injectable
 * so route files wire in the real resolver while tests stay hermetic and rely
 * on bearer tokens only.
 */
export type SessionUserResolver = () => Promise<number | null>

const noSessionUser: SessionUserResolver = async () => null

const readBearerToken = (request: Request): string | null => {
  const header = request.headers.get("authorization")

  if (!header) {
    return null
  }

  const match = header.match(/^Bearer\s+(.+)$/i)
  return match?.[1] ? match[1].trim() : null
}

/**
 * Derives the authenticated user id for a request. Clients never choose their
 * own userId: a bearer token or the NextAuth session cookie
 * is the only source of identity. Returns null when unauthenticated.
 */
export const resolveRequestUserId = async (
  request: Request,
  service: ItemsAppService,
  resolveSessionUserId: SessionUserResolver,
): Promise<number | null> => {
  const token = readBearerToken(request)

  if (token !== null) {
    return service.getItemsAppUserIdForToken({ token })
  }

  return resolveSessionUserId()
}

/** Every answer is one user's data at one moment, so none of it is cached. */
const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } })

/**
 * A failed request answers `{ error, code }`: a sentence for a person and a code for a
 * program. Extra fields, such as the stored item of a conflict, sit beside them.
 */
export const errorJson = (
  status: number,
  code: ErrorCode,
  error: string,
  extra: Record<string, unknown> = {},
) => json({ error, code, ...extra }, status)

const unauthorizedResponse = () => errorJson(401, "unauthenticated", ITEMS_APP_AUTH_REQUIRED_ERROR)

/** Thrown by a handler whose service call found nothing to act on. */
class NotFound extends Error {}

/** The service's answer, or a `404` with this message when it found nothing. */
const found = <Result>(result: Result | null, message: string): Result => {
  if (result === null) throw new NotFound(message)
  return result
}

/** The answer for anything a handler throws. A server fault is logged, not shown. */
export const errorResponse = (error: unknown) => {
  if (error instanceof NotFound) return errorJson(404, "not_found", error.message)
  const described = describeItemsAppError(error)
  if (described.internal) console.error("Items API request failed:", error)
  return errorJson(
    described.status,
    described.code,
    described.message,
    // The caller's edit began from an older version. It gets the stored item, so it
    // can tell a change that matters from one that does not.
    error instanceof ItemChangedError ? { item: error.item } : {},
  )
}

const readJsonObject = async (request: Request) => {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    throw new InvalidRequestError("Request body must be valid JSON.")
  }
  if (typeof body !== "object" || body === null || Array.isArray(body))
    throw new InvalidRequestError("Request body must be a JSON object.")
  return body as Record<string, unknown>
}

interface RouteContext {
  request: Request
  service: ItemsAppService
  /** The acting user. A client never chooses it. */
  userId: number
  /** The request's JSON body with the acting user's id written over any it named. */
  body: () => Promise<Record<string, unknown>>
  /** A query parameter of the request, or null. */
  query: (name: string) => string | null
}

/** An answer with a status other than 200. */
class Answer {
  constructor(
    readonly body: unknown,
    readonly status: number,
  ) {}
}
const withStatus = (body: unknown, status: number) => new Answer(body, status)

/**
 * One authenticated route: resolve the user, run the handler, and turn what it returns
 * or throws into the answer. Every data route goes through here, so authentication and
 * error answers are the same everywhere.
 */
const route =
  (
    service: ItemsAppService,
    resolveSessionUserId: SessionUserResolver,
    handle: (context: RouteContext) => Promise<unknown>,
  ) =>
  async (request: Request) => {
    try {
      const userId = await resolveRequestUserId(request, service, resolveSessionUserId)
      if (userId === null) return unauthorizedResponse()
      const result = await handle({
        request,
        service,
        userId,
        body: async () => ({ ...(await readJsonObject(request)), userId }),
        query: (name) => new URL(request.url).searchParams.get(name),
      })
      return result instanceof Answer ? json(result.body, result.status) : json(result)
    } catch (error) {
      return errorResponse(error)
    }
  }

/**
 * Write an item's embedding once the answer has been sent. A failure leaves the item
 * without one, which embedding maintenance repairs.
 */
const embedAfterResponse = (service: ItemsAppService, userId: number, itemId: number) => {
  const run = () =>
    service
      .embedItemForItemsApp({ userId, itemId })
      .then(() => undefined)
      .catch((error: unknown) => console.error(`Embedding item ${itemId} failed:`, error))
  try {
    after(run)
  } catch {
    // Outside a Next.js request, as in a test, there is no response to wait for.
    void run()
  }
}

type Factory<Methods extends string> = (
  service?: ItemsAppService,
  resolveSessionUserId?: SessionUserResolver,
) => Record<Methods, (request: Request) => Promise<Response>>

/** One authenticated transport for every group selector and bulk action. */
export const createItemGroupRouteHandlers: Factory<"POST" | "PATCH"> = (
  service = itemsAppService,
  resolveSessionUserId = noSessionUser,
) => ({
  POST: route(service, resolveSessionUserId, async ({ body }) =>
    service.previewItemGroupForItemsApp(parsePreviewItemGroupRequest(await body())),
  ),
  PATCH: route(service, resolveSessionUserId, async ({ body }) =>
    service.executeItemGroupActionForItemsApp(parseExecuteItemGroupActionRequest(await body())),
  ),
})

export const createAuthTokenRouteHandlers = (service: ItemsAppService = itemsAppService) => ({
  POST: async (request: Request) => {
    try {
      const result = await service.loginItemsAppUser(
        parseTokenLoginRequest(await readJsonObject(request)),
      )
      return result
        ? json(result)
        : errorJson(401, "unauthenticated", ITEMS_APP_INVALID_CREDENTIALS_ERROR)
    } catch (error) {
      return errorResponse(error)
    }
  },
  DELETE: async (request: Request) => {
    try {
      const token = readBearerToken(request)
      if (token === null) return unauthorizedResponse()
      await service.revokeItemsAppToken({ token })
      return json({ ok: true })
    } catch (error) {
      return errorResponse(error)
    }
  },
})

export const createSessionRouteHandlers: Factory<"GET" | "PATCH"> = (
  service = itemsAppService,
  resolveSessionUserId = noSessionUser,
) => ({
  GET: route(service, resolveSessionUserId, async ({ userId }) =>
    found(
      await service.getItemsAppSession(parseSessionRequest(userId)),
      ITEMS_APP_USER_NOT_FOUND_ERROR,
    ),
  ),
  PATCH: route(service, resolveSessionUserId, async ({ body }) =>
    found(
      await service.updateItemsAppUserPreferences(parseUpdateUserPreferencesRequest(await body())),
      ITEMS_APP_USER_NOT_FOUND_ERROR,
    ),
  ),
})

/**
 * GET lists a workspace's items, POST creates one, PATCH changes the fields it names
 * on one, and DELETE sends one to the trash.
 */
export const createItemsRouteHandlers: Factory<"GET" | "POST" | "PATCH" | "DELETE"> = (
  service = itemsAppService,
  resolveSessionUserId = noSessionUser,
) => ({
  GET: route(service, resolveSessionUserId, ({ userId, query }) =>
    service.listItemsForItemsApp(parseItemsRequest(userId, query("workspaceId"))),
  ),
  POST: route(service, resolveSessionUserId, async ({ body, userId }) => {
    const result = await service.createItemForItemsApp(parseCreateItemRequest(await body()))
    // A create that named the uid of an existing item wrote nothing and answers 200
    // with that item, so the caller can tell its content was not stored.
    if (result.created === false) return { item: result.item }
    embedAfterResponse(service, userId, result.item.id)
    return withStatus({ item: result.item }, 201)
  }),
  PATCH: route(service, resolveSessionUserId, async ({ body, userId }) => {
    const result = found(
      await service.updateItemForItemsApp(parseUpdateItemRequest(await body())),
      ITEMS_APP_ITEM_NOT_FOUND_ERROR,
    )
    embedAfterResponse(service, userId, result.item.id)
    return result
  }),
  DELETE: route(service, resolveSessionUserId, async ({ body }) =>
    found(
      await service.deleteItemForItemsApp(parseDeleteItemRequest(await body())),
      ITEMS_APP_ITEM_NOT_FOUND_ERROR,
    ),
  ),
})

/**
 * GET answers the item model: what an item can hold, which combinations are which
 * kinds, and what a write does. It is the same for every user.
 */
export const createItemModelRouteHandlers = () => ({
  GET: async () =>
    NextResponse.json(itemModelDocument(), {
      headers: { "Cache-Control": "public, max-age=300" },
    }),
})

/**
 * The user's trash: GET lists a page of it, POST restores one entry as an item, and
 * DELETE removes one entry for good, or every entry when none is named.
 */
export const createTrashRouteHandlers: Factory<"GET" | "POST" | "DELETE"> = (
  service = itemsAppService,
  resolveSessionUserId = noSessionUser,
) => ({
  GET: route(service, resolveSessionUserId, ({ userId, query }) =>
    service.listTrashForItemsApp(parseTrashRequest(userId, query("before"))),
  ),
  POST: route(service, resolveSessionUserId, async ({ body, userId }) => {
    const result = found(
      await service.restoreTrashedItemForItemsApp(parseRestoreTrashedItemRequest(await body())),
      ITEMS_APP_TRASHED_ITEM_NOT_FOUND_ERROR,
    )
    // Derived data is not kept in the trash, so search needs the text embedded again.
    embedAfterResponse(service, userId, result.item.id)
    return result
  }),
  DELETE: route(service, resolveSessionUserId, async ({ body }) =>
    service.purgeTrashForItemsApp(parsePurgeTrashRequest(await body())),
  ),
})

/**
 * POST gives an item a journal day that another entry already has, by combining it
 * into that entry. The answer is the entry that now holds both.
 */
export const createJournalRouteHandlers: Factory<"POST"> = (
  service = itemsAppService,
  resolveSessionUserId = noSessionUser,
) => ({
  POST: route(service, resolveSessionUserId, async ({ body, userId }) => {
    const result = found(
      await service.combineJournalDayForItemsApp(parseCombineJournalDayRequest(await body())),
      ITEMS_APP_ITEM_NOT_FOUND_ERROR,
    )
    embedAfterResponse(service, userId, result.item.id)
    return result
  }),
})

export const createTagsRouteHandlers: Factory<"GET" | "POST" | "PATCH" | "DELETE"> = (
  service = itemsAppService,
  resolveSessionUserId = noSessionUser,
) => ({
  GET: route(service, resolveSessionUserId, ({ userId, query }) =>
    service.listTagsForItemsApp(parseTagsRequest(userId, query("workspaceId"))),
  ),
  POST: route(service, resolveSessionUserId, async ({ body }) =>
    withStatus(await service.createTagForItemsApp(parseCreateTagRequest(await body())), 201),
  ),
  PATCH: route(service, resolveSessionUserId, async ({ body }) =>
    found(
      await service.updateTagForItemsApp(parseUpdateTagRequest(await body())),
      ITEMS_APP_TAG_NOT_FOUND_ERROR,
    ),
  ),
  DELETE: route(service, resolveSessionUserId, async ({ body }) =>
    found(
      await service.deleteTagForItemsApp(parseDeleteTagRequest(await body())),
      ITEMS_APP_TAG_NOT_FOUND_ERROR,
    ),
  ),
})

export const createCategoriesRouteHandlers: Factory<"GET" | "POST" | "PATCH" | "DELETE"> = (
  service = itemsAppService,
  resolveSessionUserId = noSessionUser,
) => ({
  GET: route(service, resolveSessionUserId, ({ userId, query }) =>
    service.listCategoriesForItemsApp(parseCategoriesRequest(userId, query("workspaceId"))),
  ),
  POST: route(service, resolveSessionUserId, async ({ body }) =>
    withStatus(
      await service.createCategoryForItemsApp(parseCreateCategoryRequest(await body())),
      201,
    ),
  ),
  PATCH: route(service, resolveSessionUserId, async ({ body }) =>
    found(
      await service.updateCategoryForItemsApp(parseUpdateCategoryRequest(await body())),
      ITEMS_APP_CATEGORY_NOT_FOUND_ERROR,
    ),
  ),
  DELETE: route(service, resolveSessionUserId, async ({ body }) =>
    found(
      await service.deleteCategoryForItemsApp(parseDeleteCategoryRequest(await body())),
      ITEMS_APP_CATEGORY_NOT_FOUND_ERROR,
    ),
  ),
})

export const createSearchRouteHandlers: Factory<"POST"> = (
  service = itemsAppService,
  resolveSessionUserId = noSessionUser,
) => ({
  POST: route(service, resolveSessionUserId, async ({ body }) =>
    service.searchItemsForItemsApp(parseSearchRequest(await body())),
  ),
})

export const createEmbeddingMaintenanceRouteHandlers: Factory<"POST"> = (
  service = itemsAppService,
  resolveSessionUserId = noSessionUser,
) => ({
  POST: route(service, resolveSessionUserId, async ({ body }) =>
    service.maintainItemEmbeddingsForItemsApp(parseEmbeddingMaintenanceRequest(await body())),
  ),
})

export const createStatusesRouteHandlers: Factory<"GET" | "POST" | "PATCH" | "DELETE"> = (
  service = itemsAppService,
  resolveSessionUserId = noSessionUser,
) => ({
  GET: route(service, resolveSessionUserId, ({ userId, query }) =>
    service.listStatusesForItemsApp(parseStatusesRequest(userId, query("workspaceId"))),
  ),
  POST: route(service, resolveSessionUserId, async ({ body }) =>
    withStatus(await service.createStatusForItemsApp(parseCreateStatusRequest(await body())), 201),
  ),
  PATCH: route(service, resolveSessionUserId, async ({ body }) =>
    found(
      await service.updateStatusForItemsApp(parseUpdateStatusRequest(await body())),
      ITEMS_APP_STATUS_NOT_FOUND_ERROR,
    ),
  ),
  DELETE: route(service, resolveSessionUserId, async ({ body }) =>
    found(
      await service.deleteStatusForItemsApp(parseDeleteStatusRequest(await body())),
      ITEMS_APP_STATUS_NOT_FOUND_ERROR,
    ),
  ),
})

export const createWorkspacesRouteHandlers: Factory<"GET" | "POST" | "PATCH" | "DELETE"> = (
  service = itemsAppService,
  resolveSessionUserId = noSessionUser,
) => ({
  GET: route(service, resolveSessionUserId, ({ userId }) =>
    service.listWorkspacesForItemsApp(parseWorkspacesRequest(userId)),
  ),
  POST: route(service, resolveSessionUserId, async ({ body }) =>
    withStatus(
      await service.createWorkspaceForItemsApp(parseCreateWorkspaceRequest(await body())),
      201,
    ),
  ),
  PATCH: route(service, resolveSessionUserId, async ({ body }) =>
    found(
      await service.updateWorkspaceForItemsApp(parseUpdateWorkspaceRequest(await body())),
      ITEMS_APP_WORKSPACE_NOT_FOUND_ERROR,
    ),
  ),
  DELETE: route(service, resolveSessionUserId, async ({ body }) =>
    found(
      await service.deleteWorkspaceForItemsApp(parseDeleteWorkspaceRequest(await body())),
      ITEMS_APP_WORKSPACE_NOT_FOUND_ERROR,
    ),
  ),
})
