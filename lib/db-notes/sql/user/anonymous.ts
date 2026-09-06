import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { UserV1Row } from "../../generated/typescript/db-types";
import { getDb } from "../../lib/db/postgres";
import { ensureDefaultTagForUser } from "../tag";
import { ensureDefaultTaxonomyChainForUser } from "../taxonomy";
import { ensureTaxonomyLevelsForUser } from "../taxonomy-level";
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
    // Seeded in the same transaction as the user row. A user with no tier
    // vocabulary cannot hold a taxonomy row at all (the composite level FK
    // forbids it), and one with no epic > category > group chain has nowhere to
    // put a note, which the editor experiences as autosave silently doing
    // nothing.
    await ensureTaxonomyLevelsForUser(client, rows[0].id);
    await ensureDefaultTaxonomyChainForUser(client, rows[0].id);
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
 *   natural key and references are remapped (taxonomy/tags by label).
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
  user_note_tag_v1: "dedup-remap",
  user_taxonomy_v1: "dedup-remap",
  user_note_v1: "reparent",
  // Anonymous sessions have no way to mint API tokens; any that existed would
  // be discarded with the anonymous row.
  user_api_token_v1: "drop",
  // The destination account's tier vocabulary wins. A visitor who renamed
  // "Category" to "Project" before signing in does not rename it for the
  // account they sign in to — that is a far bigger surprise than inheriting a
  // UI preference, which is why this diverges from the anon-wins rule used for
  // user_v1.preferences.
  user_taxonomy_level_v1: "drop",
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

/**
 * Old anonymous id -> surviving destination id, for references the client is
 * still holding when the merge happens.
 */
export interface MergeIdRemap {
  anonId: number;
  realId: number;
}

export interface MergeRemaps {
  taxonomy: MergeIdRemap[];
  tags: MergeIdRemap[];
}

/**
 * Merge one level of the taxonomy by label and return the id remap.
 *
 * Level order matters: a level-2 row cannot be inserted until its parent's
 * destination id is known, so each call takes the remap built for the level
 * above. Dedup is by final label — a category the visitor renamed simply does
 * not collide and arrives as a separate row, which is the intended behavior.
 */
const mergeTaxonomyLevel = async (
  client: PoolClient,
  anonUserId: number,
  realUserId: number,
  level: number,
  parentRemap: Map<number, number> | null
): Promise<MergeIdRemap[]> => {
  const { rows: anonRows } = await client.query<{
    id: number;
    parent_id: number | null;
    label: string;
  }>(
    `SELECT id, parent_id, label
     FROM public.user_taxonomy_v1
     WHERE user_id = $1 AND level = $2
     ORDER BY id`,
    [anonUserId, level]
  );

  const remap: MergeIdRemap[] = [];

  for (const anonRow of anonRows) {
    const realParentId =
      parentRemap === null
        ? null
        : anonRow.parent_id === null
          ? null
          : (parentRemap.get(anonRow.parent_id) ?? null);

    // A row whose parent did not survive has nowhere to go. Cannot happen with
    // a consistent tree, but skipping beats inserting an orphan.
    if (parentRemap !== null && realParentId === null) continue;

    const { rows } = await client.query<{ id: number }>(
      `INSERT INTO public.user_taxonomy_v1 (user_id, level, parent_id, label)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, level, parent_id, label)
       DO UPDATE SET label = EXCLUDED.label
       RETURNING id`,
      [realUserId, level, realParentId, anonRow.label]
    );

    const realId = rows[0]?.id;
    if (realId === undefined) {
      throw new Error("Failed to resolve a taxonomy row during the merge.");
    }

    remap.push({ anonId: anonRow.id, realId });
  }

  return remap;
};

export const mergeAnonymousUserInto = async (
  anonUserId: number,
  realUserId: number
): Promise<MergeRemaps> => {
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

    // Merge the hierarchy one level at a time, top down: a level-2 row cannot
    // be inserted until its parent's destination id is known.
    const epicRemap = await mergeTaxonomyLevel(client, anonUserId, realUserId, 1, null);
    const epicMap = new Map(epicRemap.map((entry) => [entry.anonId, entry.realId]));

    const categoryTaxonomyRemap = await mergeTaxonomyLevel(
      client,
      anonUserId,
      realUserId,
      2,
      epicMap
    );
    const categoryMap = new Map(
      categoryTaxonomyRemap.map((entry) => [entry.anonId, entry.realId])
    );

    const groupRemap = await mergeTaxonomyLevel(
      client,
      anonUserId,
      realUserId,
      3,
      categoryMap
    );

    const taxonomyRemap = [...epicRemap, ...categoryTaxonomyRemap, ...groupRemap];

    // Remap group_id the same way, so notes land in the destination account's
    // copy of the group rather than pointing at a row about to be cascaded away.
    if (groupRemap.length > 0) {
      const groupValues = groupRemap
        .map((entry) => `(${entry.anonId}, ${entry.realId})`)
        .join(", ");
      await client.query(
        `UPDATE public.user_note_v1 n
         SET user_id = $1,
             group_id = m.real_id
         FROM (VALUES ${groupValues}) AS m(anon_id, real_id)
         WHERE n.user_id = $2 AND n.group_id = m.anon_id`,
        [realUserId, anonUserId]
      );
    }

    // Move any remaining notes that might not have had a mapped group
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

    // Delete anon user — CASCADE removes orphaned anon tags/taxonomy
    await client.query(
      `DELETE FROM public.user_v1 WHERE id = $1`,
      [anonUserId]
    );

    await client.query("COMMIT");

    // Returned so the client can repair references it is still holding. An
    // open note the visitor was editing keeps a local draft pointing at an
    // anonymous group id that no longer exists; without this the client falls
    // back to a default group and silently loses the note's placement.
    return {
      taxonomy: taxonomyRemap,
      tags: tagRemap.rows.map((row) => ({
        anonId: row.anon_id,
        realId: row.real_id,
      })),
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};
