import { NextRequest, NextResponse } from "next/server"
import type { UserBackup } from "@lib/db-items/contracts/items-app"

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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

/**
 * A client on an earlier item contract reads several categories per item. Give it the
 * list it expects next to the current fields: every item's single category as a list
 * of zero or one, and a group preview's count of items in several categories as zero.
 */
export const withCategoryLists = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(withCategoryLists)
  if (!isRecord(value)) return value
  const result = Object.fromEntries(
    Object.entries(value).map(([key, data]) => [
      key,
      key === "preferences" ? data : withCategoryLists(data),
    ]),
  )
  if ("category" in value && "subcategory" in value && "tags" in value)
    result.categories = value.category === null ? [] : [value.category]
  if ("textItemCount" in value && "itemIds" in value) result.sharedItemCount = 0
  return result
}

/** A backup file in the flat-category shape that versions 1 and 2 use. */
export const flatCategoryBackup = (backup: UserBackup) => ({
  ...backup,
  workspaces: backup.workspaces.map((workspace) => ({
    ...workspace,
    categories: workspace.categories.map(({ label, timeCreated, timeModified }) => ({
      label,
      timeCreated,
      timeModified,
    })),
    items: workspace.items.map((item) => ({
      description: item.description,
      categories: item.category === null ? [] : [item.category],
      status: item.status,
      tags: item.tags,
      timeDue: item.timeDue,
      timeRemind: item.timeRemind,
      timeCreated: item.timeCreated,
      timeModified: item.timeModified,
    })),
  })),
})

/**
 * Contract 2 is the current item shape. Earlier contracts also get category lists, and
 * a request with no contract on a shared route also gets the note-named aliases.
 */
export const itemJson = (request: Request, value: unknown, init?: ResponseInit) => {
  const contract = request.headers.get("x-items-contract")
  const body =
    contract === "2"
      ? value
      : contract === "1" || new URL(request.url).pathname.startsWith("/api/items")
        ? withCategoryLists(value)
        : legacyNotePayload(withCategoryLists(value), true)
  const response = NextResponse.json(body, init)
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
