import NextAuth from "next-auth"
import Credentials from "next-auth/providers/credentials"
import Facebook from "next-auth/providers/facebook"
import GitHub from "next-auth/providers/github"
import Google from "next-auth/providers/google"
import LinkedIn from "next-auth/providers/linkedin"
import { findUserByIdentifier, verifyUserCredentials } from "@lib/db-marketing/sql/user"
import { authConfig } from "./auth.config"

const socialProviders = [
  ...(process.env.AUTH_GOOGLE_ID ? [Google] : []),
  ...(process.env.AUTH_GITHUB_ID ? [GitHub] : []),
  ...(process.env.AUTH_LINKEDIN_ID ? [LinkedIn] : []),
  ...(process.env.AUTH_FACEBOOK_ID ? [Facebook] : []),
]

const resolveNotesUserId = async (email: string | null | undefined) => {
  if (!email) {
    return null
  }

  const user = await findUserByIdentifier(email)
  return user?.id ?? null
}

export const { auth, handlers, signIn, signOut } = NextAuth({
  ...authConfig,
  session: { strategy: "jwt" },
  providers: [
    ...socialProviders,
    Credentials({
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
        }
      },
    }),
  ],
  callbacks: {
    ...authConfig.callbacks,
    async signIn({ account, profile }) {
      if (account?.provider === "credentials") {
        return true
      }

      const email =
        typeof profile?.email === "string"
          ? profile.email
          : typeof (profile as { email?: string } | null)?.email === "string"
            ? (profile as { email: string }).email
            : null

      const notesUserId = await resolveNotesUserId(email)
      return notesUserId !== null
    },
    async jwt({ token, user, account, profile }) {
      if (user?.notesUserId) {
        token.notesUserId = user.notesUserId
        return token
      }

      if (account?.provider === "credentials" && user?.id) {
        token.notesUserId = Number.parseInt(user.id, 10)
        return token
      }

      if (account && account.provider !== "credentials" && !token.notesUserId) {
        const email =
          typeof profile?.email === "string"
            ? profile.email
            : typeof token.email === "string"
              ? token.email
              : null
        const notesUserId = await resolveNotesUserId(email)

        if (notesUserId) {
          token.notesUserId = notesUserId
        }
      }

      return token
    },
    async session({ session, token }) {
      if (session.user && typeof token.notesUserId === "number") {
        session.user.notesUserId = token.notesUserId
      }

      return session
    },
  },
})
