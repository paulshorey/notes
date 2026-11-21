import type { UserV1Row } from "../../generated/typescript/db-types"
import { getDb } from "../../lib/db/postgres"
import { hashPassword, isHashedPassword, verifyPassword } from "./password"
import type { UserPreferences, UserSummary } from "./types"

const userSelect = `
  SELECT id, username, email, phone, preferences
  FROM public.user_v1
`

const userSelectWithPassword = `
  SELECT id, username, email, phone, preferences, password, credential_version
  FROM public.user_v1
`

const toUserPreferences = (value: unknown): UserPreferences => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {}
  }

  return value as UserPreferences
}

const mapUser = (row: UserV1Row): UserSummary => ({
  id: row.id,
  username: row.username,
  email: row.email,
  phone: row.phone,
  preferences: toUserPreferences(row.preferences),
})

type UserV1RowWithPassword = UserV1Row & { password: string | null }

const byIdentifier = `
  WHERE (lower(username) = lower($1)
    OR lower(email) = lower($1)
    OR ($2 <> '' AND regexp_replace(coalesce(phone, ''), '\\D', '', 'g') = $2))
    AND is_anonymous = false
  ORDER BY id ASC
  LIMIT 1
`

function identifierParams(identifier: string) {
  const trimmed = identifier.trim()
  if (trimmed === "") throw new Error("Username, email, or phone is required.")
  return [trimmed, trimmed.replace(/\D/g, "")]
}

export const findUserCredentials = async (identifier: string) => {
  const { rows } = await getDb().query<UserV1RowWithPassword>(
    `${userSelectWithPassword} ${byIdentifier}`,
    identifierParams(identifier),
  )
  return rows[0] ?? null
}

export const verifyUserCredentials = async (identifier: string, password: string) => {
  if (password === "") throw new Error("Password is required.")

  const row = await findUserCredentials(identifier)
  if (!row || !verifyPassword(password, row.password)) return null

  // Only upgrade the legacy value if a password reset hasn't superseded it.
  if (row.password !== null && !isHashedPassword(row.password)) {
    try {
      await getDb().query(
        `UPDATE public.user_v1 SET password = $2 WHERE id = $1 AND password = $3 AND credential_version = $4`,
        [row.id, hashPassword(password), row.password, row.credential_version],
      )
    } catch {
      // A failed legacy upgrade does not prevent sign-in.
    }
  }

  return { user: mapUser(row), credentialVersion: row.credential_version }
}

export const findUserByIdentifier = async (identifier: string) => {
  const { rows } = await getDb().query<UserV1Row>(
    `${userSelect} ${byIdentifier}`,
    identifierParams(identifier),
  )
  return rows[0] ? mapUser(rows[0]) : null
}

export const isCurrentCredentialVersion = async (userId: number, version: number) => {
  const result = await getDb().query(
    `SELECT 1 FROM public.user_v1 WHERE id = $1 AND credential_version = $2`,
    [userId, version],
  )
  return result.rowCount === 1
}

export const getUserById = async (userId: number) => {
  const { rows } = await getDb().query<UserV1Row>(
    `
      ${userSelect}
      WHERE id = $1
      LIMIT 1
    `,
    [userId],
  )

  return rows[0] ? mapUser(rows[0]) : null
}

export const updateUserPreferencesById = async (userId: number, preferences: UserPreferences) => {
  const { rows } = await getDb().query<UserV1Row>(
    `
      UPDATE public.user_v1
      SET preferences = $2::jsonb
      WHERE id = $1
      RETURNING id, username, email, phone, preferences
    `,
    [userId, JSON.stringify(preferences)],
  )

  return rows[0] ? mapUser(rows[0]) : null
}
