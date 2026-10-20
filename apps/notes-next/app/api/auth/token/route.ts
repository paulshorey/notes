import { createAuthTokenRouteHandlers } from "../../_lib/items-app-route-handlers"

export const runtime = "nodejs"
export const { POST, DELETE } = createAuthTokenRouteHandlers()
