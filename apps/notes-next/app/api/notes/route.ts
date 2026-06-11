import { createNotesRouteHandlers } from "../_lib/notes-app-route-handlers"
import { resolveSessionUserId } from "../_lib/authenticated-user"

export const runtime = "nodejs"
export const { GET, POST, PATCH, DELETE } = createNotesRouteHandlers(
  undefined,
  resolveSessionUserId,
)
