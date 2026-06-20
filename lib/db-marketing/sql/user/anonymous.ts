import { randomUUID } from "node:crypto";
import type { UserV1Row } from "../../generated/typescript/db-types";
import { getDb } from "../../lib/db/postgres";
import { ensureDefaultTagForUser } from "../tag";
import { ensureDefaultWorkflowStatusesForUser } from "../workflow-status";
import type { UserSummary } from "./types";

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
    await ensureDefaultWorkflowStatusesForUser(client, rows[0].id);
    await client.query("COMMIT");

    return mapUser(rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

export const mergeAnonymousUserInto = async (
  anonUserId: number,
  realUserId: number
): Promise<void> => {
  const db = getDb();
  const client = await db.connect();

  try {
    await client.query("BEGIN");

    const anonCheck = await client.query<{ is_anonymous: boolean }>(
      `SELECT is_anonymous FROM public.user_v1 WHERE id = $1`,
      [anonUserId]
    );
    if (!anonCheck.rows[0]?.is_anonymous) {
      throw new Error("Source user is not anonymous.");
    }

    const realCheck = await client.query<{ is_anonymous: boolean }>(
      `SELECT is_anonymous FROM public.user_v1 WHERE id = $1 FOR UPDATE`,
      [realUserId]
    );
    if (!realCheck.rows[0] || realCheck.rows[0].is_anonymous) {
      throw new Error("Destination user is anonymous or does not exist.");
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

    // Dedupe workflow statuses: insert anon labels into real user, skip conflicts
    await client.query(
      `INSERT INTO public.user_workflow_status_v1 (
         user_id,
         label,
         sort_order,
         is_terminal
       )
       SELECT $1, label, sort_order, is_terminal
       FROM public.user_workflow_status_v1
       WHERE user_id = $2
       ON CONFLICT (user_id, label) DO NOTHING`,
      [realUserId, anonUserId]
    );

    const workflowStatusRemap = await client.query<{
      anon_id: number;
      real_id: number;
    }>(
      `SELECT a.id AS anon_id, r.id AS real_id
       FROM public.user_workflow_status_v1 a
       JOIN public.user_workflow_status_v1 r
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

    if (workflowStatusRemap.rows.length > 0) {
      const values = workflowStatusRemap.rows
        .map((r) => `(${r.anon_id}, ${r.real_id})`)
        .join(", ");
      await client.query(
        `UPDATE public.user_note_v1 n
         SET workflow_status_id = m.real_id
         FROM (VALUES ${values}) AS m(anon_id, real_id)
         WHERE n.user_id = $1
           AND n.workflow_status_id = m.anon_id`,
        [realUserId]
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
      await client.query(
        `UPDATE public.user_note_tag_link_v1 l
         SET tag_id = m.real_id
         FROM (VALUES ${tagValues}) AS m(anon_id, real_id)
         WHERE l.tag_id = m.anon_id`,
        [realUserId, anonUserId]
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
