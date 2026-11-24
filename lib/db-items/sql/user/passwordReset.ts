import { createHash, randomBytes } from "node:crypto"
import { getDb } from "../../lib/db/postgres"
import { findUserCredentials } from "./gets"
import { hashPassword } from "./password"

const hashCode = (code: string) => createHash("sha256").update(code).digest("hex")

export async function reservePasswordReset(identifier: string, requestId: string) {
  const user = await findUserCredentials(identifier)
  if (!user?.password) return null

  const code = randomBytes(16).toString("hex")
  const client = await getDb().connect()
  try {
    await client.query("BEGIN")
    // Serialize reservations across replicas before counting texts to the shared phone.
    await client.query("SELECT pg_advisory_xact_lock(hashtext('notes-password-reset-sms'))")
    await client.query(
      "DELETE FROM public.user_password_reset_v1 WHERE requested_at <= now() - interval '1 day'",
    )

    const inserted = await client.query(
      `INSERT INTO public.user_password_reset_v1 (request_id, user_id, credential_version, code_hash)
       SELECT $1, $2, $3, $4
       FROM public.user_password_reset_v1
       HAVING count(*) < 20
         AND count(*) FILTER (WHERE requested_at > now() - interval '15 minutes') < 5
         AND count(*) FILTER (WHERE user_id = $2 AND requested_at > now() - interval '5 minutes') = 0`,
      [requestId, user.id, user.credential_version, hashCode(code)],
    )
    await client.query("COMMIT")
    return inserted.rowCount === 1 ? { username: user.username, code } : null
  } catch (error) {
    await client.query("ROLLBACK")
    throw error
  } finally {
    client.release()
  }
}

export async function resetPasswordWithCode(requestId: string, code: string, password: string) {
  const digest = hashCode(code)
  const activeRequest = `
    r.request_id = $1 AND r.code_hash = $2
      AND r.requested_at > statement_timestamp() - interval '30 minutes'
      AND u.id = r.user_id AND u.credential_version = r.credential_version
      AND u.is_anonymous = false
  `
  const candidate = await getDb().query(
    `SELECT 1 FROM public.user_v1 u, public.user_password_reset_v1 r WHERE ${activeRequest}`,
    [requestId, digest],
  )
  if (candidate.rowCount !== 1) return false

  const newHash = hashPassword(password)
  const client = await getDb().connect()
  try {
    await client.query("BEGIN")
    // The version check makes concurrent redemption and older requests single-use.
    const { rows } = await client.query<{ id: number }>(
      `UPDATE public.user_v1 u SET password = $3, credential_version = u.credential_version + 1
       FROM public.user_password_reset_v1 r WHERE ${activeRequest}
       RETURNING u.id`,
      [requestId, digest, newHash],
    )
    const user = rows[0]
    if (user) {
      await client.query(
        "UPDATE public.user_password_reset_v1 SET code_hash = NULL WHERE user_id = $1",
        [user.id],
      )
      await client.query("DELETE FROM public.user_api_token_v1 WHERE user_id = $1", [user.id])
    }
    await client.query("COMMIT")
    return Boolean(user)
  } catch (error) {
    await client.query("ROLLBACK")
    throw error
  } finally {
    client.release()
  }
}
