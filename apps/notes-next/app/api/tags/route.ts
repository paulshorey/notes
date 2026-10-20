import { createTagsRouteHandlers } from "../_lib/items-app-route-handlers"
import { resolveSessionUserId } from "../_lib/authenticated-user"

export const runtime = "nodejs"
export const { GET, POST, PATCH, DELETE } = createTagsRouteHandlers(undefined, resolveSessionUserId)
