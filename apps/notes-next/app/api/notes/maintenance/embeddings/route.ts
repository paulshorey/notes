import { createEmbeddingMaintenanceRouteHandlers } from "../../../_lib/notes-app-route-handlers"
import { resolveSessionUserId } from "../../../_lib/authenticated-user"

export const runtime = "nodejs"
export const { POST } = createEmbeddingMaintenanceRouteHandlers(
  undefined,
  resolveSessionUserId,
)
