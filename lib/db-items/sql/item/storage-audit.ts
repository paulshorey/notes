import type { PoolClient } from "pg"
import { ITEM_STORAGE_OWNERS } from "./stored-capabilities"

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
