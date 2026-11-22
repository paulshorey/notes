import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import process from "node:process"
import { Client } from "pg"

if (!(process.env.DB_ITEMS_URL ?? process.env.DB_NOTES_URL))
  throw new Error("DB_ITEMS_URL is required (DB_NOTES_URL remains supported)")
const run = (command, args) =>
  execFileSync(command, args, { cwd: process.cwd(), env: process.env, stdio: "inherit" })
run("node", ["scripts/migrate.mjs"])
run("bash", ["scripts/snapshot-schema.sh"])
run("node", ["scripts/generate-types.mjs"])
run("node", ["scripts/generate-app-contract.mjs", "--write"])

const client = new Client({
  connectionString: process.env.DB_ITEMS_URL ?? process.env.DB_NOTES_URL,
})
await client.connect()
const expectedTables = [
  "user_v1",
  "user_api_token_v1",
  "user_password_reset_v1",
  "user_workspace_v1",
  "workspace_category_v1",
  "workspace_subcategory_v1",
  "workspace_status_v1",
  "workspace_tag_v1",
  "workspace_item_v1",
  "item_tag_link_v1",
  "user_item_trash_v1",
]
const tables = await client.query(
  `SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' AND table_name=ANY($1::text[])`,
  [expectedTables],
)
const present = new Set(tables.rows.map((row) => row.table_name))
for (const table of expectedTables)
  if (!present.has(table)) throw new Error(`Missing expected table: ${table}`)
const legacyViews = [
  "user_note_v1",
  "workspace_note_category_v1",
  "workspace_note_status_v1",
  "workspace_note_tag_v1",
  "user_note_tag_link_v1",
]
const views = await client.query(
  `SELECT table_name FROM information_schema.views WHERE table_schema='public' AND is_updatable='YES' AND table_name=ANY($1::text[])`,
  [legacyViews],
)
if (views.rowCount !== legacyViews.length)
  throw new Error("Missing rolling-deployment compatibility views")
for (const stale of [
  "item_category_link_v1",
  "user_note_category_link_v1",
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
  user_v1: ["credential_version"],
  user_password_reset_v1: [
    "request_id",
    "user_id",
    "credential_version",
    "code_hash",
    "requested_at",
  ],
  user_workspace_v1: ["id", "uid", "user_id", "label", "time_created", "time_modified"],
  workspace_category_v1: ["id", "workspace_id", "label", "category_embedding"],
  workspace_subcategory_v1: ["id", "category_id", "label", "time_created", "time_modified"],
  workspace_status_v1: ["id", "workspace_id", "label", "position"],
  workspace_tag_v1: ["id", "workspace_id", "label", "tag_embedding"],
  workspace_item_v1: [
    "id",
    "uid",
    "workspace_id",
    "category_id",
    "subcategory_id",
    "status_id",
    "description",
    "description_embedding",
    "time_start",
    "time_end",
  ],
  item_tag_link_v1: ["item_id", "tag_id", "workspace_id"],
  user_item_trash_v1: ["id", "user_id", "workspace_id", "workspace_label", "item", "time_deleted"],
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

const staleItemColumns = await client.query(
  `SELECT column_name FROM information_schema.columns
   WHERE table_schema='public' AND table_name='workspace_item_v1'
     AND column_name=ANY($1::text[])`,
  [["user_id", "time_planned"]],
)
if (staleItemColumns.rowCount !== 0)
  throw new Error(
    `Stale workspace_item_v1 columns remain: ${staleItemColumns.rows
      .map((row) => row.column_name)
      .join(", ")}`,
  )

const constraints = [
  "user_password_reset_v1_pkey",
  "user_password_reset_v1_user_id_fkey",
  "user_workspace_v1_user_id_label_key",
  "user_workspace_v1_uid_key",
  "workspace_item_v1_uid_key",
  "workspace_category_v1_workspace_id_label_key",
  "workspace_category_v1_label_not_reserved_check",
  "workspace_status_v1_workspace_id_label_key",
  "workspace_tag_v1_workspace_id_label_key",
  "workspace_item_v1_status_workspace_fkey",
  "workspace_item_v1_category_workspace_fkey",
  "workspace_item_v1_subcategory_category_fkey",
  "workspace_item_v1_subcategory_requires_category_check",
  "workspace_item_v1_time_block_complete_check",
  "workspace_item_v1_time_block_order_check",
  "workspace_item_v1_content_check",
  "workspace_item_v1_status_requires_text_check",
  "workspace_subcategory_v1_category_id_fkey",
  "workspace_subcategory_v1_category_id_label_key",
  "workspace_subcategory_v1_id_category_id_key",
  "workspace_subcategory_v1_label_normalized_check",
  "item_tag_link_v1_item_workspace_fkey",
  "item_tag_link_v1_tag_workspace_fkey",
  "user_item_trash_v1_user_id_fkey",
  "user_item_trash_v1_workspace_id_fkey",
  "user_item_trash_v1_item_object_check",
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
  "workspace_category_v1_workspace_id_idx",
  "workspace_status_v1_workspace_id_position_idx",
  "workspace_tag_v1_workspace_id_idx",
  "workspace_item_v1_workspace_id_idx",
  "workspace_item_v1_status_id_idx",
  "workspace_item_v1_category_id_idx",
  "workspace_item_v1_subcategory_id_idx",
  "workspace_item_v1_workspace_id_time_start_idx",
  "item_tag_link_v1_tag_id_idx",
  "workspace_category_v1_category_embedding_hnsw_idx",
  "workspace_tag_v1_tag_embedding_hnsw_idx",
  "workspace_item_v1_description_embedding_hnsw_idx",
  "user_item_trash_v1_user_id_time_deleted_idx",
  "user_item_trash_v1_workspace_id_idx",
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
const timestampFunction = await client.query(
  `SELECT prosrc FROM pg_proc WHERE oid='public.apply_row_timestamps_v1()'::regprocedure`,
)
if (
  !timestampFunction.rows[0].prosrc.includes(
    "NEW.time_modified := COALESCE(NEW.time_modified, CURRENT_TIMESTAMP)",
  )
)
  throw new Error("Timestamp trigger must preserve imported modification dates on insert")
if (!timestampFunction.rows[0].prosrc.includes("current_setting('app.keep_time_modified', true)"))
  throw new Error("Timestamp trigger must keep the modification time of a re-homed row on request")
for (const table of [
  "user_v1",
  "user_workspace_v1",
  "workspace_category_v1",
  "workspace_subcategory_v1",
  "workspace_status_v1",
  "workspace_tag_v1",
  "workspace_item_v1",
]) {
  const name = `${table}_apply_row_timestamps_v1`
  if (!triggerSet.has(name)) throw new Error(`Missing expected trigger: ${name}`)
}

const invalid = await client.query(`SELECT
 (SELECT COUNT(*) FROM public.workspace_item_v1 n LEFT JOIN public.user_workspace_v1 w ON w.id=n.workspace_id WHERE w.id IS NULL)::int orphan_items,
 (SELECT COUNT(*) FROM public.item_tag_link_v1 l JOIN public.workspace_item_v1 n ON n.id=l.item_id JOIN public.workspace_tag_v1 t ON t.id=l.tag_id WHERE l.workspace_id<>n.workspace_id OR l.workspace_id<>t.workspace_id)::int bad_tags`)
if (Object.values(invalid.rows[0]).some((value) => Number(value) !== 0))
  throw new Error(`Workspace relation invariant failed: ${JSON.stringify(invalid.rows[0])}`)

// The item foreign keys must not unfile or delete on their own: removing a category
// or subcategory in use is the group engine's decision, and a subcategory that moves
// to another category takes its items along.
const filingActions = await client.query(
  `SELECT conname,confdeltype,confupdtype FROM pg_constraint
   WHERE conname=ANY($1::text[]) ORDER BY conname`,
  [["workspace_item_v1_category_workspace_fkey", "workspace_item_v1_subcategory_category_fkey"]],
)
if (
  JSON.stringify(filingActions.rows) !==
  JSON.stringify([
    { conname: "workspace_item_v1_category_workspace_fkey", confdeltype: "a", confupdtype: "a" },
    { conname: "workspace_item_v1_subcategory_category_fkey", confdeltype: "a", confupdtype: "c" },
  ])
)
  throw new Error(
    `Unexpected item filing constraint actions: ${JSON.stringify(filingActions.rows)}`,
  )

const reservedCategories = await client.query(`SELECT label FROM public.workspace_category_v1`)
const appContract = JSON.parse(
  readFileSync(new URL("../generated/contracts/items-app.json", import.meta.url), "utf8"),
)
for (const [name, expected] of Object.entries({
  ItemGroupTarget: [
    "CategoryItemGroupTarget",
    "SubcategoryItemGroupTarget",
    "UncategorizedItemGroupTarget",
    "SingleItemGroupTarget",
  ],
  ItemGroupAction: [
    "RenameItemGroupAction",
    "DeleteItemGroupAction",
    "MoveItemGroupAction",
    "MoveToWorkspaceAction",
  ],
})) {
  const model = appContract.models[name]
  if (
    model?.kind !== "union" ||
    JSON.stringify(model.variants.map((variant) => variant.type)) !== JSON.stringify(expected)
  )
    throw new Error(`Missing tagged union contract: ${name}`)
}
// Match application trim(), including Unicode whitespace the old SQL btrim()
// default did not remove. Do not let the verifier repeat that same blind spot.
if (reservedCategories.rows.some(({ label }) => label.trim().toLowerCase() === "uncategorized"))
  throw new Error("uncategorized is reserved display text, not a category row")

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
// Every item column and item-referencing table must be owned by a registry entry.
run("node", ["--import", "tsx", "scripts/audit-item-storage.ts"])
run("git", [
  "diff",
  "--exit-code",
  "--",
  "schema/current.sql",
  "generated/contracts/items-app.json",
  "generated/typescript/db-types.ts",
  "generated/contracts/db-schema.json",
])
console.log("Items DB contract verification passed")
