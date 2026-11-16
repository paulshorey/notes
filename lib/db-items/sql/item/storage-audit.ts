import type { PoolClient } from "pg"
import { ITEM_OWNED_TABLES, ITEM_STORAGE_OWNERS } from "./stored-capabilities"

/**
 * Item storage that no part of the registry accounts for: a column of
 * `workspace_item_v1`, or a table with a foreign key to it. Such storage would be left
 * out of backups and duplicate detection without anyone having decided that, so
 * `db:verify` fails until it is declared in `stored-capabilities.ts`.
 */
export const findUndeclaredItemStorage = async (client: Pick<PoolClient, "query">) => {
  const columns = await client.query<{ name: string }>(
    `SELECT column_name AS name FROM information_schema.columns
     WHERE table_schema='public' AND table_name='workspace_item_v1' ORDER BY column_name`,
  )
  const tables = await client.query<{ name: string }>(
    `SELECT DISTINCT c.conrelid::regclass::text AS name FROM pg_constraint c
     JOIN pg_namespace n ON n.oid=c.connamespace
     WHERE c.contype='f' AND c.confrelid='public.workspace_item_v1'::regclass
       AND n.nspname='public' ORDER BY name`,
  )
  const undeclared = (rows: { name: string }[], declared: readonly string[]) =>
    rows.map((row) => row.name.replace(/^public\./, "")).filter((name) => !declared.includes(name))
  return {
    columns: undeclared(columns.rows, ITEM_STORAGE_OWNERS.columns),
    tables: undeclared(tables.rows, ITEM_STORAGE_OWNERS.tables),
  }
}

/**
 * Owned tables whose rows point into the item's workspace but declare no `rehome`. A
 * table does when it has a `workspace_id` column, or reaches a table that has one or the
 * workspace itself through foreign keys (a subcategory reaches its workspace through its
 * category). Such rows cannot simply follow their item to another workspace: left alone they
 * block the move through a composite foreign key or keep a reference across workspaces.
 * `owned` is the declaration to check; it defaults to the registry's.
 */
export const findUnrehomedTables = async (
  client: Pick<PoolClient, "query">,
  owned: Record<string, { rehomed: boolean }> = ITEM_OWNED_TABLES,
) => {
  const names = Object.entries(owned)
    .filter(([, table]) => !table.rehomed)
    .map(([name]) => name)
  if (names.length === 0) return []
  const { rows } = await client.query<{ name: string }>(
    `WITH RECURSIVE reach(origin, rel) AS (
       SELECT t.name, ('public.'||quote_ident(t.name))::regclass FROM unnest($1::text[]) t(name)
       UNION
       SELECT r.origin, k.confrelid FROM reach r
       JOIN pg_constraint k ON k.conrelid=r.rel AND k.contype='f'
       WHERE k.confrelid<>'public.workspace_item_v1'::regclass
     )
     SELECT DISTINCT origin AS name FROM reach r
     WHERE r.rel='public.user_workspace_v1'::regclass
        OR EXISTS (SELECT 1 FROM pg_attribute a
                   WHERE a.attrelid=r.rel AND a.attname='workspace_id' AND NOT a.attisdropped)
     ORDER BY name`,
    [names],
  )
  return rows.map((row) => row.name)
}
