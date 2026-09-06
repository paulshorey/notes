import { NextRequest } from "next/server"
import type { NotesAppService } from "@lib/db-notes/services/notes-app"
import {
  registerNotesApiAdapterSuite,
  type NotesApiAdapter,
} from "@lib/db-notes/testing/notes-api-adapter-suite"
import {
  createAuthTokenRouteHandlers,
  createTaxonomyRouteHandlers,
  createTaxonomyLevelsRouteHandlers,
  createTaxonomyPathRouteHandlers,
  createTaxonomySuggestRouteHandlers,
  createTagsRouteHandlers,
  createEmbeddingMaintenanceRouteHandlers,
  createNotesRouteHandlers,
  createSearchRouteHandlers,
  createSessionRouteHandlers,
} from "../app/api/_lib/notes-app-route-handlers"

const readResponseBody = async (response: Response) => {
  const text = await response.text()
  return text === "" ? null : JSON.parse(text)
}

const createNextAdapter = (service: NotesAppService): NotesApiAdapter => {
  const authTokenHandlers = createAuthTokenRouteHandlers(service)
  const sessionHandlers = createSessionRouteHandlers(service)
  const notesHandlers = createNotesRouteHandlers(service)
  const taxonomyHandlers = createTaxonomyRouteHandlers(service)
  const taxonomyLevelsHandlers = createTaxonomyLevelsRouteHandlers(service)
  const taxonomyPathHandlers = createTaxonomyPathRouteHandlers(service)
  const taxonomySuggestHandlers = createTaxonomySuggestRouteHandlers(service)
  const tagsHandlers = createTagsRouteHandlers(service)
  const searchHandlers = createSearchRouteHandlers(service)
  const embeddingMaintenanceHandlers = createEmbeddingMaintenanceRouteHandlers(service)

  return {
    request: async ({ body, headers, method, path }) => {
      const url = new URL(path, "http://notes.test")
      const requestInit: RequestInit = {
        body: body == null ? undefined : JSON.stringify(body),
        headers: {
          "Content-Type": "application/json",
          ...headers,
        },
        method,
      }

      const getRequestInit = { method, headers: requestInit.headers }

      let response: Response

      if (url.pathname === "/api/auth/token") {
        response =
          method === "POST"
            ? await authTokenHandlers.POST(new Request(url, requestInit))
            : await authTokenHandlers.DELETE(new Request(url, requestInit))
      } else if (url.pathname === "/api/session") {
        response =
          method === "GET"
            ? await sessionHandlers.GET(new NextRequest(url, getRequestInit))
            : await sessionHandlers.PATCH(new Request(url, requestInit))
      } else if (url.pathname === "/api/notes") {
        if (method === "GET") {
          response = await notesHandlers.GET(new NextRequest(url, getRequestInit))
        } else if (method === "POST") {
          response = await notesHandlers.POST(new Request(url, requestInit))
        } else if (method === "PATCH") {
          response = await notesHandlers.PATCH(new Request(url, requestInit))
        } else {
          response = await notesHandlers.DELETE(new Request(url, requestInit))
        }
      } else if (url.pathname === "/api/tags") {
        if (method === "GET") {
          response = await tagsHandlers.GET(new NextRequest(url, getRequestInit))
        } else if (method === "POST") {
          response = await tagsHandlers.POST(new Request(url, requestInit))
        } else if (method === "PATCH") {
          response = await tagsHandlers.PATCH(new Request(url, requestInit))
        } else if (method === "DELETE") {
          response = await tagsHandlers.DELETE(new Request(url, requestInit))
        } else {
          throw new Error(`Unhandled test route: ${method} ${url.pathname}`)
        }
      } else if (url.pathname === "/api/taxonomy") {
        if (method === "GET") {
          response = await taxonomyHandlers.GET(new NextRequest(url, getRequestInit))
        } else if (method === "POST") {
          response = await taxonomyHandlers.POST(new Request(url, requestInit))
        } else if (method === "PATCH") {
          response = await taxonomyHandlers.PATCH(new Request(url, requestInit))
        } else if (method === "DELETE") {
          response = await taxonomyHandlers.DELETE(new Request(url, requestInit))
        } else {
          throw new Error(`Unhandled test route: ${method} ${url.pathname}`)
        }
      } else if (url.pathname === "/api/taxonomy/levels") {
        if (method === "GET") {
          response = await taxonomyLevelsHandlers.GET(new NextRequest(url, getRequestInit))
        } else if (method === "PATCH") {
          response = await taxonomyLevelsHandlers.PATCH(new Request(url, requestInit))
        } else {
          throw new Error(`Unhandled test route: ${method} ${url.pathname}`)
        }
      } else if (url.pathname === "/api/taxonomy/path" && method === "POST") {
        response = await taxonomyPathHandlers.POST(new Request(url, requestInit))
      } else if (url.pathname === "/api/taxonomy/suggest" && method === "POST") {
        response = await taxonomySuggestHandlers.POST(new Request(url, requestInit))
      } else if (url.pathname === "/api/notes/search" && method === "POST") {
        response = await searchHandlers.POST(new Request(url, requestInit))
      } else if (url.pathname === "/api/notes/maintenance/embeddings" && method === "POST") {
        response = await embeddingMaintenanceHandlers.POST(new Request(url, requestInit))
      } else {
        throw new Error(`Unhandled test route: ${method} ${url.pathname}`)
      }

      return {
        body: await readResponseBody(response),
        status: response.status,
      }
    },
  }
}

registerNotesApiAdapterSuite("notes-next", createNextAdapter)
