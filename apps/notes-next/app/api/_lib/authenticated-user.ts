import { auth } from "@/auth"
import type { SessionUserResolver } from "./notes-app-route-handlers"

/**
 * Production resolver for cookie-based auth: maps the NextAuth JWT session to
 * the Notes user id. Lives in its own module so the route handler factories
 * (and their tests) do not import the NextAuth configuration.
 */
export const resolveSessionUserId: SessionUserResolver = async () => {
  const session = await auth()
  const notesUserId = session?.user?.notesUserId

  return typeof notesUserId === "number" ? notesUserId : null
}
