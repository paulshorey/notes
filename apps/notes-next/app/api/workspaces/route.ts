import { createWorkspacesRouteHandlers } from "../_lib/notes-app-route-handlers"
import { resolveSessionUserId } from "../_lib/authenticated-user"
export const runtime = "nodejs"
const handlers = createWorkspacesRouteHandlers(undefined, resolveSessionUserId)
export const { GET, POST, PATCH, DELETE } = handlers
