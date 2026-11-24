import { NextResponse } from "next/server"
import { readItemTarget } from "@/lib/itemsUrlSelection"
import { itemsAppService, type ItemsAppService } from "@lib/db-items/services/items-app"
import {
  errorJson,
  resolveRequestUserId,
  type SessionUserResolver,
} from "./items-app-route-handlers"

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
        return errorJson(401, "unauthenticated", "Authentication is required.")
      }

      // A signed cookie can outlive its user. Validate before workspace loading,
      // which may insert a default workspace and requires an existing user.
      const session = await service.getItemsAppSession({ userId })

      if (!session) {
        return errorJson(401, "unauthenticated", "The session is no longer valid.")
      }

      const workspaceResult = await service.listWorkspacesForItemsApp({ userId })
      const params = new URL(request.url).searchParams
      const requested = Number.parseInt(params.get("workspaceId") ?? "", 10)
      const { hasItemTarget, itemUid, itemId } = readItemTarget(params)
      const unavailable = () => errorJson(404, "not_found", "This item is unavailable.")
      const target = itemUid ?? itemId
      const linkedWorkspace =
        target !== null ? await service.findItemWorkspaceForItemsApp({ userId, target }) : null
      if (hasItemTarget && !workspaceResult.workspaces.some((w) => w.id === linkedWorkspace))
        return unavailable()
      const preferred = session.user.preferences.notesApp?.currentWorkspaceId
      const active =
        workspaceResult.workspaces.find((w) => w.id === linkedWorkspace) ??
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
      if (
        hasItemTarget &&
        !items.items.some((item) => (itemUid !== null ? item.uid === itemUid : item.id === itemId))
      )
        return unavailable()
      return NextResponse.json(
        {
          ...session,
          ...workspaceResult,
          activeWorkspaceId: active.id,
          ...items,
          ...categories,
          ...statuses,
          ...tags,
        },
        { headers: { "Cache-Control": "no-store" } },
      )
    } catch (error) {
      console.error("Notes bootstrap failed:", error)
      return NextResponse.json(
        {
          error: "Notes is temporarily unavailable.",
          code: "unavailable",
          retryable: true,
        },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      )
    }
  }
