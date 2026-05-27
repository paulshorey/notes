import type { NextAuthConfig } from "next-auth"

export const authConfig = {
  pages: {
    signIn: "/",
  },
  providers: [],
  callbacks: {
    authorized() {
      return true
    },
  },
} satisfies NextAuthConfig
