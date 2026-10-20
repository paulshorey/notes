import { createItemsRouteHandlers } from "../_lib/items-app-route-handlers"
import { legacyNoteHandler } from "../_lib/legacy-note-contract"
import { resolveSessionUserId } from "../_lib/authenticated-user"

export const runtime = "nodejs"
const handlers = createItemsRouteHandlers(undefined, resolveSessionUserId)
export const GET = legacyNoteHandler(handlers.GET)
export const POST = legacyNoteHandler(handlers.POST)
export const PATCH = legacyNoteHandler(handlers.PATCH)
export const DELETE = legacyNoteHandler(handlers.DELETE)
