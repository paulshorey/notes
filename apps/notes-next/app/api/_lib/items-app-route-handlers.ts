import { NextRequest, NextResponse } from "next/server"
import { itemJson } from "./legacy-note-contract"
import {
  ITEMS_APP_AUTH_REQUIRED_ERROR,
  ITEMS_APP_CATEGORY_NOT_FOUND_ERROR,
  ITEMS_APP_INVALID_CREDENTIALS_ERROR,
  ITEMS_APP_TAG_NOT_FOUND_ERROR,
  ITEMS_APP_ITEM_NOT_FOUND_ERROR,
  ITEMS_APP_STATUS_NOT_FOUND_ERROR,
  ITEMS_APP_WORKSPACE_NOT_FOUND_ERROR,
  ITEMS_APP_USER_NOT_FOUND_ERROR,
  parseCategoriesRequest,
  parseCreateCategoryRequest,
  itemsAppService,
  parseDeleteCategoryRequest,
  parseTagsRequest,
  parseCreateTagRequest,
  parseDeleteTagRequest,
  parseEmbeddingMaintenanceRequest,
  parseCreateItemRequest,
  parseDeleteItemRequest,
  parseItemsRequest,
  parseSearchRequest,
  parseSessionRequest,
  parseTokenLoginRequest,
  parseUpdateUserPreferencesRequest,
  parseUpdateCategoryRequest,
  parseUpdateTagRequest,
  parseUpdateItemRequest,
  parseStatusesRequest,
  parseWorkspacesRequest,
  parseCreateStatusRequest,
  parseUpdateStatusRequest,
  parseDeleteStatusRequest,
  parseCreateWorkspaceRequest,
  parseUpdateWorkspaceRequest,
  parseDeleteWorkspaceRequest,
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

const unauthorizedResponse = () =>
  NextResponse.json({ error: ITEMS_APP_AUTH_REQUIRED_ERROR }, { status: 401 })

const readJsonObject = async (request: Request) => {
  try {
    const body = await request.json()

    if (typeof body !== "object" || body === null) {
      throw new Error("Request body must be a JSON object.")
    }

    return body as Record<string, unknown>
  } catch (error) {
    if (error instanceof Error) {
      throw error
    }

    throw new Error("Request body must be valid JSON.")
  }
}

const readAuthorizedJsonObject = async (request: Request, userId: number) => ({
  ...(await readJsonObject(request)),
  userId,
})

const toErrorResponse = (error: unknown, status = 400) =>
  NextResponse.json(
    { error: error instanceof Error ? error.message : "Unexpected server error." },
    { status },
  )

export const createAuthTokenRouteHandlers = (service: ItemsAppService = itemsAppService) => ({
  POST: async (request: Request) => {
    try {
      const result = await service.loginItemsAppUser(
        parseTokenLoginRequest(await readJsonObject(request)),
      )

      if (!result) {
        return NextResponse.json({ error: ITEMS_APP_INVALID_CREDENTIALS_ERROR }, { status: 401 })
      }

      return itemJson(request, result)
    } catch (error) {
      return toErrorResponse(error)
    }
  },
  DELETE: async (request: Request) => {
    try {
      const token = readBearerToken(request)

      if (token === null) {
        return unauthorizedResponse()
      }

      await service.revokeItemsAppToken({ token })
      return NextResponse.json({ ok: true })
    } catch (error) {
      return toErrorResponse(error)
    }
  },
})

export const createSessionRouteHandlers = (
  service: ItemsAppService = itemsAppService,
  resolveSessionUserId: SessionUserResolver = noSessionUser,
) => ({
  GET: async (request: NextRequest) => {
    try {
      const userId = await resolveRequestUserId(request, service, resolveSessionUserId)

      if (userId === null) {
        return unauthorizedResponse()
      }

      const result = await service.getItemsAppSession(parseSessionRequest(userId))

      if (!result) {
        return NextResponse.json({ error: ITEMS_APP_USER_NOT_FOUND_ERROR }, { status: 404 })
      }

      return itemJson(request, result)
    } catch (error) {
      return toErrorResponse(error)
    }
  },
  PATCH: async (request: Request) => {
    try {
      const userId = await resolveRequestUserId(request, service, resolveSessionUserId)

      if (userId === null) {
        return unauthorizedResponse()
      }

      const result = await service.updateItemsAppUserPreferences(
        parseUpdateUserPreferencesRequest(await readAuthorizedJsonObject(request, userId)),
      )

      if (!result) {
        return NextResponse.json({ error: ITEMS_APP_USER_NOT_FOUND_ERROR }, { status: 404 })
      }

      return itemJson(request, result)
    } catch (error) {
      return toErrorResponse(error)
    }
  },
})

export const createItemsRouteHandlers = (
  service: ItemsAppService = itemsAppService,
  resolveSessionUserId: SessionUserResolver = noSessionUser,
) => ({
  GET: async (request: NextRequest) => {
    try {
      const userId = await resolveRequestUserId(request, service, resolveSessionUserId)

      if (userId === null) {
        return unauthorizedResponse()
      }

      const result = await service.listItemsForItemsApp(
        parseItemsRequest(userId, request.nextUrl.searchParams.get("workspaceId")),
      )
      return itemJson(request, result)
    } catch (error) {
      return toErrorResponse(error)
    }
  },
  POST: async (request: Request) => {
    try {
      const userId = await resolveRequestUserId(request, service, resolveSessionUserId)

      if (userId === null) {
        return unauthorizedResponse()
      }

      const result = await service.createItemForItemsApp(
        parseCreateItemRequest(await readAuthorizedJsonObject(request, userId)),
      )
      return itemJson(request, result, { status: 201 })
    } catch (error) {
      return toErrorResponse(error, service.getItemsAppErrorStatus(error))
    }
  },
  PATCH: async (request: Request) => {
    try {
      const userId = await resolveRequestUserId(request, service, resolveSessionUserId)

      if (userId === null) {
        return unauthorizedResponse()
      }

      const result = await service.updateItemForItemsApp(
        parseUpdateItemRequest(await readAuthorizedJsonObject(request, userId)),
      )

      if (!result) {
        return NextResponse.json({ error: ITEMS_APP_ITEM_NOT_FOUND_ERROR }, { status: 404 })
      }

      return itemJson(request, result)
    } catch (error) {
      return toErrorResponse(error, service.getItemsAppErrorStatus(error))
    }
  },
  DELETE: async (request: Request) => {
    try {
      const userId = await resolveRequestUserId(request, service, resolveSessionUserId)

      if (userId === null) {
        return unauthorizedResponse()
      }

      const result = await service.deleteItemForItemsApp(
        parseDeleteItemRequest(await readAuthorizedJsonObject(request, userId)),
      )

      if (!result) {
        return NextResponse.json({ error: ITEMS_APP_ITEM_NOT_FOUND_ERROR }, { status: 404 })
      }

      return itemJson(request, result)
    } catch (error) {
      return toErrorResponse(error)
    }
  },
})

export const createTagsRouteHandlers = (
  service: ItemsAppService = itemsAppService,
  resolveSessionUserId: SessionUserResolver = noSessionUser,
) => ({
  GET: async (request: NextRequest) => {
    try {
      const userId = await resolveRequestUserId(request, service, resolveSessionUserId)

      if (userId === null) {
        return unauthorizedResponse()
      }

      const result = await service.listTagsForItemsApp(
        parseTagsRequest(userId, request.nextUrl.searchParams.get("workspaceId")),
      )
      return itemJson(request, result)
    } catch (error) {
      return toErrorResponse(error)
    }
  },
  POST: async (request: Request) => {
    try {
      const userId = await resolveRequestUserId(request, service, resolveSessionUserId)

      if (userId === null) {
        return unauthorizedResponse()
      }

      const result = await service.createTagForItemsApp(
        parseCreateTagRequest(await readAuthorizedJsonObject(request, userId)),
      )
      return itemJson(request, result, { status: 201 })
    } catch (error) {
      return toErrorResponse(error, service.getItemsAppErrorStatus(error))
    }
  },
  PATCH: async (request: Request) => {
    try {
      const userId = await resolveRequestUserId(request, service, resolveSessionUserId)

      if (userId === null) {
        return unauthorizedResponse()
      }

      const result = await service.updateTagForItemsApp(
        parseUpdateTagRequest(await readAuthorizedJsonObject(request, userId)),
      )

      if (!result) {
        return NextResponse.json({ error: ITEMS_APP_TAG_NOT_FOUND_ERROR }, { status: 404 })
      }

      return itemJson(request, result)
    } catch (error) {
      return toErrorResponse(error, service.getItemsAppErrorStatus(error))
    }
  },
  DELETE: async (request: Request) => {
    try {
      const userId = await resolveRequestUserId(request, service, resolveSessionUserId)

      if (userId === null) {
        return unauthorizedResponse()
      }

      const result = await service.deleteTagForItemsApp(
        parseDeleteTagRequest(await readAuthorizedJsonObject(request, userId)),
      )

      if (!result) {
        return NextResponse.json({ error: ITEMS_APP_TAG_NOT_FOUND_ERROR }, { status: 404 })
      }

      return itemJson(request, result)
    } catch (error) {
      return toErrorResponse(error)
    }
  },
})

export const createCategoriesRouteHandlers = (
  service: ItemsAppService = itemsAppService,
  resolveSessionUserId: SessionUserResolver = noSessionUser,
) => ({
  GET: async (request: NextRequest) => {
    try {
      const userId = await resolveRequestUserId(request, service, resolveSessionUserId)

      if (userId === null) {
        return unauthorizedResponse()
      }

      const result = await service.listCategoriesForItemsApp(
        parseCategoriesRequest(userId, request.nextUrl.searchParams.get("workspaceId")),
      )
      return itemJson(request, result)
    } catch (error) {
      return toErrorResponse(error)
    }
  },
  POST: async (request: Request) => {
    try {
      const userId = await resolveRequestUserId(request, service, resolveSessionUserId)

      if (userId === null) {
        return unauthorizedResponse()
      }

      const result = await service.createCategoryForItemsApp(
        parseCreateCategoryRequest(await readAuthorizedJsonObject(request, userId)),
      )
      return itemJson(request, result, { status: 201 })
    } catch (error) {
      return toErrorResponse(error, service.getItemsAppErrorStatus(error))
    }
  },
  PATCH: async (request: Request) => {
    try {
      const userId = await resolveRequestUserId(request, service, resolveSessionUserId)

      if (userId === null) {
        return unauthorizedResponse()
      }

      const result = await service.updateCategoryForItemsApp(
        parseUpdateCategoryRequest(await readAuthorizedJsonObject(request, userId)),
      )

      if (!result) {
        return NextResponse.json({ error: ITEMS_APP_CATEGORY_NOT_FOUND_ERROR }, { status: 404 })
      }

      return itemJson(request, result)
    } catch (error) {
      return toErrorResponse(error, service.getItemsAppErrorStatus(error))
    }
  },
  DELETE: async (request: Request) => {
    try {
      const userId = await resolveRequestUserId(request, service, resolveSessionUserId)

      if (userId === null) {
        return unauthorizedResponse()
      }

      const result = await service.deleteCategoryForItemsApp(
        parseDeleteCategoryRequest(await readAuthorizedJsonObject(request, userId)),
      )

      if (!result) {
        return NextResponse.json({ error: ITEMS_APP_CATEGORY_NOT_FOUND_ERROR }, { status: 404 })
      }

      return itemJson(request, result)
    } catch (error) {
      return toErrorResponse(error)
    }
  },
})

export const createSearchRouteHandlers = (
  service: ItemsAppService = itemsAppService,
  resolveSessionUserId: SessionUserResolver = noSessionUser,
) => ({
  POST: async (request: Request) => {
    try {
      const userId = await resolveRequestUserId(request, service, resolveSessionUserId)

      if (userId === null) {
        return unauthorizedResponse()
      }

      const result = await service.searchItemsForItemsApp(
        parseSearchRequest(await readAuthorizedJsonObject(request, userId)),
      )
      return itemJson(request, result)
    } catch (error) {
      return toErrorResponse(error, service.getItemsAppErrorStatus(error))
    }
  },
})

export const createEmbeddingMaintenanceRouteHandlers = (
  service: ItemsAppService = itemsAppService,
  resolveSessionUserId: SessionUserResolver = noSessionUser,
) => ({
  POST: async (request: Request) => {
    try {
      const userId = await resolveRequestUserId(request, service, resolveSessionUserId)

      if (userId === null) {
        return unauthorizedResponse()
      }

      const result = await service.maintainItemEmbeddingsForItemsApp(
        parseEmbeddingMaintenanceRequest(await readAuthorizedJsonObject(request, userId)),
      )
      return itemJson(request, result)
    } catch (error) {
      return toErrorResponse(error, service.getItemsAppErrorStatus(error))
    }
  },
})

export const createStatusesRouteHandlers = (
  service: ItemsAppService = itemsAppService,
  resolveSessionUserId: SessionUserResolver = noSessionUser,
) => ({
  GET: async (request: NextRequest) => {
    try {
      const userId = await resolveRequestUserId(request, service, resolveSessionUserId)
      if (userId === null) return unauthorizedResponse()
      return NextResponse.json(
        await service.listStatusesForItemsApp(
          parseStatusesRequest(userId, request.nextUrl.searchParams.get("workspaceId")),
        ),
      )
    } catch (error) {
      return toErrorResponse(error)
    }
  },
  POST: async (request: Request) => {
    try {
      const userId = await resolveRequestUserId(request, service, resolveSessionUserId)
      if (userId === null) return unauthorizedResponse()
      return NextResponse.json(
        await service.createStatusForItemsApp(
          parseCreateStatusRequest(await readAuthorizedJsonObject(request, userId)),
        ),
        { status: 201 },
      )
    } catch (error) {
      return toErrorResponse(error, service.getItemsAppErrorStatus(error))
    }
  },
  PATCH: async (request: Request) => {
    try {
      const userId = await resolveRequestUserId(request, service, resolveSessionUserId)
      if (userId === null) return unauthorizedResponse()
      const result = await service.updateStatusForItemsApp(
        parseUpdateStatusRequest(await readAuthorizedJsonObject(request, userId)),
      )
      return result
        ? itemJson(request, result)
        : NextResponse.json({ error: ITEMS_APP_STATUS_NOT_FOUND_ERROR }, { status: 404 })
    } catch (error) {
      return toErrorResponse(error, service.getItemsAppErrorStatus(error))
    }
  },
  DELETE: async (request: Request) => {
    try {
      const userId = await resolveRequestUserId(request, service, resolveSessionUserId)
      if (userId === null) return unauthorizedResponse()
      const result = await service.deleteStatusForItemsApp(
        parseDeleteStatusRequest(await readAuthorizedJsonObject(request, userId)),
      )
      return result
        ? itemJson(request, result)
        : NextResponse.json({ error: ITEMS_APP_STATUS_NOT_FOUND_ERROR }, { status: 404 })
    } catch (error) {
      return toErrorResponse(error)
    }
  },
})

export const createWorkspacesRouteHandlers = (
  service: ItemsAppService = itemsAppService,
  resolveSessionUserId: SessionUserResolver = noSessionUser,
) => ({
  GET: async (request: NextRequest) => {
    try {
      const userId = await resolveRequestUserId(request, service, resolveSessionUserId)
      if (userId === null) return unauthorizedResponse()
      return NextResponse.json(
        await service.listWorkspacesForItemsApp(parseWorkspacesRequest(userId)),
      )
    } catch (error) {
      return toErrorResponse(error)
    }
  },
  POST: async (request: Request) => {
    try {
      const userId = await resolveRequestUserId(request, service, resolveSessionUserId)
      if (userId === null) return unauthorizedResponse()
      return NextResponse.json(
        await service.createWorkspaceForItemsApp(
          parseCreateWorkspaceRequest(await readAuthorizedJsonObject(request, userId)),
        ),
        { status: 201 },
      )
    } catch (error) {
      return toErrorResponse(error, service.getItemsAppErrorStatus(error))
    }
  },
  PATCH: async (request: Request) => {
    try {
      const userId = await resolveRequestUserId(request, service, resolveSessionUserId)
      if (userId === null) return unauthorizedResponse()
      const result = await service.updateWorkspaceForItemsApp(
        parseUpdateWorkspaceRequest(await readAuthorizedJsonObject(request, userId)),
      )
      return result
        ? itemJson(request, result)
        : NextResponse.json({ error: ITEMS_APP_WORKSPACE_NOT_FOUND_ERROR }, { status: 404 })
    } catch (error) {
      return toErrorResponse(error)
    }
  },
  DELETE: async (request: Request) => {
    try {
      const userId = await resolveRequestUserId(request, service, resolveSessionUserId)
      if (userId === null) return unauthorizedResponse()
      const result = await service.deleteWorkspaceForItemsApp(
        parseDeleteWorkspaceRequest(await readAuthorizedJsonObject(request, userId)),
      )
      return result
        ? itemJson(request, result)
        : NextResponse.json({ error: ITEMS_APP_WORKSPACE_NOT_FOUND_ERROR }, { status: 404 })
    } catch (error) {
      return toErrorResponse(error)
    }
  },
})
