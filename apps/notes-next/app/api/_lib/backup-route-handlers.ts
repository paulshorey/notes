import { NextResponse } from "next/server"
import {
  BackupAccountError,
  notesAppService,
  type NotesAppService,
} from "@lib/db-notes/services/notes-app"
import {
  BackupValidationError,
  parseUserBackup,
  USER_BACKUP_MAX_BYTES,
} from "@lib/db-notes/contracts/user-backup"
import { resolveRequestUserId, type SessionUserResolver } from "./notes-app-route-handlers"

class BackupTooLargeError extends Error {}
const json = (body: unknown, status = 200) =>
  NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  })
const errorResponse = (error: unknown, service: NotesAppService) => {
  if (error instanceof BackupTooLargeError) return json({ error: error.message }, 413)
  if (error instanceof BackupValidationError) return json({ error: error.message }, 400)
  if (error instanceof BackupAccountError) return json({ error: error.message }, error.status)
  const status = service.getNotesAppErrorStatus(error) === 503 ? 503 : 500
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
  service: NotesAppService = notesAppService,
  resolveSessionUserId: SessionUserResolver = async () => null,
) => ({
  GET: async (request: Request) => {
    try {
      const userId = await resolveRequestUserId(request, service, resolveSessionUserId)
      if (userId === null) return json({ error: "Authentication required." }, 401)
      const backup = await service.exportUserBackup(userId)
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
          "Content-Disposition": `attachment; filename="jot-new-backup-${backup.exportedAt.slice(0, 10)}.json"`,
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
      return json(await service.restoreUserBackup(userId, await readBackup(request)))
    } catch (error) {
      return errorResponse(error, service)
    }
  },
})
