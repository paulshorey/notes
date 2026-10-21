import { NextResponse } from "next/server"
import { itemJson, legacyNotePayload } from "./legacy-note-contract"
import {
  BackupAccountError,
  itemsAppService,
  type ItemsAppService,
} from "@lib/db-items/services/items-app"
import {
  BackupValidationError,
  parseUserBackup,
  USER_BACKUP_MAX_BYTES,
} from "@lib/db-items/contracts/user-backup"
import { resolveRequestUserId, type SessionUserResolver } from "./items-app-route-handlers"

class BackupTooLargeError extends Error {}
const json = (body: unknown, status = 200) =>
  NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  })
const errorResponse = (error: unknown, service: ItemsAppService) => {
  if (error instanceof BackupTooLargeError) return json({ error: error.message }, 413)
  if (error instanceof BackupValidationError) return json({ error: error.message }, 400)
  if (error instanceof BackupAccountError) return json({ error: error.message }, error.status)
  const status = service.getItemsAppErrorStatus(error) === 503 ? 503 : 500
  // Do not expose SQL, table names, connection details, or uploaded text.
  return json(
    {
      error:
        status === 503
          ? "The database is unavailable. Please retry."
          : "Unable to complete the backup operation. Please retry.",
    },
    status,
  )
}

/** Count actual streamed bytes; Content-Length alone is not a trustworthy limit. */
const readBackup = async (request: Request) => {
  const tooLarge = () => new BackupTooLargeError("Backup files must be 50 MB or smaller.")
  if (Number(request.headers.get("content-length")) > USER_BACKUP_MAX_BYTES) throw tooLarge()
  if (!request.body) throw new BackupValidationError("Choose a JSON backup file.")
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > USER_BACKUP_MAX_BYTES) {
        await reader.cancel()
        throw tooLarge()
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  let value: unknown
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)))
  } catch {
    throw new BackupValidationError("The selected file is not valid JSON.")
  }
  return parseUserBackup(value)
}

export const createBackupRouteHandlers = (
  service: ItemsAppService = itemsAppService,
  resolveSessionUserId: SessionUserResolver = async () => null,
) => ({
  GET: async (request: Request) => {
    try {
      const userId = await resolveRequestUserId(request, service, resolveSessionUserId)
      if (userId === null) return json({ error: "Authentication required." }, 401)
      const exported = await service.exportUserBackup(userId)
      const backup =
        request.headers.get("x-items-contract") === "1"
          ? exported
          : { ...(legacyNotePayload(exported) as Record<string, unknown>), version: 1 }
      const body = JSON.stringify(backup)
      // Never download a file that this restore endpoint cannot accept.
      if (Buffer.byteLength(body) > USER_BACKUP_MAX_BYTES)
        throw new BackupTooLargeError(
          "Your backup exceeds the current 50 MB limit. Please contact support.",
        )
      parseUserBackup(backup)
      return new Response(body, {
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Content-Disposition": `attachment; filename="jot-new-backup-${exported.exportedAt.slice(0, 10)}.json"`,
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        },
      })
    } catch (error) {
      return errorResponse(error, service)
    }
  },
  POST: async (request: Request) => {
    try {
      const userId = await resolveRequestUserId(request, service, resolveSessionUserId)
      if (userId === null) return json({ error: "Authentication required." }, 401)
      if (
        request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !==
        "application/json"
      ) {
        return json({ error: "Upload the backup as application/json." }, 415)
      }
      return itemJson(request, await service.restoreUserBackup(userId, await readBackup(request)), {
        headers: { "Cache-Control": "no-store" },
      })
    } catch (error) {
      return errorResponse(error, service)
    }
  },
})
