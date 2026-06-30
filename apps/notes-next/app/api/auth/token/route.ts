import { createAuthTokenRouteHandlers } from "../../_lib/notes-app-route-handlers"

export const runtime = "nodejs"
export const { POST, DELETE } = createAuthTokenRouteHandlers()
