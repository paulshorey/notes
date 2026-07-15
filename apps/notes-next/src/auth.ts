import NextAuth from "next-auth"
import Credentials from "next-auth/providers/credentials"
import { createAnonymousUser, verifyUserCredentials } from "@lib/db-notes/sql/user"
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
          notesUserId: user.id,
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
          notesUserId: user.id,
          isAnonymous: true,
        }
      },
    }),
  ],
  callbacks: {
    ...authConfig.callbacks,
    async jwt({ token, user, account }) {
      if (user?.notesUserId) {
        token.notesUserId = user.notesUserId
        token.isAnonymous = user.isAnonymous ?? false
        return token
      }

      if (account?.provider === "anonymous" && user?.id) {
        token.notesUserId = Number.parseInt(user.id, 10)
        token.isAnonymous = true
        return token
      }

      if (account?.provider === "credentials" && user?.id) {
        token.notesUserId = Number.parseInt(user.id, 10)
        token.isAnonymous = false
        return token
      }

      return token
    },
    async session({ session, token }) {
      if (session.user) {
        if (typeof token.notesUserId === "number") {
          session.user.notesUserId = token.notesUserId
        }
        session.user.isAnonymous = (token.isAnonymous as boolean | undefined) ?? false
      }

      return session
    },
  },
})
