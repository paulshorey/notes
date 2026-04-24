import type { UserV1Row } from "../../generated/typescript/db-types";
import { getDb } from "../../lib/db/postgres";
import type { UserPreferences, UserSummary } from "./types";

const userSelect = `
  SELECT id, username, email, phone, preferences
  FROM public.user_v1
`;

const toUserPreferences = (value: unknown): UserPreferences => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }

  return value as UserPreferences;
};

const mapUser = (row: UserV1Row): UserSummary => ({
  id: row.id,
  username: row.username,
  email: row.email,
  phone: row.phone,
  preferences: toUserPreferences(row.preferences),
});

export const findUserByIdentifier = async (identifier: string) => {
  const trimmed = identifier.trim();

  if (trimmed === "") {
    throw new Error("Username, email, or phone is required.");
  }

  const phoneDigits = trimmed.replace(/\D/g, "");
  const query = `
    ${userSelect}
    WHERE lower(username) = lower($1)
      OR lower(email) = lower($1)
      OR regexp_replace(coalesce(phone, ''), '\\D', '', 'g') = $2
    ORDER BY id ASC
    LIMIT 1
  `;
  const { rows } = await getDb().query<UserV1Row>(query, [trimmed, phoneDigits]);

  return rows[0] ? mapUser(rows[0]) : null;
};

export const getUserById = async (userId: number) => {
  const { rows } = await getDb().query<UserV1Row>(
    `
      ${userSelect}
      WHERE id = $1
      LIMIT 1
    `,
    [userId]
  );

  return rows[0] ? mapUser(rows[0]) : null;
};

export const updateUserPreferencesById = async (
  userId: number,
  preferences: UserPreferences
) => {
  const { rows } = await getDb().query<UserV1Row>(
    `
      UPDATE public.user_v1
      SET preferences = $2::jsonb
      WHERE id = $1
      RETURNING id, username, email, phone, preferences
    `,
    [userId, JSON.stringify(preferences)]
  );

  return rows[0] ? mapUser(rows[0]) : null;
};
