import type { DefaultSession } from "next-auth"

declare module "next-auth" {
  interface User {
    itemsUserId?: number
    isAnonymous?: boolean
  }

  interface Session {
    user: {
      itemsUserId?: number
      /** Compatibility for already-loaded text clients. */
      notesUserId?: number
      isAnonymous?: boolean
    } & DefaultSession["user"]
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    itemsUserId?: number
    /** Compatibility with existing encrypted cookies and older server builds. */
    notesUserId?: number
    isAnonymous?: boolean
  }
}
