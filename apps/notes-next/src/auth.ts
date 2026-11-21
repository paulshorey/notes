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
      if (user?.itemsUserId) {
        token.itemsUserId = user.itemsUserId
        token.notesUserId = user.itemsUserId
        token.isAnonymous = user.isAnonymous ?? false
        token.credentialVersion = user.credentialVersion ?? 0
        return token
      }

      const existingId = readItemsUserId(token)
      if (existingId !== null) {
        const credentialVersion = typeof token.credentialVersion === "number" ? token.credentialVersion : 0
        if (!(await isCurrentCredentialVersion(existingId, credentialVersion))) return null
        token.itemsUserId = existingId
        token.notesUserId = existingId
      }
      return token
    },
    async session({ session, token }) {
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
