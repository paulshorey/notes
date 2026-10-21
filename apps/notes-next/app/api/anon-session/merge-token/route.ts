import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { createMergeToken } from "@/lib/anonymousMergeToken"

export const POST = async () => {
  const session = await auth()

  if (!session?.user?.itemsUserId || !session.user.isAnonymous) {
    return NextResponse.json(
      { error: "Must be authenticated as an anonymous user." },
      { status: 400 },
    )
  }

  const mergeToken = createMergeToken(session.user.itemsUserId)
  return NextResponse.json({ mergeToken })
}
