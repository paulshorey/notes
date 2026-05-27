import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { verifyMergeToken } from "@/lib/anonymousMergeToken"
import { mergeAnonymousNotesAppSession } from "@lib/db-marketing/services/notes-app"

export const POST = async (request: Request) => {
  const session = await auth()

  if (!session?.user?.notesUserId || session.user.isAnonymous) {
    return NextResponse.json(
      { error: "Must be authenticated as a real (non-anonymous) user." },
      { status: 401 },
    )
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 })
  }

  const mergeToken =
    typeof body === "object" && body !== null && "mergeToken" in body
      ? (body as { mergeToken: unknown }).mergeToken
      : undefined

  if (typeof mergeToken !== "string" || mergeToken === "") {
    return NextResponse.json({ error: "mergeToken is required." }, { status: 400 })
  }

  const verified = verifyMergeToken(mergeToken)
  if (!verified) {
    return NextResponse.json(
      { error: "Invalid or expired merge token." },
      { status: 403 },
    )
  }

  try {
    const result = await mergeAnonymousNotesAppSession({
      anonUserId: verified.anonUserId,
      realUserId: session.user.notesUserId,
    })
    return NextResponse.json(result)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Merge failed." },
      { status: 400 },
    )
  }
}
