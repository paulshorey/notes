import NextAuth from "next-auth"
import Credentials from "next-auth/providers/credentials"
import { readItemsUserId } from "./lib/sessionIdentity"
import { createAnonymousUser, verifyUserCredentials } from "@lib/db-items/sql/user"
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

        const user = await verifyUserCredentials(identifier, password)

        if (!user) {
          return null
        }

        return {
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
    async jwt({ token, user, account }) {
      if (user?.itemsUserId) {
        token.itemsUserId = user.itemsUserId
        token.notesUserId = user.itemsUserId
        token.isAnonymous = user.isAnonymous ?? false
        return token
      }

      if (account?.provider === "anonymous" && user?.id) {
        token.itemsUserId = Number.parseInt(user.id, 10)
        token.notesUserId = token.itemsUserId
        token.isAnonymous = true
        return token
      }

      if (account?.provider === "credentials" && user?.id) {
        token.itemsUserId = Number.parseInt(user.id, 10)
        token.notesUserId = token.itemsUserId
        token.isAnonymous = false
        return token
      }

      const existingId = readItemsUserId(token)
      if (existingId !== null) {
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
