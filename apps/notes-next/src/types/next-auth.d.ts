import type { DefaultSession } from "next-auth"

declare module "next-auth" {
  interface User {
    notesUserId?: number
    isAnonymous?: boolean
  }

  interface Session {
    user: {
      notesUserId?: number
      isAnonymous?: boolean
    } & DefaultSession["user"]
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    notesUserId?: number
    isAnonymous?: boolean
  }
}
