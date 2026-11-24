import { NextResponse } from "next/server"
import { errorJson, errorResponse } from "../../_lib/items-app-route-handlers"
import { getVerifiedSession } from "@/auth"
import {
  claimAnonymousItemsAppSession,
  parseClaimAnonymousSessionRequest,
} from "@lib/db-items/services/items-app"

export const POST = async (request: Request) => {
  let session
  try {
    session = await getVerifiedSession()
  } catch {
    return errorJson(503, "unavailable", "Notes is temporarily unavailable.")
  }

  if (!session?.user?.itemsUserId || !session.user.isAnonymous) {
    return errorJson(401, "unauthenticated", "Must be authenticated as an anonymous user.")
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errorJson(400, "invalid_request", "Request body must be valid JSON.")
  }

  try {
    const claimRequest = parseClaimAnonymousSessionRequest(body)
    const result = await claimAnonymousItemsAppSession({
      anonUserId: session.user.itemsUserId,
      ...claimRequest,
    })
    return NextResponse.json(result)
  } catch (error) {
    return errorResponse(error)
  }
}
