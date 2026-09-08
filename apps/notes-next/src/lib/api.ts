export const getErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "Unexpected request error."

export class RequestError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = "RequestError"
    this.status = status
  }
}

export const fetchWithTimeout = async (
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = 10_000,
) => {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  try {
    return await fetch(input, { ...init, signal: controller.signal })
  } catch (error) {
    if (controller.signal.aborted) {
      throw new RequestError("Notes took too long to respond. Check the connection and retry.", 408)
    }
    throw error
  } finally {
    clearTimeout(timeoutId)
  }
}

export const readJson = async <T,>(response: Response) => {
  const payload = (await response.json().catch(() => null)) as
    | (T & { error?: string })
    | null

  if (!response.ok) {
    throw new RequestError(payload?.error ?? "Request failed.", response.status)
  }

  if (!payload) {
    throw new Error("Request returned no response body.")
  }

  return payload as T
}
