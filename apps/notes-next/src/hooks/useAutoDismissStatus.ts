import { useEffect } from "react"
import { STATUS_MESSAGE_TTL_MS } from "@/constants/notes"

export function useAutoDismissStatus(
  message: string | null,
  clear: () => void,
  ttlMs = STATUS_MESSAGE_TTL_MS,
) {
  useEffect(() => {
    if (!message) {
      return
    }

    const timeoutId = window.setTimeout(clear, ttlMs)
    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [message, clear, ttlMs])
}
