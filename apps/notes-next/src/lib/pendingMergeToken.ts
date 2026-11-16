// A signed, short-lived token captured while the browser is still an anonymous
// session. It is stashed here across the sign-in transition (including an OAuth
// redirect) so the single post-login loader can merge the anonymous account.
const PENDING_MERGE_TOKEN_KEY = "notes-pending-merge-token"

export const readPendingMergeToken = (): string | null => {
  if (typeof window === "undefined") return null
  try {
    return window.sessionStorage.getItem(PENDING_MERGE_TOKEN_KEY)
  } catch {
    return null
  }
}

export const writePendingMergeToken = (token: string): void => {
  if (typeof window === "undefined") return
  try {
    window.sessionStorage.setItem(PENDING_MERGE_TOKEN_KEY, token)
  } catch {
    // Best-effort; if sessionStorage is unavailable the merge is simply skipped.
  }
}

export const clearPendingMergeToken = (): void => {
  if (typeof window === "undefined") return
  try {
    window.sessionStorage.removeItem(PENDING_MERGE_TOKEN_KEY)
  } catch {
    // ignore
  }
}
