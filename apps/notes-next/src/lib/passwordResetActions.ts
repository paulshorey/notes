"use server"

import { randomUUID } from "node:crypto"
import { after } from "next/server"
import { reservePasswordReset, resetPasswordWithCode } from "@lib/db-items/sql/user"
import { readSmsConfig, sendSms, SmsError } from "./sms"

export async function requestPasswordReset(value: string) {
  const identifier = typeof value === "string" ? value.trim() : ""
  if (!identifier || identifier.length > 320 || identifier.includes("\0")) {
    return { error: "Enter a username, email, or phone number." }
  }

  let config
  try {
    config = readSmsConfig()
  } catch {
    return { error: "Password recovery is currently unavailable." }
  }

  const requestId = randomUUID()
  // Keep account lookup, throttling and provider timing out of the public response.
  after(async () => {
    try {
      const delivery = await reservePasswordReset(identifier, requestId)
      if (!delivery) return

      const username = Array.from(delivery.username.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, " "))
        .slice(0, 80)
        .join("")
      await sendSms(
        `Notes password reset\nAccount: ${username}\nRequest: ${requestId}\nCode: ${delivery.code}\nExpires in 30 min. Verify the account owner before sharing.`,
        config,
      )
    } catch (error) {
      console.error("Password reset SMS failed", error instanceof SmsError ? error.code : "service_unavailable")
    }
  })
  return { requestId }
}

export async function completePasswordReset(
  requestId: string,
  value: string,
  password: string,
  confirmation: string,
) {
  const code = typeof value === "string" ? value.trim().toLowerCase() : ""
  const invalidCode = "That reset code is invalid or has expired."
  if (
    typeof requestId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(requestId) ||
    !/^[0-9a-f]{32}$/.test(code)
  ) return { error: invalidCode }

  if (typeof password !== "string" || password.length < 8 || password.length > 1024 || password.trim() === "") {
    return { error: "Enter a password between 8 and 1,024 characters." }
  }
  if (password !== confirmation) return { error: "The passwords must match." }

  try {
    const changed = await resetPasswordWithCode(requestId, code, password)
    return changed ? { ok: true } : { error: invalidCode }
  } catch {
    console.error("Password reset could not be completed")
    return { error: "Password recovery is currently unavailable. Try again shortly." }
  }
}
