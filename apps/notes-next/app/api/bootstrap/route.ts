import { NextResponse } from "next/server"
import { notesAppService } from "@lib/db-notes/services/notes-app"
import { resolveSessionUserId } from "../_lib/authenticated-user"
import { resolveRequestUserId } from "../_lib/notes-app-route-handlers"

export const runtime = "nodejs"

/**
 * One startup request rather than four independently authenticated requests.
 * This keeps the user, notes, categories, and tags on one coherent refresh and
 * removes an extra network round trip from every cold launch.
 */
export async function GET(request: Request) {
  const userId = await resolveRequestUserId(request, notesAppService, resolveSessionUserId)
  if (userId === null) {
    return NextResponse.json({ error: "Authentication is required." }, { status: 401 })
  }

  try {
    const [session, workspaceResult] = await Promise.all([
      notesAppService.getNotesAppSession({ userId }),
      notesAppService.listWorkspacesForNotesApp({ userId }),
    ])

    if (!session) {
      return NextResponse.json({ error: "The session is no longer valid." }, { status: 401 })
    }

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
    const [notes, categories, statuses, tags] = await Promise.all([
      notesAppService.listNotesForNotesApp({ userId, workspaceId: active.id }),
      notesAppService.listCategoriesForNotesApp({ userId, workspaceId: active.id }),
      notesAppService.listStatusesForNotesApp({ userId, workspaceId: active.id }),
      notesAppService.listTagsForNotesApp({ userId, workspaceId: active.id }),
    ])
    return NextResponse.json({
      ...session,
      ...workspaceResult,
      activeWorkspaceId: active.id,
      ...notes,
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
