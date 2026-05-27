import { createHmac } from "node:crypto"

const MERGE_TOKEN_TTL_MS = 10 * 60 * 1000 // 10 minutes

interface MergeTokenPayload {
  purpose: "anonymous-merge"
  anonUserId: number
  exp: number
}

function getSecret(): string {
  const secret = process.env.AUTH_SECRET
  if (!secret) {
    throw new Error("AUTH_SECRET is not configured.")
  }
  return secret
}

function sign(payload: MergeTokenPayload): string {
  const json = JSON.stringify(payload)
  const encoded = Buffer.from(json).toString("base64url")
  const hmac = createHmac("sha256", getSecret()).update(encoded).digest("base64url")
  return `${encoded}.${hmac}`
}

function verify(token: string): MergeTokenPayload | null {
  const parts = token.split(".")
  if (parts.length !== 2) return null

  const encoded = parts[0]
  const providedHmac = parts[1]
  if (!encoded || !providedHmac) return null

  const expectedHmac = createHmac("sha256", getSecret()).update(encoded).digest("base64url")

  if (providedHmac !== expectedHmac) return null

  try {
    const json = Buffer.from(encoded, "base64url").toString("utf-8")
    const payload = JSON.parse(json) as unknown

    if (
      typeof payload !== "object" ||
      payload === null ||
      (payload as MergeTokenPayload).purpose !== "anonymous-merge" ||
      typeof (payload as MergeTokenPayload).anonUserId !== "number" ||
      typeof (payload as MergeTokenPayload).exp !== "number"
    ) {
      return null
    }

    const typed = payload as MergeTokenPayload

    if (Date.now() > typed.exp) {
      return null
    }

    return typed
  } catch {
    return null
  }
}

export function createMergeToken(anonUserId: number): string {
  const payload: MergeTokenPayload = {
    purpose: "anonymous-merge",
    anonUserId,
    exp: Date.now() + MERGE_TOKEN_TTL_MS,
  }
  return sign(payload)
}

export function verifyMergeToken(token: string): { anonUserId: number } | null {
  const payload = verify(token)
  if (!payload) return null
  return { anonUserId: payload.anonUserId }
}
