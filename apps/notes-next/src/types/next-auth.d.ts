import type { DefaultSession } from "next-auth"

declare module "next-auth" {
  interface User {
    notesUserId?: number
  }

  interface Session {
    user: {
      notesUserId: number
    } & DefaultSession["user"]
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    notesUserId?: number
  }
}
