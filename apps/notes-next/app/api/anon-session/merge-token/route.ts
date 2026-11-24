import { NextResponse } from "next/server"
import { errorJson } from "../../_lib/items-app-route-handlers"
import { getVerifiedSession } from "@/auth"
import { createMergeToken } from "@/lib/anonymousMergeToken"

export const POST = async () => {
  let session
  try {
    session = await getVerifiedSession()
  } catch {
    return errorJson(503, "unavailable", "Notes is temporarily unavailable.")
  }

  if (!session?.user?.itemsUserId || !session.user.isAnonymous) {
    return errorJson(401, "unauthenticated", "Must be authenticated as an anonymous user.")
  }

  const mergeToken = createMergeToken(session.user.itemsUserId)
  return NextResponse.json({ mergeToken })
}
