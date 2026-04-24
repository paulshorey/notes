export const getErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "Unexpected request error."

export const readJson = async <T,>(response: Response) => {
  const payload = (await response.json().catch(() => null)) as
    | (T & { error?: string })
    | null

  if (!response.ok) {
    throw new Error(payload?.error ?? "Request failed.")
  }

  if (!payload) {
    throw new Error("Request returned no response body.")
  }

  return payload as T
}
