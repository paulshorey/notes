import { createJournalRouteHandlers } from "../../_lib/items-app-route-handlers"
import { resolveSessionUserId } from "../../_lib/authenticated-user"

export const runtime = "nodejs"
export const { POST } = createJournalRouteHandlers(undefined, resolveSessionUserId)
