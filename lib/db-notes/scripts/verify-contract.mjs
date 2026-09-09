import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import process from "node:process"
import { Client } from "pg"

if (!process.env.DB_NOTES_URL) throw new Error("DB_NOTES_URL is required")
const run = (command, args) =>
  execFileSync(command, args, { cwd: process.cwd(), env: process.env, stdio: "inherit" })
run("node", ["scripts/migrate.mjs"])
run("bash", ["scripts/snapshot-schema.sh"])
run("node", ["scripts/generate-types.mjs"])
run("node", ["scripts/generate-app-contract.mjs", "--write"])

const client = new Client({ connectionString: process.env.DB_NOTES_URL })
await client.connect()
const expectedTables = [
  "user_v1",
  "user_api_token_v1",
  "user_workspace_v1",
  "workspace_note_category_v1",
  "workspace_note_status_v1",
  "workspace_note_tag_v1",
  "user_note_v1",
  "user_note_category_link_v1",
  "user_note_tag_link_v1",
]
const tables = await client.query(
  `SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name=ANY($1::text[])`,
  [expectedTables],
)
const present = new Set(tables.rows.map((row) => row.table_name))
for (const table of expectedTables)
  if (!present.has(table)) throw new Error(`Missing expected table: ${table}`)
for (const stale of [
  "user_note_category_v1",
  "user_note_tag_v1",
  "user_taxonomy_v1",
  "user_taxonomy_level_v1",
  "user_workflow_status_v1",
]) {
  const result = await client.query(`SELECT to_regclass($1) value`, [`public.${stale}`])
  if (result.rows[0]?.value !== null) throw new Error(`Stale table still exists: ${stale}`)
}

const requiredColumns = {
  user_workspace_v1: ["id", "user_id", "label", "time_created", "time_modified"],
  workspace_note_category_v1: ["id", "workspace_id", "label", "category_embedding"],
  workspace_note_status_v1: ["id", "workspace_id", "label", "position"],
  workspace_note_tag_v1: ["id", "workspace_id", "label", "tag_embedding"],
  user_note_v1: ["id", "workspace_id", "status_id", "description", "description_embedding"],
  user_note_category_link_v1: ["note_id", "category_id", "workspace_id"],
  user_note_tag_link_v1: ["note_id", "tag_id", "workspace_id"],
}
for (const [table, columns] of Object.entries(requiredColumns)) {
  const result = await client.query(
    `SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1`,
    [table],
  )
  const actual = new Set(result.rows.map((row) => row.column_name))
  for (const column of columns)
    if (!actual.has(column)) throw new Error(`Missing expected column ${table}.${column}`)
}

const staleNoteColumns = await client.query(
  `SELECT column_name FROM information_schema.columns
   WHERE table_schema='public' AND table_name='user_note_v1'
     AND column_name=ANY($1::text[])`,
  [["user_id", "category_id"]],
)
if (staleNoteColumns.rowCount !== 0)
  throw new Error(
    `Stale user_note_v1 columns remain: ${staleNoteColumns.rows
      .map((row) => row.column_name)
      .join(", ")}`,
  )

const constraints = [
  "user_workspace_v1_user_id_label_key",
  "workspace_note_category_v1_workspace_id_label_key",
  "workspace_note_status_v1_workspace_id_label_key",
  "workspace_note_tag_v1_workspace_id_label_key",
  "user_note_v1_status_workspace_fkey",
  "user_note_category_link_v1_note_workspace_fkey",
  "user_note_category_link_v1_category_workspace_fkey",
  "user_note_tag_link_v1_note_workspace_fkey",
  "user_note_tag_link_v1_tag_workspace_fkey",
]
const constraintRows = await client.query(
  `SELECT conname FROM pg_constraint WHERE conname=ANY($1::text[])`,
  [constraints],
)
const actualConstraints = new Set(constraintRows.rows.map((row) => row.conname))
for (const name of constraints)
  if (!actualConstraints.has(name)) throw new Error(`Missing expected constraint: ${name}`)

const requiredIndexes = [
  "user_workspace_v1_user_id_idx",
  "workspace_note_category_v1_workspace_id_idx",
  "workspace_note_status_v1_workspace_id_position_idx",
  "workspace_note_tag_v1_workspace_id_idx",
  "user_note_v1_workspace_id_idx",
  "user_note_v1_status_id_idx",
  "user_note_category_link_v1_category_id_idx",
  "user_note_tag_link_v1_tag_id_idx",
  "workspace_note_category_v1_category_embedding_hnsw_idx",
  "workspace_note_tag_v1_tag_embedding_hnsw_idx",
  "user_note_v1_description_embedding_hnsw_idx",
]
const indexRows = await client.query(
  `SELECT indexname FROM pg_indexes WHERE schemaname='public' AND indexname=ANY($1::text[])`,
  [requiredIndexes],
)
const actualIndexes = new Set(indexRows.rows.map((row) => row.indexname))
for (const name of requiredIndexes)
  if (!actualIndexes.has(name)) throw new Error(`Missing expected index: ${name}`)

const triggers = await client.query(
  `SELECT trigger_name FROM information_schema.triggers WHERE event_object_schema='public'`,
)
const triggerSet = new Set(triggers.rows.map((row) => row.trigger_name))
for (const table of [
  "user_v1",
  "user_workspace_v1",
  "workspace_note_category_v1",
  "workspace_note_status_v1",
  "workspace_note_tag_v1",
  "user_note_v1",
]) {
  const name = `${table}_apply_row_timestamps_v1`
  if (!triggerSet.has(name)) throw new Error(`Missing expected trigger: ${name}`)
}

const invalid = await client.query(`SELECT
 (SELECT COUNT(*) FROM public.user_note_v1 n LEFT JOIN public.user_workspace_v1 w ON w.id=n.workspace_id WHERE w.id IS NULL)::int orphan_notes,
 (SELECT COUNT(*) FROM public.user_note_category_link_v1 l JOIN public.user_note_v1 n ON n.id=l.note_id JOIN public.workspace_note_category_v1 c ON c.id=l.category_id WHERE l.workspace_id<>n.workspace_id OR l.workspace_id<>c.workspace_id)::int bad_categories,
 (SELECT COUNT(*) FROM public.user_note_tag_link_v1 l JOIN public.user_note_v1 n ON n.id=l.note_id JOIN public.workspace_note_tag_v1 t ON t.id=l.tag_id WHERE l.workspace_id<>n.workspace_id OR l.workspace_id<>t.workspace_id)::int bad_tags`)
if (Object.values(invalid.rows[0]).some((value) => Number(value) !== 0))
  throw new Error(`Workspace relation invariant failed: ${JSON.stringify(invalid.rows[0])}`)

const usersWithoutWorkspace = await client.query(
  `SELECT COUNT(*)::int count FROM public.user_v1 u WHERE NOT EXISTS(SELECT 1 FROM public.user_workspace_v1 w WHERE w.user_id=u.id)`,
)
if (usersWithoutWorkspace.rows[0].count !== 0) throw new Error("Every user must have a workspace")
const source = readFileSync(new URL("../sql/user/anonymous.ts", import.meta.url), "utf8")
const block = source.match(/MERGE_TABLE_STRATEGIES[^=]*=\s*\{([\s\S]*?)\}\s*;?/)
if (!block) throw new Error("Could not locate MERGE_TABLE_STRATEGIES")
const declared = new Set([...block[1].matchAll(/^\s*(\w+):\s*"/gm)].map((match) => match[1]))
const fkTables = await client.query(
  `SELECT DISTINCT c.conrelid::regclass::text table_name FROM pg_constraint c WHERE c.contype='f' AND c.confrelid='public.user_v1'::regclass`,
)
for (const row of fkTables.rows) {
  const table = row.table_name.replace(/^public\./, "")
  if (!declared.has(table))
    throw new Error(`Table ${table} references user_v1 but has no merge strategy`)
}
await client.end()
run("git", [
  "diff",
  "--exit-code",
  "--",
  "schema/current.sql",
  "generated/contracts/notes-app.json",
  "generated/typescript/db-types.ts",
  "generated/contracts/db-schema.json",
])
console.log("Notes DB contract verification passed")
