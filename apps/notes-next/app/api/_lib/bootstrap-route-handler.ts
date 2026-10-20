import { NextResponse } from "next/server"
import { itemJson } from "./legacy-note-contract"
import { itemsAppService, type ItemsAppService } from "@lib/db-items/services/items-app"
import { resolveRequestUserId, type SessionUserResolver } from "./items-app-route-handlers"

/**
 * One startup request rather than four independently authenticated requests.
 * This keeps the user, notes, categories, and tags on one coherent refresh and
 * removes an extra network round trip from every cold launch.
 */
export const createBootstrapRouteHandler =
  (
    service: ItemsAppService = itemsAppService,
    resolveSessionUserId: SessionUserResolver = async () => null,
  ) =>
  async (request: Request) => {
    try {
      const userId = await resolveRequestUserId(request, service, resolveSessionUserId)
      if (userId === null) {
        return NextResponse.json({ error: "Authentication is required." }, { status: 401 })
      }

      // A signed cookie can outlive its user. Validate before workspace loading,
      // which may insert a default workspace and requires an existing user.
      const session = await service.getItemsAppSession({ userId })

      if (!session) {
        return NextResponse.json({ error: "The session is no longer valid." }, { status: 401 })
      }

      const workspaceResult = await service.listWorkspacesForItemsApp({ userId })
      const requested = Number.parseInt(
        new URL(request.url).searchParams.get("workspaceId") ?? "",
        10,
      )
      const preferred = session.user.preferences.notesApp?.currentWorkspaceId
      const active =
        workspaceResult.workspaces.find((w) => w.id === requested) ??
        workspaceResult.workspaces.find((w) => w.id === preferred) ??
        workspaceResult.workspaces[0]
      if (!active) throw new Error("No workspace is available.")
      const [items, categories, statuses, tags] = await Promise.all([
        service.listItemsForItemsApp({ userId, workspaceId: active.id }),
        service.listCategoriesForItemsApp({ userId, workspaceId: active.id }),
        service.listStatusesForItemsApp({ userId, workspaceId: active.id }),
        service.listTagsForItemsApp({ userId, workspaceId: active.id }),
      ])
      return itemJson(request, {
        ...session,
        ...workspaceResult,
        activeWorkspaceId: active.id,
        ...items,
        ...categories,
        ...statuses,
        ...tags,
      })
    } catch (error) {
      console.error("Notes bootstrap failed:", error)
      return NextResponse.json(
        {
          error: "Notes is temporarily unavailable.",
          code: "STARTUP_UNAVAILABLE",
          retryable: true,
        },
        { status: 503 },
      )
    }
  }
