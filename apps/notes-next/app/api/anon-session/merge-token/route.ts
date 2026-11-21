import { NextResponse } from "next/server"
import { getVerifiedSession } from "@/auth"
import { createMergeToken } from "@/lib/anonymousMergeToken"

export const POST = async () => {
  let session
  try {
    session = await getVerifiedSession()
  } catch {
    return NextResponse.json({ error: "Notes is temporarily unavailable." }, { status: 503 })
  }

  if (!session?.user?.itemsUserId || !session.user.isAnonymous) {
    return NextResponse.json(
      { error: "Must be authenticated as an anonymous user." },
      { status: 400 },
    )
  }

  const mergeToken = createMergeToken(session.user.itemsUserId)
  return NextResponse.json({ mergeToken })
}
