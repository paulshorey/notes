import type { DefaultSession } from "next-auth"

declare module "next-auth" {
  interface User {
    itemsUserId?: number
    credentialVersion?: number
    isAnonymous?: boolean
  }

  interface Session {
    credentialCheckUnavailable?: true
    user: {
      itemsUserId?: number
      isAnonymous?: boolean
    } & DefaultSession["user"]
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    credentialCheckUnavailable?: true
    credentialVersion?: number
    itemsUserId?: number
    /** The name a session cookie issued before `itemsUserId` holds the user id under. */
    notesUserId?: number
    isAnonymous?: boolean
  }
}
