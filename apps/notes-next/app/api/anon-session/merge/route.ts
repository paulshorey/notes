import { NextResponse } from "next/server"
import { errorJson, errorResponse } from "../../_lib/items-app-route-handlers"
import { getVerifiedSession } from "@/auth"
import { verifyMergeToken } from "@/lib/anonymousMergeToken"
import { mergeAnonymousItemsAppSession } from "@lib/db-items/services/items-app"

export const POST = async (request: Request) => {
  let session
  try {
    session = await getVerifiedSession()
  } catch {
    return errorJson(503, "unavailable", "Notes is temporarily unavailable.")
  }

  if (!session?.user?.itemsUserId || session.user.isAnonymous) {
    return errorJson(
      401,
      "unauthenticated",
      "Must be authenticated as a real (non-anonymous) user.",
    )
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errorJson(400, "invalid_request", "Request body must be valid JSON.")
  }

  const mergeToken =
    typeof body === "object" && body !== null && "mergeToken" in body
      ? (body as { mergeToken: unknown }).mergeToken
      : undefined

  if (typeof mergeToken !== "string" || mergeToken === "") {
    return errorJson(400, "invalid_request", "mergeToken is required.")
  }

  const verified = verifyMergeToken(mergeToken)
  if (!verified) {
    return errorJson(403, "invalid_request", "Invalid or expired merge token.")
  }

  try {
    const result = await mergeAnonymousItemsAppSession({
      anonUserId: verified.anonUserId,
      realUserId: session.user.itemsUserId,
    })
    return NextResponse.json(result)
  } catch (error) {
    return errorResponse(error)
  }
}
