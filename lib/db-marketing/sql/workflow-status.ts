import { getDb } from "../lib/db/postgres";
import type { WorkflowStatusRecord } from "../contracts/notes-app";
import type { PoolClient } from "pg";

export const DEFAULT_WORKFLOW_STATUSES = [
  { label: "backlog", sortOrder: 0, isTerminal: false },
  { label: "todo", sortOrder: 1, isTerminal: false },
  { label: "in progress", sortOrder: 2, isTerminal: false },
  { label: "testing", sortOrder: 3, isTerminal: false },
  { label: "done", sortOrder: 4, isTerminal: true },
] as const;

interface WorkflowStatusWithCountRow {
  id: number;
  user_id: number;
  label: string;
  sort_order: number;
  is_terminal: boolean;
  time_created: Date;
  time_modified: Date;
  item_count: number | string | null;
  last_used_at: Date | string | null;
}

const workflowStatusSelect = `
  SELECT
    ws.id,
    ws.user_id,
    ws.label,
    ws.sort_order,
    ws.is_terminal,
    ws.time_created,
    ws.time_modified,
    (
      SELECT COUNT(*)::int
      FROM public.user_note_v1 n
      WHERE n.workflow_status_id = ws.id
        AND n.user_id = ws.user_id
    ) AS item_count,
    (
      SELECT MAX(n.time_modified)
      FROM public.user_note_v1 n
      WHERE n.workflow_status_id = ws.id
        AND n.user_id = ws.user_id
    ) AS last_used_at
  FROM public.user_workflow_status_v1 ws
`;

const toIsoStringOrNull = (value: Date | string | null): string | null => {
  if (value === null || value === undefined) {
    return null;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  return new Date(value).toISOString();
};

const mapWorkflowStatus = (row: WorkflowStatusWithCountRow): WorkflowStatusRecord => ({
  id: row.id,
  userId: row.user_id,
  label: row.label,
  sortOrder: row.sort_order,
  isTerminal: row.is_terminal,
  itemCount: Number(row.item_count ?? 0),
  lastUsedAt: toIsoStringOrNull(row.last_used_at),
});

export const ensureDefaultWorkflowStatusesForUser = async (
  client: PoolClient,
  userId: number
) => {
  for (const status of DEFAULT_WORKFLOW_STATUSES) {
    await client.query(
      `
        INSERT INTO public.user_workflow_status_v1 (
          user_id,
          label,
          sort_order,
          is_terminal
        )
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (user_id, label) DO NOTHING
      `,
      [userId, status.label, status.sortOrder, status.isTerminal]
    );
  }
};

export const getDefaultBoardStatusForUser = async (
  client: PoolClient,
  userId: number
): Promise<{ id: number; label: string; isTerminal: boolean } | null> => {
  const { rows } = await client.query<{
    id: number;
    label: string;
    is_terminal: boolean;
  }>(
    `
      SELECT id, label, is_terminal
      FROM public.user_workflow_status_v1
      WHERE user_id = $1
      ORDER BY
        CASE WHEN label = 'todo' THEN 0 ELSE 1 END,
        sort_order ASC,
        id ASC
      LIMIT 1
    `,
    [userId]
  );

  return rows[0]
    ? {
        id: rows[0].id,
        label: rows[0].label,
        isTerminal: rows[0].is_terminal,
      }
    : null;
};

export const listWorkflowStatusesByUser = async (userId: number) => {
  const { rows } = await getDb().query<WorkflowStatusWithCountRow>(
    `
      ${workflowStatusSelect}
      WHERE ws.user_id = $1
      ORDER BY ws.sort_order ASC, ws.id ASC
    `,
    [userId]
  );

  return rows.map(mapWorkflowStatus);
};

export const getWorkflowStatusByIdForUser = async (
  userId: number,
  workflowStatusId: number
) => {
  const { rows } = await getDb().query<WorkflowStatusWithCountRow>(
    `
      ${workflowStatusSelect}
      WHERE ws.user_id = $1
        AND ws.id = $2
      LIMIT 1
    `,
    [userId, workflowStatusId]
  );

  return rows[0] ? mapWorkflowStatus(rows[0]) : null;
};

export const createWorkflowStatusForUser = async (
  client: PoolClient,
  userId: number,
  label: string
) => {
  const { rows: orderRows } = await client.query<{ next_order: number | string }>(
    `
      SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_order
      FROM public.user_workflow_status_v1
      WHERE user_id = $1
    `,
    [userId]
  );

  const sortOrder = Number(orderRows[0]?.next_order ?? 0);

  const { rows } = await client.query<{ id: number }>(
    `
      INSERT INTO public.user_workflow_status_v1 (
        user_id,
        label,
        sort_order,
        is_terminal
      )
      VALUES ($1, $2, $3, false)
      ON CONFLICT (user_id, label) DO NOTHING
      RETURNING id
    `,
    [userId, label, sortOrder]
  );

  if (rows[0]) {
    return rows[0].id;
  }

  const existing = await client.query<{ id: number }>(
    `
      SELECT id
      FROM public.user_workflow_status_v1
      WHERE user_id = $1
        AND label = $2
      LIMIT 1
    `,
    [userId, label]
  );

  return existing.rows[0]?.id ?? null;
};

export const updateWorkflowStatusLabelForUser = async (
  client: PoolClient,
  userId: number,
  workflowStatusId: number,
  label: string
) => {
  const { rows } = await client.query<{ id: number }>(
    `
      UPDATE public.user_workflow_status_v1
      SET label = $1
      WHERE id = $2
        AND user_id = $3
      RETURNING id
    `,
    [label, workflowStatusId, userId]
  );

  return rows[0]?.id ?? null;
};

export const updateWorkflowStatusSortOrderForUser = async (
  client: PoolClient,
  userId: number,
  workflowStatusId: number,
  sortOrder: number
) => {
  const { rows } = await client.query<{ id: number }>(
    `
      UPDATE public.user_workflow_status_v1
      SET sort_order = $1
      WHERE id = $2
        AND user_id = $3
      RETURNING id
    `,
    [sortOrder, workflowStatusId, userId]
  );

  return rows[0]?.id ?? null;
};

export const deleteWorkflowStatusForUser = async (
  userId: number,
  workflowStatusId: number,
  reassignToId: number
) => {
  const client = await getDb().connect();

  try {
    await client.query("BEGIN");

    const statusResult = await client.query<{
      is_terminal: boolean;
    }>(
      `
        SELECT is_terminal
        FROM public.user_workflow_status_v1
        WHERE user_id = $1
          AND id = $2
      `,
      [userId, workflowStatusId]
    );

    if (!statusResult.rows[0]) {
      await client.query("COMMIT");
      return { deleted: false, reassignedItems: 0 };
    }

    if (statusResult.rows[0].is_terminal) {
      throw new Error("Cannot delete a terminal workflow status.");
    }

    if (workflowStatusId === reassignToId) {
      throw new Error("Cannot reassign items to the workflow status being deleted.");
    }

    const reassignResult = await client.query<{ count: number | string }>(
      `
        SELECT COUNT(*)::int AS count
        FROM public.user_workflow_status_v1
        WHERE user_id = $1
          AND id = $2
      `,
      [userId, reassignToId]
    );

    if (Number(reassignResult.rows[0]?.count ?? 0) !== 1) {
      throw new Error("Reassignment workflow status was not found for this user.");
    }

    const itemCountResult = await client.query<{ count: number | string }>(
      `
        SELECT COUNT(*)::int AS count
        FROM public.user_note_v1 n
        WHERE n.user_id = $1
          AND n.workflow_status_id = $2
      `,
      [userId, workflowStatusId]
    );

    const itemCount = Number(itemCountResult.rows[0]?.count ?? 0);

    if (itemCount > 0) {
      await client.query(
        `
          UPDATE public.user_note_v1
          SET workflow_status_id = $3
          WHERE user_id = $1
            AND workflow_status_id = $2
        `,
        [userId, workflowStatusId, reassignToId]
      );
    }

    const deleteResult = await client.query(
      `
        DELETE FROM public.user_workflow_status_v1
        WHERE id = $1
          AND user_id = $2
      `,
      [workflowStatusId, userId]
    );

    await client.query("COMMIT");

    return {
      deleted: (deleteResult.rowCount ?? 0) > 0,
      reassignedItems: itemCount,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};
