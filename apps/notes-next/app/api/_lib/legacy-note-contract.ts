import { NextRequest, NextResponse } from "next/server"

const legacyKeys: Record<string, string> = {
  item: "note",
  items: "notes",
  itemId: "noteId",
  itemCount: "noteCount",
  itemsImported: "notesImported",
  itemsSkipped: "notesSkipped",
}

/** Compatibility is a transport concern. Never transform authored values/preferences. */
export const legacyNotePayload = (value: unknown, aliases = false): unknown => {
  if (Array.isArray(value)) return value.map((entry) => legacyNotePayload(entry, aliases))
  if (typeof value !== "object" || value === null) return value
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, data]) => {
      const transformed = key === "preferences" ? data : legacyNotePayload(data, aliases)
      const legacy = legacyKeys[key]
      return legacy
        ? aliases
          ? [
              [key, transformed],
              [legacy, transformed],
            ]
          : [[legacy, transformed]]
        : [[key, transformed]]
    }),
  )
}

/** Common routes retain old browser payloads; the new client requests the item contract. */
export const itemJson = (request: Request, value: unknown, init?: ResponseInit) => {
  const canonical =
    request.headers.get("x-items-contract") === "1" ||
    new URL(request.url).pathname.startsWith("/api/items")
  const response = NextResponse.json(canonical ? value : legacyNotePayload(value, true), init)
  response.headers.append("Vary", "X-Items-Contract")
  return response
}

export const legacyNoteHandler =
  <T extends Request>(handler: (request: T) => Promise<Response>) =>
  async (request: T): Promise<Response> => {
    let translated: Request = request
    if (["POST", "PATCH", "DELETE"].includes(request.method)) {
      try {
        const body: unknown = await request.clone().json()
        if (typeof body === "object" && body !== null && !Array.isArray(body)) {
          const { note, noteId, ...rest } = body as Record<string, unknown>
          const headers = new Headers(request.headers)
          headers.delete("content-length")
          translated = new NextRequest(request.url, {
            method: request.method,
            headers,
            body: JSON.stringify({
              ...rest,
              ...(note !== undefined ? { item: note } : {}),
              ...(noteId !== undefined ? { itemId: noteId } : {}),
            }),
          })
        }
      } catch {
        // The canonical handler still authenticates before parsing malformed input.
      }
    }
    const response = await handler(translated as T)
    const payload: unknown = await response.json()
    return NextResponse.json(legacyNotePayload(payload), {
      status: response.status,
      headers: response.headers,
    })
  }
