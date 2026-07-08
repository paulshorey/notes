import { NextResponse } from "next/server"
import { auth } from "@/auth"
import {
  claimAnonymousNotesAppSession,
  getNotesAppErrorStatus,
  parseClaimAnonymousSessionRequest,
} from "@lib/db-marketing/services/notes-app"

export const POST = async (request: Request) => {
  const session = await auth()

  if (!session?.user?.notesUserId || !session.user.isAnonymous) {
    return NextResponse.json(
      { error: "Must be authenticated as an anonymous user." },
      { status: 401 },
    )
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 })
  }

  try {
    const claimRequest = parseClaimAnonymousSessionRequest(body)
    const result = await claimAnonymousNotesAppSession({
      anonUserId: session.user.notesUserId,
      ...claimRequest,
    })
    return NextResponse.json(result)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Claim failed." },
      { status: getNotesAppErrorStatus(error) },
    )
  }
}
