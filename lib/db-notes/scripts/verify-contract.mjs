import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import process from "node:process"
import { Client } from "pg"

if (!process.env.DB_NOTES_URL) {
  throw new Error("DB_NOTES_URL is required")
}

function run(command, args) {
  execFileSync(command, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
  })
}

function getScalar(rows, column) {
  return rows[0]?.[column]
}

run("node", ["scripts/migrate.mjs"])
run("bash", ["scripts/snapshot-schema.sh"])
run("node", ["scripts/generate-types.mjs"])
run("node", ["scripts/generate-app-contract.mjs", "--write"])

const client = new Client({ connectionString: process.env.DB_NOTES_URL })
await client.connect()

const tablesResult = await client.query(`
  SELECT table_name
  FROM information_schema.tables
  WHERE table_schema = 'public'
    AND table_name IN (
      'user_v1',
      'user_api_token_v1',
      'user_note_v1',
      'user_note_category_v1',
      'user_note_tag_v1',
      'user_note_tag_link_v1',
      'user_taxonomy_level_v1',
      'user_taxonomy_v1'
    )
  ORDER BY table_name
`)

const existingTables = new Set(tablesResult.rows.map((row) => row.table_name))
for (const table of [
  "user_v1",
  "user_api_token_v1",
  "user_note_v1",
  "user_note_category_v1",
  "user_note_tag_v1",
  "user_note_tag_link_v1",
  "user_taxonomy_level_v1",
  "user_taxonomy_v1",
]) {
  if (!existingTables.has(table)) {
    throw new Error(`Missing expected table: ${table}`)
  }
}

const usernameConstraintResult = await client.query(`
  SELECT COUNT(*)::int AS count
  FROM pg_constraint
  WHERE conname = 'user_v1_username_key'
`)

if (getScalar(usernameConstraintResult.rows, "count") !== 1) {
  throw new Error("Missing expected unique constraint: user_v1_username_key")
}

const userPhoneColumnResult = await client.query(`
  SELECT data_type
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'user_v1'
    AND column_name = 'phone'
`)

if (getScalar(userPhoneColumnResult.rows, "data_type") !== "text") {
  throw new Error("Expected public.user_v1.phone to use the text type")
}

const userPreferencesColumnResult = await client.query(`
  SELECT data_type, is_nullable
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'user_v1'
    AND column_name = 'preferences'
`)

if (!userPreferencesColumnResult.rows[0]) {
  throw new Error("Missing expected column on user_v1: preferences")
}

if (getScalar(userPreferencesColumnResult.rows, "data_type") !== "jsonb") {
  throw new Error("Expected public.user_v1.preferences to use the jsonb type")
}

if (getScalar(userPreferencesColumnResult.rows, "is_nullable") !== "NO") {
  throw new Error("Expected public.user_v1.preferences to be NOT NULL")
}

const userPreferencesObjectCheckResult = await client.query(`
  SELECT COUNT(*)::int AS count
  FROM pg_constraint
  WHERE conname = 'user_v1_preferences_object_check'
`)

if (getScalar(userPreferencesObjectCheckResult.rows, "count") !== 1) {
  throw new Error("Missing expected check constraint: user_v1_preferences_object_check")
}

const userPasswordColumnResult = await client.query(`
  SELECT data_type, is_nullable
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'user_v1'
    AND column_name = 'password'
`)

if (!userPasswordColumnResult.rows[0]) {
  throw new Error("Missing expected column on user_v1: password")
}

if (getScalar(userPasswordColumnResult.rows, "data_type") !== "text") {
  throw new Error("Expected public.user_v1.password to use the text type")
}

if (getScalar(userPasswordColumnResult.rows, "is_nullable") !== "YES") {
  throw new Error("Expected public.user_v1.password to be nullable")
}

const userIsAnonymousColumnResult = await client.query(`
  SELECT data_type, is_nullable, column_default
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'user_v1'
    AND column_name = 'is_anonymous'
`)

if (!userIsAnonymousColumnResult.rows[0]) {
  throw new Error("Missing expected column on user_v1: is_anonymous")
}

if (getScalar(userIsAnonymousColumnResult.rows, "data_type") !== "boolean") {
  throw new Error("Expected public.user_v1.is_anonymous to use the boolean type")
}

if (getScalar(userIsAnonymousColumnResult.rows, "is_nullable") !== "NO") {
  throw new Error("Expected public.user_v1.is_anonymous to be NOT NULL")
}

const userIsAnonymousIndexResult = await client.query(`
  SELECT COUNT(*)::int AS count
  FROM pg_indexes
  WHERE schemaname = 'public'
    AND tablename = 'user_v1'
    AND indexname = 'user_v1_is_anonymous_idx'
`)

if (getScalar(userIsAnonymousIndexResult.rows, "count") !== 1) {
  throw new Error("Missing expected index: user_v1_is_anonymous_idx")
}

const apiTokenUserFkResult = await client.query(`
  SELECT COUNT(*)::int AS count
  FROM pg_constraint
  WHERE conname = 'user_api_token_v1_user_id_fkey'
`)

if (getScalar(apiTokenUserFkResult.rows, "count") !== 1) {
  throw new Error("Missing expected foreign key constraint: user_api_token_v1_user_id_fkey")
}

const apiTokenHashUniqueResult = await client.query(`
  SELECT COUNT(*)::int AS count
  FROM pg_constraint
  WHERE conname = 'user_api_token_v1_token_hash_key'
`)

if (getScalar(apiTokenHashUniqueResult.rows, "count") !== 1) {
  throw new Error("Missing expected unique constraint: user_api_token_v1_token_hash_key")
}

const apiTokenUserIndexResult = await client.query(`
  SELECT COUNT(*)::int AS count
  FROM pg_indexes
  WHERE schemaname = 'public'
    AND tablename = 'user_api_token_v1'
    AND indexname = 'user_api_token_v1_user_id_idx'
`)

if (getScalar(apiTokenUserIndexResult.rows, "count") !== 1) {
  throw new Error("Missing expected index: user_api_token_v1_user_id_idx")
}

const apiTokenHashColumnResult = await client.query(`
  SELECT data_type, is_nullable
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'user_api_token_v1'
    AND column_name = 'token_hash'
`)

if (!apiTokenHashColumnResult.rows[0]) {
  throw new Error("Missing expected column on user_api_token_v1: token_hash")
}

if (getScalar(apiTokenHashColumnResult.rows, "data_type") !== "text") {
  throw new Error("Expected public.user_api_token_v1.token_hash to use the text type")
}

if (getScalar(apiTokenHashColumnResult.rows, "is_nullable") !== "NO") {
  throw new Error("Expected public.user_api_token_v1.token_hash to be NOT NULL")
}

const noteFkResult = await client.query(`
  SELECT COUNT(*)::int AS count
  FROM pg_constraint
  WHERE conname = 'user_note_v1_user_id_fkey'
`)

if (getScalar(noteFkResult.rows, "count") !== 1) {
  throw new Error("Missing expected foreign key constraint: user_note_v1_user_id_fkey")
}

const noteCategoryFkResult = await client.query(`
  SELECT COUNT(*)::int AS count
  FROM pg_constraint
  WHERE conname = 'user_note_v1_category_id_fkey'
`)

if (getScalar(noteCategoryFkResult.rows, "count") !== 1) {
  throw new Error("Missing expected foreign key constraint: user_note_v1_category_id_fkey")
}

const noteCategoryUserFkResult = await client.query(`
  SELECT COUNT(*)::int AS count
  FROM pg_constraint
  WHERE conname = 'user_note_category_v1_user_id_fkey'
`)

if (getScalar(noteCategoryUserFkResult.rows, "count") !== 1) {
  throw new Error("Missing expected foreign key constraint: user_note_category_v1_user_id_fkey")
}

const noteCategoryUniqueResult = await client.query(`
  SELECT COUNT(*)::int AS count
  FROM pg_constraint
  WHERE conname = 'user_note_category_v1_user_id_label_key'
`)

if (getScalar(noteCategoryUniqueResult.rows, "count") !== 1) {
  throw new Error("Missing expected unique constraint: user_note_category_v1_user_id_label_key")
}

const noteCategoryLowercaseCheckResult = await client.query(`
  SELECT COUNT(*)::int AS count
  FROM pg_constraint
  WHERE conname = 'user_note_category_v1_label_lowercase_check'
`)

if (getScalar(noteCategoryLowercaseCheckResult.rows, "count") !== 1) {
  throw new Error("Missing expected check constraint: user_note_category_v1_label_lowercase_check")
}

const linkNoteFkResult = await client.query(`
  SELECT COUNT(*)::int AS count
  FROM pg_constraint
  WHERE conname = 'user_note_tag_link_v1_note_id_fkey'
`)

if (getScalar(linkNoteFkResult.rows, "count") !== 1) {
  throw new Error("Missing expected foreign key constraint: user_note_tag_link_v1_note_id_fkey")
}

const linkTagFkResult = await client.query(`
  SELECT COUNT(*)::int AS count
  FROM pg_constraint
  WHERE conname = 'user_note_tag_link_v1_tag_id_fkey'
`)

if (getScalar(linkTagFkResult.rows, "count") !== 1) {
  throw new Error("Missing expected foreign key constraint: user_note_tag_link_v1_tag_id_fkey")
}

const noteTagUserFkResult = await client.query(`
  SELECT COUNT(*)::int AS count
  FROM pg_constraint
  WHERE conname = 'user_note_tag_v1_user_id_fkey'
`)

if (getScalar(noteTagUserFkResult.rows, "count") !== 1) {
  throw new Error("Missing expected foreign key constraint: user_note_tag_v1_user_id_fkey")
}

const noteTagUniqueResult = await client.query(`
  SELECT COUNT(*)::int AS count
  FROM pg_constraint
  WHERE conname = 'user_note_tag_v1_user_id_label_key'
`)

if (getScalar(noteTagUniqueResult.rows, "count") !== 1) {
  throw new Error("Missing expected unique constraint: user_note_tag_v1_user_id_label_key")
}

const noteTagLowercaseCheckResult = await client.query(`
  SELECT COUNT(*)::int AS count
  FROM pg_constraint
  WHERE conname = 'user_note_tag_v1_label_lowercase_check'
`)

if (getScalar(noteTagLowercaseCheckResult.rows, "count") !== 1) {
  throw new Error("Missing expected check constraint: user_note_tag_v1_label_lowercase_check")
}

const legacyNoteTagColumnResult = await client.query(`
  SELECT COUNT(*)::int AS count
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'user_note_v1'
    AND column_name = 'tag'
`)

if (getScalar(legacyNoteTagColumnResult.rows, "count") !== 0) {
  throw new Error(
    "Expected public.user_note_v1.tag to be removed (many-to-many uses user_note_tag_link_v1)",
  )
}

const vectorExtensionResult = await client.query(`
  SELECT COUNT(*)::int AS count
  FROM pg_extension
  WHERE extname = 'vector'
`)

if (getScalar(vectorExtensionResult.rows, "count") !== 1) {
  throw new Error("Missing expected extension: vector")
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
`)

const existingNoteEmbeddingColumns = new Set(
  noteEmbeddingColumnsResult.rows.map((row) => row.column_name),
)

for (const column of ["description_embedding", "embedding_model", "embedding_updated_at"]) {
  if (!existingNoteEmbeddingColumns.has(column)) {
    throw new Error(`Missing expected column on user_note_v1: ${column}`)
  }
}

const noteCategoryColumnResult = await client.query(`
  SELECT is_nullable
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'user_note_v1'
    AND column_name = 'category_id'
`)

if (!noteCategoryColumnResult.rows[0]) {
  throw new Error("Missing expected column on user_note_v1: category_id")
}

if (getScalar(noteCategoryColumnResult.rows, "is_nullable") !== "NO") {
  throw new Error("Expected public.user_note_v1.category_id to be NOT NULL")
}

const noteOptionalDateColumnsResult = await client.query(`
  SELECT column_name, is_nullable
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'user_note_v1'
    AND column_name IN ('time_due', 'time_remind')
`)

const noteOptionalDateColumns = new Map(
  noteOptionalDateColumnsResult.rows.map((row) => [row.column_name, row.is_nullable]),
)

for (const column of ["time_due", "time_remind"]) {
  if (!noteOptionalDateColumns.has(column)) {
    throw new Error(`Missing expected column on user_note_v1: ${column}`)
  }

  if (noteOptionalDateColumns.get(column) !== "YES") {
    throw new Error(`Expected public.user_note_v1.${column} to be nullable`)
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
`)

const existingCategoryEmbeddingColumns = new Set(
  categoryEmbeddingColumnsResult.rows.map((row) => row.column_name),
)

for (const column of ["category_embedding", "embedding_model", "embedding_updated_at"]) {
  if (!existingCategoryEmbeddingColumns.has(column)) {
    throw new Error(`Missing expected column on user_note_category_v1: ${column}`)
  }
}

const droppedNoteColumnsResult = await client.query(`
  SELECT COUNT(*)::int AS count
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'user_note_v1'
    AND column_name = 'content_embedding'
`)

if (getScalar(droppedNoteColumnsResult.rows, "count") !== 0) {
  throw new Error(
    "Expected public.user_note_v1.content_embedding to be removed (dropped by 202604081300 migration)",
  )
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
`)

const existingTagEmbeddingColumns = new Set(
  tagEmbeddingColumnsResult.rows.map((row) => row.column_name),
)

for (const column of ["tag_embedding", "embedding_model", "embedding_updated_at"]) {
  if (!existingTagEmbeddingColumns.has(column)) {
    throw new Error(`Missing expected column on user_note_tag_v1: ${column}`)
  }
}

const noteIndexResult = await client.query(`
  SELECT COUNT(*)::int AS count
  FROM pg_indexes
  WHERE schemaname = 'public'
    AND indexname = 'user_note_v1_user_id_idx'
`)

if (getScalar(noteIndexResult.rows, "count") !== 1) {
  throw new Error("Missing expected index: user_note_v1_user_id_idx")
}

const noteTagIndexResult = await client.query(`
  SELECT COUNT(*)::int AS count
  FROM pg_indexes
  WHERE schemaname = 'public'
    AND indexname = 'user_note_tag_v1_user_id_idx'
`)

if (getScalar(noteTagIndexResult.rows, "count") !== 1) {
  throw new Error("Missing expected index: user_note_tag_v1_user_id_idx")
}

const noteCategoryIndexResult = await client.query(`
  SELECT COUNT(*)::int AS count
  FROM pg_indexes
  WHERE schemaname = 'public'
    AND indexname = 'user_note_category_v1_user_id_idx'
`)

if (getScalar(noteCategoryIndexResult.rows, "count") !== 1) {
  throw new Error("Missing expected index: user_note_category_v1_user_id_idx")
}

const noteCategoryForeignKeyIndexResult = await client.query(`
  SELECT COUNT(*)::int AS count
  FROM pg_indexes
  WHERE schemaname = 'public'
    AND indexname = 'user_note_v1_category_id_idx'
`)

if (getScalar(noteCategoryForeignKeyIndexResult.rows, "count") !== 1) {
  throw new Error("Missing expected index: user_note_v1_category_id_idx")
}

const droppedContentEmbeddingIndexResult = await client.query(`
  SELECT COUNT(*)::int AS count
  FROM pg_indexes
  WHERE schemaname = 'public'
    AND indexname = 'user_note_v1_content_embedding_hnsw_idx'
`)

if (getScalar(droppedContentEmbeddingIndexResult.rows, "count") !== 0) {
  throw new Error(
    "Expected index user_note_v1_content_embedding_hnsw_idx to be removed (dropped by 202604081300 migration)",
  )
}

const tagTableEmbeddingIndexResult = await client.query(`
  SELECT COUNT(*)::int AS count
  FROM pg_indexes
  WHERE schemaname = 'public'
    AND indexname = 'user_note_tag_v1_tag_embedding_hnsw_idx'
`)

if (getScalar(tagTableEmbeddingIndexResult.rows, "count") !== 1) {
  throw new Error("Missing expected index: user_note_tag_v1_tag_embedding_hnsw_idx")
}

const categoryTableEmbeddingIndexResult = await client.query(`
  SELECT COUNT(*)::int AS count
  FROM pg_indexes
  WHERE schemaname = 'public'
    AND indexname = 'user_note_category_v1_category_embedding_hnsw_idx'
`)

if (getScalar(categoryTableEmbeddingIndexResult.rows, "count") !== 1) {
  throw new Error("Missing expected index: user_note_category_v1_category_embedding_hnsw_idx")
}

const linkTagIdIndexResult = await client.query(`
  SELECT COUNT(*)::int AS count
  FROM pg_indexes
  WHERE schemaname = 'public'
    AND indexname = 'user_note_tag_link_v1_tag_id_idx'
`)

if (getScalar(linkTagIdIndexResult.rows, "count") !== 1) {
  throw new Error("Missing expected index: user_note_tag_link_v1_tag_id_idx")
}

const noteDescriptionEmbeddingIndexResult = await client.query(`
  SELECT COUNT(*)::int AS count
  FROM pg_indexes
  WHERE schemaname = 'public'
    AND indexname = 'user_note_v1_description_embedding_hnsw_idx'
`)

if (getScalar(noteDescriptionEmbeddingIndexResult.rows, "count") !== 1) {
  throw new Error("Missing expected index: user_note_v1_description_embedding_hnsw_idx")
}

const rowTimestampFunctionResult = await client.query(`
  SELECT COUNT(*)::int AS count
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'apply_row_timestamps_v1'
`)

if (getScalar(rowTimestampFunctionResult.rows, "count") !== 1) {
  throw new Error("Missing expected trigger function: apply_row_timestamps_v1")
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
`)

if (getScalar(rowTimestampTriggersResult.rows, "count") !== 4) {
  throw new Error("Missing expected row timestamp triggers")
}

const defaultImportantTagResult = await client.query(`
  SELECT COUNT(*)::int AS missing
  FROM public.user_v1 u
  LEFT JOIN public.user_note_tag_v1 t
    ON t.user_id = u.id
   AND t.label = 'important'
  WHERE t.id IS NULL
`)

if (getScalar(defaultImportantTagResult.rows, "missing") !== 0) {
  throw new Error("Every user must have the default important tag")
}

// ---------------------------------------------------------------------------
// Taxonomy hierarchy: Epic > Category > Group > Note.
// ---------------------------------------------------------------------------

const taxonomyLevelColumnsResult = await client.query(`
  SELECT column_name, data_type, is_nullable
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'user_taxonomy_level_v1'
`)

const taxonomyLevelColumns = new Map(
  taxonomyLevelColumnsResult.rows.map((row) => [row.column_name, row]),
)

for (const [column, dataType, nullable] of [
  ["user_id", "integer", "NO"],
  ["level", "smallint", "NO"],
  ["label", "text", "NO"],
  ["time_created", "timestamp with time zone", "NO"],
  ["time_modified", "timestamp with time zone", "NO"],
]) {
  const found = taxonomyLevelColumns.get(column)
  if (!found) {
    throw new Error(`Missing expected column: public.user_taxonomy_level_v1.${column}`)
  }
  if (found.data_type !== dataType) {
    throw new Error(
      `Expected public.user_taxonomy_level_v1.${column} to be ${dataType}, found ${found.data_type}`,
    )
  }
  if (found.is_nullable !== nullable) {
    throw new Error(
      `Expected public.user_taxonomy_level_v1.${column} is_nullable=${nullable}, found ${found.is_nullable}`,
    )
  }
}

const taxonomyColumnsResult = await client.query(`
  SELECT column_name, data_type, udt_name, is_nullable
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'user_taxonomy_v1'
`)

const taxonomyColumns = new Map(taxonomyColumnsResult.rows.map((row) => [row.column_name, row]))

for (const [column, udtName, nullable] of [
  ["id", "int4", "NO"],
  ["user_id", "int4", "NO"],
  ["level", "int2", "NO"],
  ["parent_id", "int4", "YES"],
  ["parent_level", "int2", "YES"],
  ["label", "text", "NO"],
  ["label_embedding", "vector", "YES"],
  ["embedding_model", "text", "YES"],
  ["embedding_updated_at", "timestamptz", "YES"],
]) {
  const found = taxonomyColumns.get(column)
  if (!found) {
    throw new Error(`Missing expected column: public.user_taxonomy_v1.${column}`)
  }
  if (found.udt_name !== udtName) {
    throw new Error(
      `Expected public.user_taxonomy_v1.${column} to be ${udtName}, found ${found.udt_name}`,
    )
  }
  if (found.is_nullable !== nullable) {
    throw new Error(
      `Expected public.user_taxonomy_v1.${column} is_nullable=${nullable}, found ${found.is_nullable}`,
    )
  }
}

// parent_level must stay a generated column: the composite parent FK relies on
// it always being level - 1, and a plain column could be written directly.
const parentLevelGeneratedResult = await client.query(`
  SELECT is_generated, generation_expression
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'user_taxonomy_v1'
    AND column_name = 'parent_level'
`)

if (getScalar(parentLevelGeneratedResult.rows, "is_generated") !== "ALWAYS") {
  throw new Error("Expected public.user_taxonomy_v1.parent_level to be a generated column")
}

const taxonomyConstraintsResult = await client.query(`
  SELECT conname
  FROM pg_constraint
  WHERE conname IN (
    'user_taxonomy_level_v1_pkey',
    'user_taxonomy_level_v1_user_id_fkey',
    'user_taxonomy_level_v1_level_check',
    'user_taxonomy_level_v1_label_not_blank_check',
    'user_taxonomy_v1_user_id_fkey',
    'user_taxonomy_v1_level_check',
    'user_taxonomy_v1_level_fkey',
    'user_taxonomy_v1_label_lowercase_check',
    'user_taxonomy_v1_root_parent_check',
    'user_taxonomy_v1_id_level_user_key',
    'user_taxonomy_v1_parent_fkey',
    'user_taxonomy_v1_sibling_label_key',
    'user_note_v1_group_id_fkey',
    'user_note_v1_group_level_check'
  )
`)

const taxonomyConstraints = new Set(taxonomyConstraintsResult.rows.map((row) => row.conname))
for (const constraint of [
  "user_taxonomy_level_v1_pkey",
  "user_taxonomy_level_v1_user_id_fkey",
  "user_taxonomy_level_v1_level_check",
  "user_taxonomy_level_v1_label_not_blank_check",
  "user_taxonomy_v1_user_id_fkey",
  "user_taxonomy_v1_level_check",
  "user_taxonomy_v1_level_fkey",
  "user_taxonomy_v1_label_lowercase_check",
  "user_taxonomy_v1_root_parent_check",
  "user_taxonomy_v1_id_level_user_key",
  "user_taxonomy_v1_parent_fkey",
  "user_taxonomy_v1_sibling_label_key",
  "user_note_v1_group_id_fkey",
  "user_note_v1_group_level_check",
]) {
  if (!taxonomyConstraints.has(constraint)) {
    throw new Error(`Missing expected constraint: ${constraint}`)
  }
}

// The sibling-label unique constraint must keep NULLS NOT DISTINCT, or two
// epics could share a label (their parent_id is NULL).
const siblingLabelNullsResult = await client.query(`
  SELECT i.indnullsnotdistinct
  FROM pg_constraint c
  JOIN pg_index i ON i.indexrelid = c.conindid
  WHERE c.conname = 'user_taxonomy_v1_sibling_label_key'
`)

if (getScalar(siblingLabelNullsResult.rows, "indnullsnotdistinct") !== true) {
  throw new Error(
    "Expected user_taxonomy_v1_sibling_label_key to be UNIQUE NULLS NOT DISTINCT, " +
      "otherwise two epics can share a label",
  )
}

const taxonomyIndexesResult = await client.query(`
  SELECT indexname
  FROM pg_indexes
  WHERE schemaname = 'public'
    AND indexname IN (
      'user_taxonomy_level_v1_user_id_label_lower_idx',
      'user_taxonomy_v1_user_id_level_idx',
      'user_taxonomy_v1_parent_id_idx',
      'user_taxonomy_v1_epic_embedding_hnsw_idx',
      'user_taxonomy_v1_category_embedding_hnsw_idx',
      'user_taxonomy_v1_group_embedding_hnsw_idx',
      'user_note_v1_group_id_idx'
    )
`)

const taxonomyIndexes = new Set(taxonomyIndexesResult.rows.map((row) => row.indexname))
for (const index of [
  "user_taxonomy_level_v1_user_id_label_lower_idx",
  "user_taxonomy_v1_user_id_level_idx",
  "user_taxonomy_v1_parent_id_idx",
  "user_taxonomy_v1_epic_embedding_hnsw_idx",
  "user_taxonomy_v1_category_embedding_hnsw_idx",
  "user_taxonomy_v1_group_embedding_hnsw_idx",
  "user_note_v1_group_id_idx",
]) {
  if (!taxonomyIndexes.has(index)) {
    throw new Error(`Missing expected index: ${index}`)
  }
}

const taxonomyTriggersResult = await client.query(`
  SELECT COUNT(*)::int AS count
  FROM pg_trigger
  WHERE NOT tgisinternal
    AND tgname IN (
      'user_taxonomy_level_v1_apply_row_timestamps_v1',
      'user_taxonomy_v1_apply_row_timestamps_v1'
    )
`)

if (getScalar(taxonomyTriggersResult.rows, "count") !== 2) {
  throw new Error("Missing expected taxonomy row timestamp triggers")
}

// Structural invariants. Named-object assertions cannot catch a backfill that
// ran but produced the wrong shape, and these are the shapes the app relies on.
const taxonomyInvariantsResult = await client.query(`
  SELECT
    (SELECT COUNT(*)::int FROM public.user_v1 u
       WHERE (SELECT COUNT(*) FROM public.user_taxonomy_level_v1 l WHERE l.user_id = u.id) <> 4)
      AS users_without_four_tiers,
    (SELECT COUNT(*)::int FROM public.user_taxonomy_v1 t
       WHERE (t.level = 1) <> (t.parent_id IS NULL)) AS bad_roots,
    (SELECT COUNT(*)::int FROM public.user_taxonomy_v1 t
       JOIN public.user_taxonomy_v1 p ON p.id = t.parent_id
       WHERE p.level <> t.level - 1 OR p.user_id <> t.user_id) AS bad_parents,
    (SELECT COUNT(*)::int FROM public.user_v1 u
       WHERE NOT EXISTS (SELECT 1 FROM public.user_taxonomy_v1 t
                         WHERE t.user_id = u.id AND t.level = 1)
          OR NOT EXISTS (SELECT 1 FROM public.user_taxonomy_v1 t
                         WHERE t.user_id = u.id AND t.level = 2)
          OR NOT EXISTS (SELECT 1 FROM public.user_taxonomy_v1 t
                         WHERE t.user_id = u.id AND t.level = 3)) AS users_without_a_chain,
    (SELECT COUNT(*)::int FROM public.user_note_v1 n
       LEFT JOIN public.user_taxonomy_v1 g
         ON g.id = n.group_id AND g.level = 3 AND g.user_id = n.user_id
       WHERE g.id IS NULL) AS notes_off_a_group
`)

const taxonomyInvariants = taxonomyInvariantsResult.rows[0] ?? {}

for (const [field, message] of [
  ["users_without_four_tiers", "Every user must have all four taxonomy tier definitions"],
  ["bad_roots", "Exactly the level-1 taxonomy rows may have a null parent"],
  ["bad_parents", "Every taxonomy parent must be one level up and the same owner"],
  ["users_without_a_chain", "Every user must have an epic, a category and a group"],
  ["notes_off_a_group", "Every note must hang off a level-3 row owned by the same user"],
]) {
  if (taxonomyInvariants[field] !== 0) {
    throw new Error(`${message} (found ${taxonomyInvariants[field]})`)
  }
}

// Anonymous-merge coverage guard: every table with a foreign key to user_v1
// must have a declared strategy in MERGE_TABLE_STRATEGIES
// (sql/user/anonymous.ts), which documents how mergeAnonymousUserInto handles
// its rows. This makes adding a user-owned table without deciding its merge
// behavior a verification failure instead of silent data loss.
const mergeStrategySource = readFileSync(
  new URL("../sql/user/anonymous.ts", import.meta.url),
  "utf8",
)
const strategyBlockMatch = mergeStrategySource.match(
  /MERGE_TABLE_STRATEGIES[^=]*=\s*\{([\s\S]*?)\};/,
)

if (!strategyBlockMatch) {
  throw new Error("Could not locate MERGE_TABLE_STRATEGIES in sql/user/anonymous.ts")
}

const declaredMergeTables = new Set(
  [...strategyBlockMatch[1].matchAll(/^\s*(\w+):\s*"/gm)].map((match) => match[1]),
)

const userFkTablesResult = await client.query(`
  SELECT DISTINCT c.conrelid::regclass::text AS table_name
  FROM pg_constraint c
  WHERE c.contype = 'f'
    AND c.confrelid = 'public.user_v1'::regclass
`)

for (const row of userFkTablesResult.rows) {
  const tableName = row.table_name.replace(/^public\./, "")

  if (!declaredMergeTables.has(tableName)) {
    throw new Error(
      `Table ${tableName} references user_v1 but has no entry in ` +
        "MERGE_TABLE_STRATEGIES (lib/db-notes/sql/user/anonymous.ts). " +
        "Decide how mergeAnonymousUserInto must handle its rows and register it.",
    )
  }
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
