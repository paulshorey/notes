import { NextResponse } from "next/server"
import { notesAppService } from "@lib/db-notes/services/notes-app"
import { resolveSessionUserId } from "../_lib/authenticated-user"

export const runtime = "nodejs"

/**
 * One startup request rather than four independently authenticated requests.
 * This keeps the user, notes, taxonomy, and tags on one coherent refresh and
 * removes an extra network round trip from every cold launch.
 */
export async function GET() {
  const userId = await resolveSessionUserId()
  if (userId === null) {
    return NextResponse.json({ error: "Authentication is required." }, { status: 401 })
  }

  try {
    const [session, notes, taxonomy, tags] = await Promise.all([
      notesAppService.getNotesAppSession({ userId }),
      notesAppService.listNotesForNotesApp({ userId }),
      notesAppService.listTaxonomyForNotesApp({ userId }),
      notesAppService.listTagsForNotesApp({ userId }),
    ])

    if (!session) {
      return NextResponse.json({ error: "The session is no longer valid." }, { status: 401 })
    }

    return NextResponse.json({
      ...session,
      ...notes,
      ...taxonomy,
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
