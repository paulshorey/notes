import { createBootstrapRouteHandler } from "../_lib/bootstrap-route-handler"
import { resolveSessionUserId } from "../_lib/authenticated-user"

export const runtime = "nodejs"

export const GET = createBootstrapRouteHandler(undefined, resolveSessionUserId)
