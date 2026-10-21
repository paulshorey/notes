import { legacyNoteHandler } from "../../../_lib/legacy-note-contract"
import { createEmbeddingMaintenanceRouteHandlers } from "../../../_lib/items-app-route-handlers"
import { resolveSessionUserId } from "../../../_lib/authenticated-user"

export const runtime = "nodejs"
export const { POST } = createEmbeddingMaintenanceRouteHandlers(undefined, resolveSessionUserId)
