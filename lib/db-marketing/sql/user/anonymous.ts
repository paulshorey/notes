import { randomUUID } from "node:crypto";
import type { UserV1Row } from "../../generated/typescript/db-types";
import { getDb } from "../../lib/db/postgres";
import { ensureDefaultTagForUser } from "../tag";
import { hashPassword } from "./password";
import type { UserSummary } from "./types";

export const CLAIM_IDENTIFIER_TAKEN_ERROR =
  "That username or email is already taken.";
export const CLAIM_NOT_ANONYMOUS_ERROR =
  "Only an anonymous user can be claimed.";

const mapUser = (row: UserV1Row): UserSummary => ({
  id: row.id,
  username: row.username,
  email: row.email,
  phone: row.phone,
  preferences:
    typeof row.preferences === "object" &&
    row.preferences !== null &&
    !Array.isArray(row.preferences)
      ? (row.preferences as UserSummary["preferences"])
      : {},
});

export const createAnonymousUser = async (): Promise<UserSummary> => {
  const username = `anon-${randomUUID()}`;
  const client = await getDb().connect();

  try {
    await client.query("BEGIN");

    const { rows } = await client.query<UserV1Row>(
      `INSERT INTO public.user_v1 (username, is_anonymous)
       VALUES ($1, true)
       RETURNING id, username, email, phone, preferences`,
      [username]
    );

    if (!rows[0]) {
      throw new Error("Failed to create anonymous user.");
    }

    await ensureDefaultTagForUser(client, rows[0].id);
    await client.query("COMMIT");

    return mapUser(rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

/**
 * Upgrade an anonymous user row into a permanent account in place. The user id
 * (and therefore every owned row) is untouched — only identity columns change.
 * This is the common signup path; no cross-user data movement happens here.
 */
export const claimAnonymousUser = async (
  anonUserId: number,
  identity: { username: string; password: string; email?: string }
): Promise<UserSummary> => {
  const client = await getDb().connect();

  try {
    await client.query("BEGIN");

    const anonCheck = await client.query<{ is_anonymous: boolean }>(
      `SELECT is_anonymous FROM public.user_v1 WHERE id = $1 FOR UPDATE`,
      [anonUserId]
    );
    if (!anonCheck.rows[0]?.is_anonymous) {
      throw new Error(CLAIM_NOT_ANONYMOUS_ERROR);
    }

    // Serialize concurrent claims of the same normalized identifier. The DB
    // only has an exact-match UNIQUE(username); it has no case-insensitive
    // username or email uniqueness, so two simultaneous claims of "Alice" and
    // "alice" (or the same email) could otherwise both pass the conflict
    // SELECT below and both commit. Transaction-scoped advisory locks on the
    // normalized identifiers close that window without a schema migration
    // (adding lower() unique indexes would first require auditing production
    // data for existing case-duplicates). Keys are sorted so two claims that
    // lock the same pair cannot deadlock.
    const lockKeys = [identity.username.toLowerCase()];
    if (identity.email) {
      lockKeys.push(identity.email.toLowerCase());
    }
    for (const key of [...new Set(lockKeys)].sort()) {
      await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [
        key,
      ]);
    }

    // A claimed identifier must not resolve to another account through
    // findUserByIdentifier, which matches ONE identifier string against
    // username, email, AND phone digits. So the proposed username and email
    // are each checked against all three namespaces (e.g. a username of
    // "alice@example.com" conflicts with an account whose EMAIL is
    // alice@example.com — otherwise sign-in with that identifier would
    // resolve to the older row and lock the new user out). Only
    // non-anonymous rows count; this row is still anonymous, so it excludes
    // itself. The global UNIQUE(username) plus the 23505 handler below covers
    // exact collisions with other anonymous rows.
    const usernameDigits = identity.username.replace(/\D/g, "");
    const emailDigits = identity.email?.replace(/\D/g, "") ?? "";
    const conflict = await client.query<{ id: number }>(
      `SELECT id FROM public.user_v1
       WHERE is_anonymous = false
         AND (
           lower(username) = lower($1)
           OR lower(email) = lower($1)
           OR ($2 <> '' AND regexp_replace(coalesce(phone, ''), '\\D', '', 'g') = $2)
           OR ($3::text IS NOT NULL AND (
             lower(username) = lower($3)
             OR lower(email) = lower($3)
             OR ($4 <> '' AND regexp_replace(coalesce(phone, ''), '\\D', '', 'g') = $4)
           ))
         )
       LIMIT 1`,
      [identity.username, usernameDigits, identity.email ?? null, emailDigits]
    );
    if (conflict.rows[0]) {
      throw new Error(CLAIM_IDENTIFIER_TAKEN_ERROR);
    }

    const { rows } = await client.query<UserV1Row>(
      `UPDATE public.user_v1
       SET username = $2, email = $3, password = $4, is_anonymous = false
       WHERE id = $1
       RETURNING id, username, email, phone, preferences`,
      [
        anonUserId,
        identity.username,
        identity.email ?? null,
        hashPassword(identity.password),
      ]
    );

    if (!rows[0]) {
      throw new Error("Failed to claim anonymous user.");
    }

    await client.query("COMMIT");
    return mapUser(rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");

    if (
      typeof error === "object" &&
      error !== null &&
      (error as { code?: string }).code === "23505"
    ) {
      throw new Error(CLAIM_IDENTIFIER_TAKEN_ERROR);
    }

    throw error;
  } finally {
    client.release();
  }
};

/**
 * Every table with a foreign key to user_v1 must be listed here with the
 * strategy mergeAnonymousUserInto applies to it:
 *
 * - "dedup-remap": rows are deduplicated against the destination user by a
 *   natural key and references are remapped (categories/tags by label).
 * - "reparent":    rows simply change user_id to the destination user.
 * - "drop":        rows are intentionally discarded via the CASCADE delete of
 *   the anonymous user row.
 *
 * A test diffs this map against information_schema, so adding a user-owned
 * table without deciding its merge behavior fails CI instead of silently
 * losing data.
 */
export const MERGE_TABLE_STRATEGIES: Record<
  string,
  "dedup-remap" | "reparent" | "drop"
> = {
  user_note_category_v1: "dedup-remap",
  user_note_tag_v1: "dedup-remap",
  user_note_v1: "reparent",
  // Anonymous sessions have no way to mint API tokens; any that existed would
  // be discarded with the anonymous row.
  user_api_token_v1: "drop",
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Recursive per-property merge of preference objects. Anonymous values win at
 * the leaf level; keys only the real account has are preserved.
 *
 * Why anon-wins is safe: `user_v1.preferences` defaults to `{}` and the app
 * only ever writes a key when the user explicitly changes that setting, so a
 * key present in the anonymous row means the person customized it during
 * their (more recent) anonymous session. A key absent from the anonymous row
 * means "still default" and the real account's value is kept.
 */
export const mergePreferenceObjects = (
  real: Record<string, unknown>,
  anon: Record<string, unknown>
): Record<string, unknown> => {
  const merged: Record<string, unknown> = { ...real };

  for (const [key, anonValue] of Object.entries(anon)) {
    if (anonValue === undefined) continue;
    const realValue = merged[key];
    merged[key] =
      isPlainObject(realValue) && isPlainObject(anonValue)
        ? mergePreferenceObjects(realValue, anonValue)
        : anonValue;
  }

  return merged;
};

export const mergeAnonymousUserInto = async (
  anonUserId: number,
  realUserId: number
): Promise<void> => {
  const db = getDb();
  const client = await db.connect();

  try {
    await client.query("BEGIN");

    // FOR UPDATE is load-bearing: it serializes this merge against a
    // concurrent claimAnonymousUser of the same row. Without it the merge
    // could pass this check, wait on the claim's row lock, and then delete a
    // row that had just become a permanent account. Locking here makes the
    // read see the latest committed state, so a claimed row fails the check.
    const anonCheck = await client.query<{
      is_anonymous: boolean;
      preferences: unknown;
    }>(
      `SELECT is_anonymous, preferences FROM public.user_v1 WHERE id = $1 FOR UPDATE`,
      [anonUserId]
    );
    if (!anonCheck.rows[0]?.is_anonymous) {
      throw new Error("Source user is not anonymous.");
    }

    const realCheck = await client.query<{
      is_anonymous: boolean;
      preferences: unknown;
    }>(
      `SELECT is_anonymous, preferences FROM public.user_v1 WHERE id = $1 FOR UPDATE`,
      [realUserId]
    );
    if (!realCheck.rows[0] || realCheck.rows[0].is_anonymous) {
      throw new Error("Destination user is anonymous or does not exist.");
    }

    // Carry the visitor's explicitly-set UI preferences into the real account
    // (per-property; see mergePreferenceObjects) before the anon row is
    // deleted below.
    const anonPreferences = anonCheck.rows[0].preferences;
    const realPreferences = realCheck.rows[0].preferences;
    if (isPlainObject(anonPreferences) && Object.keys(anonPreferences).length > 0) {
      const mergedPreferences = mergePreferenceObjects(
        isPlainObject(realPreferences) ? realPreferences : {},
        anonPreferences
      );
      await client.query(
        `UPDATE public.user_v1 SET preferences = $2::jsonb WHERE id = $1`,
        [realUserId, JSON.stringify(mergedPreferences)]
      );
    }

    // Dedupe categories: insert anon labels into real user, skip conflicts
    await client.query(
      `INSERT INTO public.user_note_category_v1 (user_id, label)
       SELECT $1, label FROM public.user_note_category_v1 WHERE user_id = $2
       ON CONFLICT (user_id, label) DO NOTHING`,
      [realUserId, anonUserId]
    );

    // Build category remap
    const categoryRemap = await client.query<{ anon_id: number; real_id: number }>(
      `SELECT a.id AS anon_id, r.id AS real_id
       FROM public.user_note_category_v1 a
       JOIN public.user_note_category_v1 r
         ON r.user_id = $1 AND r.label = a.label
       WHERE a.user_id = $2`,
      [realUserId, anonUserId]
    );

    // Dedupe tags: insert anon labels into real user, skip conflicts
    await client.query(
      `INSERT INTO public.user_note_tag_v1 (user_id, label)
       SELECT $1, label FROM public.user_note_tag_v1 WHERE user_id = $2
       ON CONFLICT (user_id, label) DO NOTHING`,
      [realUserId, anonUserId]
    );

    // Build tag remap
    const tagRemap = await client.query<{ anon_id: number; real_id: number }>(
      `SELECT a.id AS anon_id, r.id AS real_id
       FROM public.user_note_tag_v1 a
       JOIN public.user_note_tag_v1 r
         ON r.user_id = $1 AND r.label = a.label
       WHERE a.user_id = $2`,
      [realUserId, anonUserId]
    );

    // Reassign notes: update user_id and remap category_id
    if (categoryRemap.rows.length > 0) {
      const values = categoryRemap.rows
        .map((r) => `(${r.anon_id}, ${r.real_id})`)
        .join(", ");
      await client.query(
        `UPDATE public.user_note_v1 n
         SET user_id = $1,
             category_id = m.real_id
         FROM (VALUES ${values}) AS m(anon_id, real_id)
         WHERE n.user_id = $2 AND n.category_id = m.anon_id`,
        [realUserId, anonUserId]
      );
    }

    // Move any remaining notes that might not have had a mapped category
    await client.query(
      `UPDATE public.user_note_v1 SET user_id = $1 WHERE user_id = $2`,
      [realUserId, anonUserId]
    );

    // Remap tag links
    if (tagRemap.rows.length > 0) {
      const tagValues = tagRemap.rows
        .map((r) => `(${r.anon_id}, ${r.real_id})`)
        .join(", ");
      // No bind parameters: the remap values are inlined above. Passing unused
      // parameters makes Postgres reject the statement ("bind message supplies
      // N parameters, but prepared statement requires 0"), aborting the merge.
      await client.query(
        `UPDATE public.user_note_tag_link_v1 l
         SET tag_id = m.real_id
         FROM (VALUES ${tagValues}) AS m(anon_id, real_id)
         WHERE l.tag_id = m.anon_id`
      );
    }

    // Delete anon user — CASCADE removes orphaned anon categories/tags
    await client.query(
      `DELETE FROM public.user_v1 WHERE id = $1`,
      [anonUserId]
    );

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};
