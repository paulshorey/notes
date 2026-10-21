import { legacyNoteHandler } from "../../_lib/legacy-note-contract"
import { createSearchRouteHandlers } from "../../_lib/items-app-route-handlers"
import { resolveSessionUserId } from "../../_lib/authenticated-user"

export const runtime = "nodejs"
const handlers = createSearchRouteHandlers(undefined, resolveSessionUserId)
export const POST = legacyNoteHandler(handlers.POST)
