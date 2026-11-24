import { createHash, randomBytes } from "node:crypto"
import { getDb } from "../../lib/db/postgres"

// Only a SHA-256 hash of the token is stored, so a database leak does not
// expose usable credentials. The plaintext token is returned to the client
// exactly once at login.
const hashApiToken = (token: string) => createHash("sha256").update(token).digest("hex")

export const createApiTokenForUser = async (userId: number, credentialVersion: number) => {
  const token = `nta_${randomBytes(32).toString("base64url")}`

  const inserted = await getDb().query(
    `
      INSERT INTO public.user_api_token_v1 (user_id, token_hash)
      SELECT id, $2::text FROM public.user_v1
      WHERE id = $1 AND credential_version = $3
      FOR UPDATE
    `,
    [userId, hashApiToken(token), credentialVersion],
  )

  return inserted.rowCount === 1 ? token : null
}

export const findUserIdByApiToken = async (token: string) => {
  const { rows } = await getDb().query<{ user_id: number }>(
    `
      UPDATE public.user_api_token_v1
      SET time_last_used = CURRENT_TIMESTAMP
      WHERE token_hash = $1
      RETURNING user_id
    `,
    [hashApiToken(token)],
  )

  return rows[0]?.user_id ?? null
}

export const deleteApiToken = async (token: string) => {
  const result = await getDb().query(
    `
      DELETE FROM public.user_api_token_v1
      WHERE token_hash = $1
    `,
    [hashApiToken(token)],
  )

  return (result.rowCount ?? 0) > 0
}
