import { createBackupRouteHandlers } from "../_lib/backup-route-handlers"
import { resolveSessionUserId } from "../_lib/authenticated-user"

export const runtime = "nodejs"
export const { GET, POST } = createBackupRouteHandlers(undefined, resolveSessionUserId)
