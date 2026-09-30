import { RequestError } from "./api"

/** Recover only a confirmed authentication failure, preserving drafts first. */
export const recoverExpiredSession = async (
  error: unknown,
  actions: {
    persistDrafts: () => void
    resetSession: () => void
    signOut: () => Promise<unknown>
  },
): Promise<boolean> => {
  if (!(error instanceof RequestError) || error.status !== 401) return false

  actions.persistDrafts()
  actions.resetSession()
  await actions.signOut()
  return true
}
