import { NextRequest, NextResponse } from "next/server"
import {
  NOTES_APP_AUTH_REQUIRED_ERROR,
  NOTES_APP_TAXONOMY_NOT_FOUND_ERROR,
  NOTES_APP_INVALID_CREDENTIALS_ERROR,
  NOTES_APP_TAG_NOT_FOUND_ERROR,
  NOTES_APP_NOTE_NOT_FOUND_ERROR,
  NOTES_APP_USER_NOT_FOUND_ERROR,
  parseTaxonomyRequest,
  parseCreateTaxonomyRequest,
  parseTaxonomyPathRequest,
  parseTaxonomySuggestRequest,
  parseUpdateTaxonomyLevelRequest,
  notesAppService,
  parseDeleteTaxonomyRequest,
  parseTagsRequest,
  parseCreateTagRequest,
  parseDeleteTagRequest,
  parseEmbeddingMaintenanceRequest,
  parseCreateNoteRequest,
  parseDeleteNoteRequest,
  parseNotesRequest,
  parseSearchRequest,
  parseSessionRequest,
  parseTokenLoginRequest,
  parseUpdateUserPreferencesRequest,
  parseUpdateTaxonomyRequest,
  parseUpdateTagRequest,
  parseUpdateNoteRequest,
  type NotesAppService,
} from "@lib/db-notes/services/notes-app"

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
 * own userId: a bearer token (Android) or the NextAuth session cookie (web)
 * is the only source of identity. Returns null when unauthenticated.
 */
const resolveRequestUserId = async (
  request: Request,
  service: NotesAppService,
  resolveSessionUserId: SessionUserResolver,
): Promise<number | null> => {
  const token = readBearerToken(request)

  if (token !== null) {
    return service.getNotesAppUserIdForToken({ token })
  }

  return resolveSessionUserId()
}

const unauthorizedResponse = () =>
  NextResponse.json({ error: NOTES_APP_AUTH_REQUIRED_ERROR }, { status: 401 })

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

export const createAuthTokenRouteHandlers = (service: NotesAppService = notesAppService) => ({
  POST: async (request: Request) => {
    try {
      const result = await service.loginNotesAppUser(
        parseTokenLoginRequest(await readJsonObject(request)),
      )

      if (!result) {
        return NextResponse.json({ error: NOTES_APP_INVALID_CREDENTIALS_ERROR }, { status: 401 })
      }

      return NextResponse.json(result)
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

      await service.revokeNotesAppToken({ token })
      return NextResponse.json({ ok: true })
    } catch (error) {
      return toErrorResponse(error)
    }
  },
})

export const createSessionRouteHandlers = (
  service: NotesAppService = notesAppService,
  resolveSessionUserId: SessionUserResolver = noSessionUser,
) => ({
  GET: async (request: NextRequest) => {
    try {
      const userId = await resolveRequestUserId(request, service, resolveSessionUserId)

      if (userId === null) {
        return unauthorizedResponse()
      }

      const result = await service.getNotesAppSession(parseSessionRequest(userId))

      if (!result) {
        return NextResponse.json({ error: NOTES_APP_USER_NOT_FOUND_ERROR }, { status: 404 })
      }

      return NextResponse.json(result)
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

      const result = await service.updateNotesAppUserPreferences(
        parseUpdateUserPreferencesRequest(await readAuthorizedJsonObject(request, userId)),
      )

      if (!result) {
        return NextResponse.json({ error: NOTES_APP_USER_NOT_FOUND_ERROR }, { status: 404 })
      }

      return NextResponse.json(result)
    } catch (error) {
      return toErrorResponse(error)
    }
  },
})

export const createNotesRouteHandlers = (
  service: NotesAppService = notesAppService,
  resolveSessionUserId: SessionUserResolver = noSessionUser,
) => ({
  GET: async (request: NextRequest) => {
    try {
      const userId = await resolveRequestUserId(request, service, resolveSessionUserId)

      if (userId === null) {
        return unauthorizedResponse()
      }

      const result = await service.listNotesForNotesApp(parseNotesRequest(userId))
      return NextResponse.json(result)
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

      const result = await service.createNoteForNotesApp(
        parseCreateNoteRequest(await readAuthorizedJsonObject(request, userId)),
      )
      return NextResponse.json(result, { status: 201 })
    } catch (error) {
      return toErrorResponse(error, service.getNotesAppErrorStatus(error))
    }
  },
  PATCH: async (request: Request) => {
    try {
      const userId = await resolveRequestUserId(request, service, resolveSessionUserId)

      if (userId === null) {
        return unauthorizedResponse()
      }

      const result = await service.updateNoteForNotesApp(
        parseUpdateNoteRequest(await readAuthorizedJsonObject(request, userId)),
      )

      if (!result) {
        return NextResponse.json({ error: NOTES_APP_NOTE_NOT_FOUND_ERROR }, { status: 404 })
      }

      return NextResponse.json(result)
    } catch (error) {
      return toErrorResponse(error, service.getNotesAppErrorStatus(error))
    }
  },
  DELETE: async (request: Request) => {
    try {
      const userId = await resolveRequestUserId(request, service, resolveSessionUserId)

      if (userId === null) {
        return unauthorizedResponse()
      }

      const result = await service.deleteNoteForNotesApp(
        parseDeleteNoteRequest(await readAuthorizedJsonObject(request, userId)),
      )

      if (!result) {
        return NextResponse.json({ error: NOTES_APP_NOTE_NOT_FOUND_ERROR }, { status: 404 })
      }

      return NextResponse.json(result)
    } catch (error) {
      return toErrorResponse(error)
    }
  },
})

export const createTagsRouteHandlers = (
  service: NotesAppService = notesAppService,
  resolveSessionUserId: SessionUserResolver = noSessionUser,
) => ({
  GET: async (request: NextRequest) => {
    try {
      const userId = await resolveRequestUserId(request, service, resolveSessionUserId)

      if (userId === null) {
        return unauthorizedResponse()
      }

      const result = await service.listTagsForNotesApp(parseTagsRequest(userId))
      return NextResponse.json(result)
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

      const result = await service.createTagForNotesApp(
        parseCreateTagRequest(await readAuthorizedJsonObject(request, userId)),
      )
      return NextResponse.json(result, { status: 201 })
    } catch (error) {
      return toErrorResponse(error, service.getNotesAppErrorStatus(error))
    }
  },
  PATCH: async (request: Request) => {
    try {
      const userId = await resolveRequestUserId(request, service, resolveSessionUserId)

      if (userId === null) {
        return unauthorizedResponse()
      }

      const result = await service.updateTagForNotesApp(
        parseUpdateTagRequest(await readAuthorizedJsonObject(request, userId)),
      )

      if (!result) {
        return NextResponse.json({ error: NOTES_APP_TAG_NOT_FOUND_ERROR }, { status: 404 })
      }

      return NextResponse.json(result)
    } catch (error) {
      return toErrorResponse(error, service.getNotesAppErrorStatus(error))
    }
  },
  DELETE: async (request: Request) => {
    try {
      const userId = await resolveRequestUserId(request, service, resolveSessionUserId)

      if (userId === null) {
        return unauthorizedResponse()
      }

      const result = await service.deleteTagForNotesApp(
        parseDeleteTagRequest(await readAuthorizedJsonObject(request, userId)),
      )

      if (!result) {
        return NextResponse.json({ error: NOTES_APP_TAG_NOT_FOUND_ERROR }, { status: 404 })
      }

      return NextResponse.json(result)
    } catch (error) {
      return toErrorResponse(error)
    }
  },
})

export const createTaxonomyRouteHandlers = (
  service: NotesAppService = notesAppService,
  resolveSessionUserId: SessionUserResolver = noSessionUser,
) => ({
  GET: async (request: NextRequest) => {
    try {
      const userId = await resolveRequestUserId(request, service, resolveSessionUserId)

      if (userId === null) {
        return unauthorizedResponse()
      }

      const result = await service.listTaxonomyForNotesApp(parseTaxonomyRequest(userId))
      return NextResponse.json(result)
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

      const result = await service.createTaxonomyForNotesApp(
        parseCreateTaxonomyRequest(await readAuthorizedJsonObject(request, userId)),
      )
      return NextResponse.json(result, { status: 201 })
    } catch (error) {
      return toErrorResponse(error, service.getNotesAppErrorStatus(error))
    }
  },
  PATCH: async (request: Request) => {
    try {
      const userId = await resolveRequestUserId(request, service, resolveSessionUserId)

      if (userId === null) {
        return unauthorizedResponse()
      }

      const result = await service.updateTaxonomyForNotesApp(
        parseUpdateTaxonomyRequest(await readAuthorizedJsonObject(request, userId)),
      )

      if (!result) {
        return NextResponse.json({ error: NOTES_APP_TAXONOMY_NOT_FOUND_ERROR }, { status: 404 })
      }

      return NextResponse.json(result)
    } catch (error) {
      return toErrorResponse(error, service.getNotesAppErrorStatus(error))
    }
  },
  DELETE: async (request: Request) => {
    try {
      const userId = await resolveRequestUserId(request, service, resolveSessionUserId)

      if (userId === null) {
        return unauthorizedResponse()
      }

      const result = await service.deleteTaxonomyForNotesApp(
        parseDeleteTaxonomyRequest(await readAuthorizedJsonObject(request, userId)),
      )

      if (!result) {
        return NextResponse.json({ error: NOTES_APP_TAXONOMY_NOT_FOUND_ERROR }, { status: 404 })
      }

      return NextResponse.json(result)
    } catch (error) {
      return toErrorResponse(error, service.getNotesAppErrorStatus(error))
    }
  },
})

export const createTaxonomyLevelsRouteHandlers = (
  service: NotesAppService = notesAppService,
  resolveSessionUserId: SessionUserResolver = noSessionUser,
) => ({
  GET: async (request: NextRequest) => {
    try {
      const userId = await resolveRequestUserId(request, service, resolveSessionUserId)

      if (userId === null) {
        return unauthorizedResponse()
      }

      const result = await service.listTaxonomyLevelsForNotesApp(parseTaxonomyRequest(userId))
      return NextResponse.json(result)
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

      const result = await service.updateTaxonomyLevelForNotesApp(
        parseUpdateTaxonomyLevelRequest(await readAuthorizedJsonObject(request, userId)),
      )

      if (!result) {
        return NextResponse.json({ error: NOTES_APP_TAXONOMY_NOT_FOUND_ERROR }, { status: 404 })
      }

      return NextResponse.json(result)
    } catch (error) {
      return toErrorResponse(error, service.getNotesAppErrorStatus(error))
    }
  },
})

/** One transaction, so a half-created chain cannot be left behind. */
export const createTaxonomyPathRouteHandlers = (
  service: NotesAppService = notesAppService,
  resolveSessionUserId: SessionUserResolver = noSessionUser,
) => ({
  POST: async (request: Request) => {
    try {
      const userId = await resolveRequestUserId(request, service, resolveSessionUserId)

      if (userId === null) {
        return unauthorizedResponse()
      }

      const result = await service.resolveTaxonomyPathForNotesApp(
        parseTaxonomyPathRequest(await readAuthorizedJsonObject(request, userId)),
      )
      return NextResponse.json(result)
    } catch (error) {
      return toErrorResponse(error, service.getNotesAppErrorStatus(error))
    }
  },
})

export const createTaxonomySuggestRouteHandlers = (
  service: NotesAppService = notesAppService,
  resolveSessionUserId: SessionUserResolver = noSessionUser,
) => ({
  POST: async (request: Request) => {
    try {
      const userId = await resolveRequestUserId(request, service, resolveSessionUserId)

      if (userId === null) {
        return unauthorizedResponse()
      }

      const result = await service.suggestTaxonomyForNotesApp(
        parseTaxonomySuggestRequest(await readAuthorizedJsonObject(request, userId)),
      )
      return NextResponse.json(result)
    } catch (error) {
      return toErrorResponse(error, service.getNotesAppErrorStatus(error))
    }
  },
})

export const createSearchRouteHandlers = (
  service: NotesAppService = notesAppService,
  resolveSessionUserId: SessionUserResolver = noSessionUser,
) => ({
  POST: async (request: Request) => {
    try {
      const userId = await resolveRequestUserId(request, service, resolveSessionUserId)

      if (userId === null) {
        return unauthorizedResponse()
      }

      const result = await service.searchNotesForNotesApp(
        parseSearchRequest(await readAuthorizedJsonObject(request, userId)),
      )
      return NextResponse.json(result)
    } catch (error) {
      return toErrorResponse(error, service.getNotesAppErrorStatus(error))
    }
  },
})

export const createEmbeddingMaintenanceRouteHandlers = (
  service: NotesAppService = notesAppService,
  resolveSessionUserId: SessionUserResolver = noSessionUser,
) => ({
  POST: async (request: Request) => {
    try {
      const userId = await resolveRequestUserId(request, service, resolveSessionUserId)

      if (userId === null) {
        return unauthorizedResponse()
      }

      const result = await service.maintainNoteEmbeddingsForNotesApp(
        parseEmbeddingMaintenanceRequest(await readAuthorizedJsonObject(request, userId)),
      )
      return NextResponse.json(result)
    } catch (error) {
      return toErrorResponse(error, service.getNotesAppErrorStatus(error))
    }
  },
})
