import NextAuth from "next-auth"
import Credentials from "next-auth/providers/credentials"
import { readItemsUserId } from "./lib/sessionIdentity"
import { createAnonymousUser, isCurrentCredentialVersion, verifyUserCredentials } from "@lib/db-items/sql/user"
import { authConfig } from "./auth.config"

export const { auth, handlers, signIn, signOut } = NextAuth({
  ...authConfig,
  session: { strategy: "jwt" },
  providers: [
    Credentials({
      id: "credentials",
      credentials: {
        identifier: { label: "Username, email, or phone", type: "text" },
        password: { label: "Password", type: "password" },
      },
      authorize: async (credentials) => {
        const identifier = credentials?.identifier
        const password = credentials?.password

        if (typeof identifier !== "string" || typeof password !== "string") {
          return null
        }

        const verified = await verifyUserCredentials(identifier, password)

        if (!verified) {
          return null
        }

        const { user, credentialVersion } = verified
        return {
          credentialVersion,
          id: String(user.id),
          name: user.username,
          email: user.email,
          itemsUserId: user.id,
          isAnonymous: false,
        }
      },
    }),
    Credentials({
      id: "anonymous",
      name: "Anonymous",
      credentials: {},
      authorize: async () => {
        const user = await createAnonymousUser()
        return {
          id: String(user.id),
          name: user.username,
          itemsUserId: user.id,
          isAnonymous: true,
        }
      },
    }),
  ],
  callbacks: {
    ...authConfig.callbacks,
    async jwt({ token, user }) {
      delete token.credentialCheckUnavailable
      if (user?.itemsUserId) {
        token.itemsUserId = user.itemsUserId
        token.notesUserId = user.itemsUserId
        token.isAnonymous = user.isAnonymous ?? false
        token.credentialVersion = user.credentialVersion ?? 0
        return token
      }

      const existingId = readItemsUserId(token)
      if (existingId !== null) {
        const version = typeof token.credentialVersion === "number" ? token.credentialVersion : 0
        try {
          if (!(await isCurrentCredentialVersion(existingId, version))) return null
        } catch {
          // Throwing here would make Auth.js treat the cookie as invalid and remove it.
          token.credentialCheckUnavailable = true
        }
        token.itemsUserId = existingId
        token.notesUserId = existingId
      }
      return token
    },
    async session({ session, token }) {
      if (token.credentialCheckUnavailable === true) session.credentialCheckUnavailable = true
      if (session.user) {
        const userId = readItemsUserId(token)
        if (userId !== null) {
          session.user.itemsUserId = userId
          session.user.notesUserId = userId
        }
        session.user.isAnonymous = (token.isAnonymous as boolean | undefined) ?? false
      }

      return session
    },
  },
})

/** Cookie identity cannot authorize API access until its credentials are verified. */
export async function getVerifiedSession() {
  const session = await auth()
  if (session?.credentialCheckUnavailable) {
    // Use the connection exception class recognized by the API error mapper.
    throw Object.assign(new Error("The database is unavailable. Please retry."), { code: "08000" })
  }
  return session
}
