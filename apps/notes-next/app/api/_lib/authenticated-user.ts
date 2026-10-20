import { auth } from "@/auth"
import type { SessionUserResolver } from "./items-app-route-handlers"

/**
 * Production resolver for cookie-based auth: maps the NextAuth JWT session to
 * the Notes user id. Lives in its own module so the route handler factories
 * (and their tests) do not import the NextAuth configuration.
 */
export const resolveSessionUserId: SessionUserResolver = async () => {
  const session = await auth()
  const itemsUserId = session?.user?.itemsUserId

  return typeof itemsUserId === "number" ? itemsUserId : null
}
