import { createDeleteCategoryWithNotesRouteHandlers } from "../../_lib/notes-app-route-handlers"
import { resolveSessionUserId } from "../../_lib/authenticated-user"

export const runtime = "nodejs"
export const { DELETE } = createDeleteCategoryWithNotesRouteHandlers(
  undefined,
  resolveSessionUserId,
)
