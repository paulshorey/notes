import { createHash, randomBytes } from "node:crypto";
import { getDb } from "../../lib/db/postgres";

// Only a SHA-256 hash of the token is stored, so a database leak does not
// expose usable credentials. The plaintext token is returned to the client
// exactly once at login.
const hashApiToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");

export const createApiTokenForUser = async (userId: number) => {
  const token = `nta_${randomBytes(32).toString("base64url")}`;

  await getDb().query(
    `
      INSERT INTO public.user_api_token_v1 (user_id, token_hash)
      VALUES ($1, $2)
    `,
    [userId, hashApiToken(token)]
  );

  return token;
};

export const findUserIdByApiToken = async (token: string) => {
  const { rows } = await getDb().query<{ user_id: number }>(
    `
      UPDATE public.user_api_token_v1
      SET time_last_used = CURRENT_TIMESTAMP
      WHERE token_hash = $1
      RETURNING user_id
    `,
    [hashApiToken(token)]
  );

  return rows[0]?.user_id ?? null;
};

export const deleteApiToken = async (token: string) => {
  const result = await getDb().query(
    `
      DELETE FROM public.user_api_token_v1
      WHERE token_hash = $1
    `,
    [hashApiToken(token)]
  );

  return (result.rowCount ?? 0) > 0;
};
