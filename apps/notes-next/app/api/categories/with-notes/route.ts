import { createDeleteCategoryWithNotesRouteHandlers } from "../../_lib/notes-app-route-handlers"

export const runtime = "nodejs"
export const { DELETE } = createDeleteCategoryWithNotesRouteHandlers()
