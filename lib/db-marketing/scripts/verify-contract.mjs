import { execFileSync } from "node:child_process";
import process from "node:process";
import { Client } from "pg";

if (!process.env.MARKETING_DB_URL) {
  throw new Error("MARKETING_DB_URL is required");
}

function run(command, args) {
  execFileSync(command, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
  });
}

function getScalar(rows, column) {
  return rows[0]?.[column];
}

run("node", ["scripts/migrate.mjs"]);
run("bash", ["scripts/snapshot-schema.sh"]);
run("node", ["scripts/generate-types.mjs"]);
run("node", ["scripts/generate-app-contract.mjs", "--write"]);

const client = new Client({ connectionString: process.env.MARKETING_DB_URL });
await client.connect();

const tablesResult = await client.query(`
  SELECT table_name
  FROM information_schema.tables
  WHERE table_schema = 'public'
    AND table_name IN (
      'user_v1',
      'user_note_v1',
      'user_note_category_v1',
      'user_note_tag_v1',
      'user_note_tag_link_v1'
    )
  ORDER BY table_name
`);

const existingTables = new Set(tablesResult.rows.map((row) => row.table_name));
for (const table of [
  "user_v1",
  "user_note_v1",
  "user_note_category_v1",
  "user_note_tag_v1",
  "user_note_tag_link_v1",
]) {
  if (!existingTables.has(table)) {
    throw new Error(`Missing expected table: ${table}`);
  }
}

const usernameConstraintResult = await client.query(`
  SELECT COUNT(*)::int AS count
  FROM pg_constraint
  WHERE conname = 'user_v1_username_key'
`);

if (getScalar(usernameConstraintResult.rows, "count") !== 1) {
  throw new Error("Missing expected unique constraint: user_v1_username_key");
}

const userPhoneColumnResult = await client.query(`
  SELECT data_type
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'user_v1'
    AND column_name = 'phone'
`);

if (getScalar(userPhoneColumnResult.rows, "data_type") !== "text") {
  throw new Error("Expected public.user_v1.phone to use the text type");
}

const userPreferencesColumnResult = await client.query(`
  SELECT data_type, is_nullable
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'user_v1'
    AND column_name = 'preferences'
`);

if (!userPreferencesColumnResult.rows[0]) {
  throw new Error("Missing expected column on user_v1: preferences");
}

if (getScalar(userPreferencesColumnResult.rows, "data_type") !== "jsonb") {
  throw new Error("Expected public.user_v1.preferences to use the jsonb type");
}

if (getScalar(userPreferencesColumnResult.rows, "is_nullable") !== "NO") {
  throw new Error("Expected public.user_v1.preferences to be NOT NULL");
}

const userPreferencesObjectCheckResult = await client.query(`
  SELECT COUNT(*)::int AS count
  FROM pg_constraint
  WHERE conname = 'user_v1_preferences_object_check'
`);

if (getScalar(userPreferencesObjectCheckResult.rows, "count") !== 1) {
  throw new Error("Missing expected check constraint: user_v1_preferences_object_check");
}

const noteFkResult = await client.query(`
  SELECT COUNT(*)::int AS count
  FROM pg_constraint
  WHERE conname = 'user_note_v1_user_id_fkey'
`);

if (getScalar(noteFkResult.rows, "count") !== 1) {
  throw new Error(
    "Missing expected foreign key constraint: user_note_v1_user_id_fkey"
  );
}

const noteCategoryFkResult = await client.query(`
  SELECT COUNT(*)::int AS count
  FROM pg_constraint
  WHERE conname = 'user_note_v1_category_id_fkey'
`);

if (getScalar(noteCategoryFkResult.rows, "count") !== 1) {
  throw new Error(
    "Missing expected foreign key constraint: user_note_v1_category_id_fkey"
  );
}

const noteCategoryUserFkResult = await client.query(`
  SELECT COUNT(*)::int AS count
  FROM pg_constraint
  WHERE conname = 'user_note_category_v1_user_id_fkey'
`);

if (getScalar(noteCategoryUserFkResult.rows, "count") !== 1) {
  throw new Error(
    "Missing expected foreign key constraint: user_note_category_v1_user_id_fkey"
  );
}

const noteCategoryUniqueResult = await client.query(`
  SELECT COUNT(*)::int AS count
  FROM pg_constraint
  WHERE conname = 'user_note_category_v1_user_id_label_key'
`);

if (getScalar(noteCategoryUniqueResult.rows, "count") !== 1) {
  throw new Error(
    "Missing expected unique constraint: user_note_category_v1_user_id_label_key"
  );
}

const noteCategoryLowercaseCheckResult = await client.query(`
  SELECT COUNT(*)::int AS count
  FROM pg_constraint
  WHERE conname = 'user_note_category_v1_label_lowercase_check'
`);

if (getScalar(noteCategoryLowercaseCheckResult.rows, "count") !== 1) {
  throw new Error(
    "Missing expected check constraint: user_note_category_v1_label_lowercase_check"
  );
}

const linkNoteFkResult = await client.query(`
  SELECT COUNT(*)::int AS count
  FROM pg_constraint
  WHERE conname = 'user_note_tag_link_v1_note_id_fkey'
`);

if (getScalar(linkNoteFkResult.rows, "count") !== 1) {
  throw new Error(
    "Missing expected foreign key constraint: user_note_tag_link_v1_note_id_fkey"
  );
}

const linkTagFkResult = await client.query(`
  SELECT COUNT(*)::int AS count
  FROM pg_constraint
  WHERE conname = 'user_note_tag_link_v1_tag_id_fkey'
`);

if (getScalar(linkTagFkResult.rows, "count") !== 1) {
  throw new Error(
    "Missing expected foreign key constraint: user_note_tag_link_v1_tag_id_fkey"
  );
}

const noteTagUserFkResult = await client.query(`
  SELECT COUNT(*)::int AS count
  FROM pg_constraint
  WHERE conname = 'user_note_tag_v1_user_id_fkey'
`);

if (getScalar(noteTagUserFkResult.rows, "count") !== 1) {
  throw new Error(
    "Missing expected foreign key constraint: user_note_tag_v1_user_id_fkey"
  );
}

const noteTagUniqueResult = await client.query(`
  SELECT COUNT(*)::int AS count
  FROM pg_constraint
  WHERE conname = 'user_note_tag_v1_user_id_label_key'
`);

if (getScalar(noteTagUniqueResult.rows, "count") !== 1) {
  throw new Error(
    "Missing expected unique constraint: user_note_tag_v1_user_id_label_key"
  );
}

const noteTagLowercaseCheckResult = await client.query(`
  SELECT COUNT(*)::int AS count
  FROM pg_constraint
  WHERE conname = 'user_note_tag_v1_label_lowercase_check'
`);

if (getScalar(noteTagLowercaseCheckResult.rows, "count") !== 1) {
  throw new Error(
    "Missing expected check constraint: user_note_tag_v1_label_lowercase_check"
  );
}

const legacyNoteTagColumnResult = await client.query(`
  SELECT COUNT(*)::int AS count
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'user_note_v1'
    AND column_name = 'tag'
`);

if (getScalar(legacyNoteTagColumnResult.rows, "count") !== 0) {
  throw new Error(
    "Expected public.user_note_v1.tag to be removed (many-to-many uses user_note_tag_link_v1)"
  );
}

const vectorExtensionResult = await client.query(`
  SELECT COUNT(*)::int AS count
  FROM pg_extension
  WHERE extname = 'vector'
`);

if (getScalar(vectorExtensionResult.rows, "count") !== 1) {
  throw new Error("Missing expected extension: vector");
}

const noteEmbeddingColumnsResult = await client.query(`
  SELECT column_name
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'user_note_v1'
    AND column_name IN (
      'description_embedding',
      'embedding_model',
      'embedding_updated_at'
    )
  ORDER BY column_name
`);

const existingNoteEmbeddingColumns = new Set(
  noteEmbeddingColumnsResult.rows.map((row) => row.column_name)
);

for (const column of [
  "description_embedding",
  "embedding_model",
  "embedding_updated_at",
]) {
  if (!existingNoteEmbeddingColumns.has(column)) {
    throw new Error(`Missing expected column on user_note_v1: ${column}`);
  }
}

const noteCategoryColumnResult = await client.query(`
  SELECT is_nullable
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'user_note_v1'
    AND column_name = 'category_id'
`);

if (!noteCategoryColumnResult.rows[0]) {
  throw new Error("Missing expected column on user_note_v1: category_id");
}

if (getScalar(noteCategoryColumnResult.rows, "is_nullable") !== "NO") {
  throw new Error("Expected public.user_note_v1.category_id to be NOT NULL");
}

const noteOptionalDateColumnsResult = await client.query(`
  SELECT column_name, is_nullable
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'user_note_v1'
    AND column_name IN ('time_due', 'time_remind')
`);

const noteOptionalDateColumns = new Map(
  noteOptionalDateColumnsResult.rows.map((row) => [row.column_name, row.is_nullable])
);

for (const column of ["time_due", "time_remind"]) {
  if (!noteOptionalDateColumns.has(column)) {
    throw new Error(`Missing expected column on user_note_v1: ${column}`);
  }

  if (noteOptionalDateColumns.get(column) !== "YES") {
    throw new Error(`Expected public.user_note_v1.${column} to be nullable`);
  }
}

const categoryEmbeddingColumnsResult = await client.query(`
  SELECT column_name
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'user_note_category_v1'
    AND column_name IN (
      'category_embedding',
      'embedding_model',
      'embedding_updated_at'
    )
  ORDER BY column_name
`);

const existingCategoryEmbeddingColumns = new Set(
  categoryEmbeddingColumnsResult.rows.map((row) => row.column_name)
);

for (const column of [
  "category_embedding",
  "embedding_model",
  "embedding_updated_at",
]) {
  if (!existingCategoryEmbeddingColumns.has(column)) {
    throw new Error(`Missing expected column on user_note_category_v1: ${column}`);
  }
}

const droppedNoteColumnsResult = await client.query(`
  SELECT COUNT(*)::int AS count
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'user_note_v1'
    AND column_name = 'content_embedding'
`);

if (getScalar(droppedNoteColumnsResult.rows, "count") !== 0) {
  throw new Error(
    "Expected public.user_note_v1.content_embedding to be removed (dropped by 202604081300 migration)"
  );
}

const tagEmbeddingColumnsResult = await client.query(`
  SELECT column_name
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'user_note_tag_v1'
    AND column_name IN (
      'tag_embedding',
      'embedding_model',
      'embedding_updated_at'
    )
  ORDER BY column_name
`);

const existingTagEmbeddingColumns = new Set(
  tagEmbeddingColumnsResult.rows.map((row) => row.column_name)
);

for (const column of [
  "tag_embedding",
  "embedding_model",
  "embedding_updated_at",
]) {
  if (!existingTagEmbeddingColumns.has(column)) {
    throw new Error(`Missing expected column on user_note_tag_v1: ${column}`);
  }
}

const noteIndexResult = await client.query(`
  SELECT COUNT(*)::int AS count
  FROM pg_indexes
  WHERE schemaname = 'public'
    AND indexname = 'user_note_v1_user_id_idx'
`);

if (getScalar(noteIndexResult.rows, "count") !== 1) {
  throw new Error("Missing expected index: user_note_v1_user_id_idx");
}

const noteTagIndexResult = await client.query(`
  SELECT COUNT(*)::int AS count
  FROM pg_indexes
  WHERE schemaname = 'public'
    AND indexname = 'user_note_tag_v1_user_id_idx'
`);

if (getScalar(noteTagIndexResult.rows, "count") !== 1) {
  throw new Error("Missing expected index: user_note_tag_v1_user_id_idx");
}

const noteCategoryIndexResult = await client.query(`
  SELECT COUNT(*)::int AS count
  FROM pg_indexes
  WHERE schemaname = 'public'
    AND indexname = 'user_note_category_v1_user_id_idx'
`);

if (getScalar(noteCategoryIndexResult.rows, "count") !== 1) {
  throw new Error("Missing expected index: user_note_category_v1_user_id_idx");
}

const noteCategoryForeignKeyIndexResult = await client.query(`
  SELECT COUNT(*)::int AS count
  FROM pg_indexes
  WHERE schemaname = 'public'
    AND indexname = 'user_note_v1_category_id_idx'
`);

if (getScalar(noteCategoryForeignKeyIndexResult.rows, "count") !== 1) {
  throw new Error("Missing expected index: user_note_v1_category_id_idx");
}

const droppedContentEmbeddingIndexResult = await client.query(`
  SELECT COUNT(*)::int AS count
  FROM pg_indexes
  WHERE schemaname = 'public'
    AND indexname = 'user_note_v1_content_embedding_hnsw_idx'
`);

if (getScalar(droppedContentEmbeddingIndexResult.rows, "count") !== 0) {
  throw new Error(
    "Expected index user_note_v1_content_embedding_hnsw_idx to be removed (dropped by 202604081300 migration)"
  );
}

const tagTableEmbeddingIndexResult = await client.query(`
  SELECT COUNT(*)::int AS count
  FROM pg_indexes
  WHERE schemaname = 'public'
    AND indexname = 'user_note_tag_v1_tag_embedding_hnsw_idx'
`);

if (getScalar(tagTableEmbeddingIndexResult.rows, "count") !== 1) {
  throw new Error(
    "Missing expected index: user_note_tag_v1_tag_embedding_hnsw_idx"
  );
}

const categoryTableEmbeddingIndexResult = await client.query(`
  SELECT COUNT(*)::int AS count
  FROM pg_indexes
  WHERE schemaname = 'public'
    AND indexname = 'user_note_category_v1_category_embedding_hnsw_idx'
`);

if (getScalar(categoryTableEmbeddingIndexResult.rows, "count") !== 1) {
  throw new Error(
    "Missing expected index: user_note_category_v1_category_embedding_hnsw_idx"
  );
}

const linkTagIdIndexResult = await client.query(`
  SELECT COUNT(*)::int AS count
  FROM pg_indexes
  WHERE schemaname = 'public'
    AND indexname = 'user_note_tag_link_v1_tag_id_idx'
`);

if (getScalar(linkTagIdIndexResult.rows, "count") !== 1) {
  throw new Error(
    "Missing expected index: user_note_tag_link_v1_tag_id_idx"
  );
}

const noteDescriptionEmbeddingIndexResult = await client.query(`
  SELECT COUNT(*)::int AS count
  FROM pg_indexes
  WHERE schemaname = 'public'
    AND indexname = 'user_note_v1_description_embedding_hnsw_idx'
`);

if (getScalar(noteDescriptionEmbeddingIndexResult.rows, "count") !== 1) {
  throw new Error(
    "Missing expected index: user_note_v1_description_embedding_hnsw_idx"
  );
}

const rowTimestampFunctionResult = await client.query(`
  SELECT COUNT(*)::int AS count
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'apply_row_timestamps_v1'
`);

if (getScalar(rowTimestampFunctionResult.rows, "count") !== 1) {
  throw new Error("Missing expected trigger function: apply_row_timestamps_v1");
}

const rowTimestampTriggersResult = await client.query(`
  SELECT COUNT(*)::int AS count
  FROM pg_trigger
  WHERE NOT tgisinternal
    AND tgname IN (
      'user_v1_apply_row_timestamps_v1',
      'user_note_v1_apply_row_timestamps_v1',
      'user_note_category_v1_apply_row_timestamps_v1',
      'user_note_tag_v1_apply_row_timestamps_v1'
    )
`);

if (getScalar(rowTimestampTriggersResult.rows, "count") !== 4) {
  throw new Error("Missing expected row timestamp triggers");
}

await client.end();

run("git", [
  "diff",
  "--exit-code",
  "--",
  "schema/current.sql",
  "generated/contracts/notes-app.json",
  "generated/typescript/db-types.ts",
  "generated/contracts/db-schema.json",
]);

console.log("Marketing DB contract verification passed");
