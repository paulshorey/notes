import { NextRequest } from "next/server"
import type { ItemsAppService } from "@lib/db-items/services/items-app"
import {
  registerItemsApiAdapterSuite,
  type ItemsApiAdapter,
} from "@lib/db-items/testing/items-api-adapter-suite"
import {
  createAuthTokenRouteHandlers,
  createCategoriesRouteHandlers,
  createTagsRouteHandlers,
  createEmbeddingMaintenanceRouteHandlers,
  createItemsRouteHandlers,
  createSearchRouteHandlers,
  createSessionRouteHandlers,
  createStatusesRouteHandlers,
  createWorkspacesRouteHandlers,
} from "../app/api/_lib/items-app-route-handlers"

const readResponseBody = async (response: Response) => {
  const text = await response.text()
  return text === "" ? null : JSON.parse(text)
}

const createNextAdapter = (service: ItemsAppService): ItemsApiAdapter => {
  const authTokenHandlers = createAuthTokenRouteHandlers(service)
  const sessionHandlers = createSessionRouteHandlers(service)
  const itemsHandlers = createItemsRouteHandlers(service)
  const categoriesHandlers = createCategoriesRouteHandlers(service)
  const tagsHandlers = createTagsRouteHandlers(service)
  const statusesHandlers = createStatusesRouteHandlers(service)
  const workspacesHandlers = createWorkspacesRouteHandlers(service)
  const searchHandlers = createSearchRouteHandlers(service)
  const embeddingMaintenanceHandlers = createEmbeddingMaintenanceRouteHandlers(service)

  return {
    request: async ({ body, headers, method, path }) => {
      const url = new URL(path, "http://notes.test")
      const requestInit: RequestInit = {
        body: body == null ? undefined : JSON.stringify(body),
        headers: {
          "Content-Type": "application/json",
          "X-Items-Contract": "1",
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
      } else if (url.pathname === "/api/items") {
        if (method === "GET") {
          response = await itemsHandlers.GET(new NextRequest(url, getRequestInit))
        } else if (method === "POST") {
          response = await itemsHandlers.POST(new Request(url, requestInit))
        } else if (method === "PATCH") {
          response = await itemsHandlers.PATCH(new Request(url, requestInit))
        } else {
          response = await itemsHandlers.DELETE(new Request(url, requestInit))
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
      } else if (url.pathname === "/api/categories") {
        if (method === "GET") {
          response = await categoriesHandlers.GET(new NextRequest(url, getRequestInit))
        } else if (method === "POST") {
          response = await categoriesHandlers.POST(new Request(url, requestInit))
        } else if (method === "PATCH") {
          response = await categoriesHandlers.PATCH(new Request(url, requestInit))
        } else if (method === "DELETE") {
          response = await categoriesHandlers.DELETE(new Request(url, requestInit))
        } else {
          throw new Error(`Unhandled test route: ${method} ${url.pathname}`)
        }
      } else if (url.pathname === "/api/statuses") {
        if (method === "GET") {
          response = await statusesHandlers.GET(new NextRequest(url, getRequestInit))
        } else if (method === "POST") {
          response = await statusesHandlers.POST(new Request(url, requestInit))
        } else if (method === "PATCH") {
          response = await statusesHandlers.PATCH(new Request(url, requestInit))
        } else {
          response = await statusesHandlers.DELETE(new Request(url, requestInit))
        }
      } else if (url.pathname === "/api/workspaces") {
        if (method === "GET") {
          response = await workspacesHandlers.GET(new NextRequest(url, getRequestInit))
        } else if (method === "POST") {
          response = await workspacesHandlers.POST(new Request(url, requestInit))
        } else if (method === "PATCH") {
          response = await workspacesHandlers.PATCH(new Request(url, requestInit))
        } else {
          response = await workspacesHandlers.DELETE(new Request(url, requestInit))
        }
      } else if (url.pathname === "/api/items/search" && method === "POST") {
        response = await searchHandlers.POST(new Request(url, requestInit))
      } else if (url.pathname === "/api/items/maintenance/embeddings" && method === "POST") {
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

registerItemsApiAdapterSuite("notes-next", createNextAdapter)
